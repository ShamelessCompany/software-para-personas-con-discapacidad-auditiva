import { describe, expect, it, vi } from "vitest";
import { LISTENING_TRANSITION_RESULT, ListeningTransitionController } from "../src/renderer/listening-transition";
import { ASR_ENDPOINTING_MODE, ASR_LANGUAGE_MODE, ASR_PROFILE, SIDECAR_LIFECYCLE, type AsrStartResult, type OperationResult, type SidecarStatus } from "../src/shared/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function services() {
  return {
    startMicrophone: vi.fn(() => Promise.resolve(true)),
    pauseMicrophone: vi.fn(() => Promise.resolve()),
    resumeMicrophone: vi.fn(() => Promise.resolve()),
    stopMicrophone: vi.fn(),
    startAsr: vi.fn<() => Promise<AsrStartResult>>(() => Promise.resolve({ ok: true, message: "ASR iniciado.", sessionId: 1 })),
    stopAsr: vi.fn(() => Promise.resolve({ ok: true, message: "ASR detenido." })),
    startDemo: vi.fn(),
    pauseDemo: vi.fn(),
    resumeDemo: vi.fn(),
    cancelDemo: vi.fn(),
    onTransition: vi.fn(),
  };
}

function status(lifecycle: SidecarStatus["lifecycle"], ownerSessionId: number | null, sessionId: number | null = null): SidecarStatus {
  return {
    sessionId,
    ownerSessionId,
    lifecycle,
    processRunning: lifecycle === SIDECAR_LIFECYCLE.STARTING || lifecycle === SIDECAR_LIFECYCLE.RUNNING || lifecycle === SIDECAR_LIFECYCLE.STOPPING,
    pythonAvailable: true,
    voskAvailable: true,
    modelAvailable: true,
    ready: lifecycle === SIDECAR_LIFECYCLE.RUNNING,
    audioSaturated: false,
    audioSentMs: 0,
    audioPendingMs: 0,
    audioBlocksSent: 0,
    maximumQueueMs: 0,
    audioOverflows: 0,
    firstPartialLatencyMs: null,
    lastFinalLatencyMs: null,
    endpointFinalLatencyMs: null,
    cpuTimeMs: null,
    modelPath: "/model",
    requestedProfile: ASR_PROFILE.LIGHT,
    activeProfile: ASR_PROFILE.LIGHT,
    modelName: "vosk-model-small-es-0.42",
    fallbackReason: null,
    languageMode: ASR_LANGUAGE_MODE.DYNAMIC_GRAMMAR,
    endpointingMode: ASR_ENDPOINTING_MODE.MODEL_CONFIG,
    endpointingMessage: "model.conf",
    message: lifecycle,
  };
}

describe("ListeningTransitionController", () => {
  it("cancela la demo antes de iniciar ASR real", async () => {
    const api = services();
    const controller = new ListeningTransitionController(api);
    expect((await controller.startDemo())?.kind).toBe(LISTENING_TRANSITION_RESULT.DEMO_STARTED);

    const result = await controller.startReal();

    expect(result?.kind).toBe(LISTENING_TRANSITION_RESULT.REAL_STARTED);
    expect(api.cancelDemo).toHaveBeenCalledTimes(2);
    expect(api.startMicrophone).toHaveBeenCalledTimes(1);
    expect(api.startAsr).toHaveBeenCalledTimes(1);
    expect(api.startAsr.mock.invocationCallOrder[0]).toBeLessThan(api.startMicrophone.mock.invocationCallOrder[0] as number);
  });

  it("no abre el micrófono cuando falla el self-check del ASR", async () => {
    const api = services();
    api.startAsr.mockResolvedValueOnce({ ok: false, message: "Self-check fallido.", sessionId: null });
    const controller = new ListeningTransitionController(api);
    const result = await controller.startReal();
    expect(result?.kind).toBe(LISTENING_TRANSITION_RESULT.OPERATION_FAILED);
    expect(api.startMicrophone).not.toHaveBeenCalled();
  });

  it("invalida un ASR pendiente antes de iniciar demo y limpia sus recursos", async () => {
    const pendingAsr = deferred<AsrStartResult>();
    const api = services();
    api.startAsr.mockReturnValueOnce(pendingAsr.promise);
    const controller = new ListeningTransitionController(api);
    const real = controller.startReal();
    await vi.waitFor(() => expect(api.startAsr).toHaveBeenCalledTimes(1));
    const demo = controller.startDemo();

    pendingAsr.resolve({ ok: true, message: "ready tardío", sessionId: 1 });

    expect(await real).toBeNull();
    expect((await demo)?.kind).toBe(LISTENING_TRANSITION_RESULT.DEMO_STARTED);
    expect(api.stopMicrophone).toHaveBeenCalled();
    expect(api.stopAsr).toHaveBeenCalledTimes(2);
    expect(api.startDemo).toHaveBeenCalledTimes(1);
  });

  it("cancela STARTING al morir el sidecar e ignora una respuesta ready tardía", async () => {
    const pendingAsr = deferred<AsrStartResult>();
    const api = services();
    api.startAsr.mockReturnValueOnce(pendingAsr.promise);
    const controller = new ListeningTransitionController(api);
    const real = controller.startReal();
    await vi.waitFor(() => expect(api.startAsr).toHaveBeenCalledTimes(1));

    const cancelled = controller.cancelReal();
    expect(controller.acceptsAsrResult({ kind: "final", text: "tardío", sessionId: 1 })).toBe(false);
    pendingAsr.resolve({ ok: true, message: "ready tardío", sessionId: 1 });

    expect(await real).toBeNull();
    expect((await cancelled)?.kind).toBe(LISTENING_TRANSITION_RESULT.STOPPED);
    expect(controller.isRealActive()).toBe(false);
    expect(api.stopAsr).toHaveBeenCalledTimes(2);
  });

  it("rechaza un resultado viejo durante demo", async () => {
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();
    expect(controller.acceptsAsrResult({ kind: "final", text: "válido", sessionId: 1 })).toBe(true);

    const pendingStop = deferred<OperationResult>();
    api.stopAsr.mockReturnValueOnce(pendingStop.promise);
    const demo = controller.startDemo();
    expect(controller.acceptsAsrResult({ kind: "final", text: "viejo", sessionId: 1 })).toBe(false);
    pendingStop.resolve({ ok: true, message: "detenido" });
    await demo;
    expect(controller.acceptsAsrResult({ kind: "final", text: "viejo", sessionId: 1 })).toBe(false);
  });

  it("rechaza la sesión anterior y acepta solo la sesión nueva activa", async () => {
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();
    await controller.stop();
    api.startAsr.mockResolvedValueOnce({ ok: true, message: "ASR reiniciado.", sessionId: 2 });
    await controller.startReal();

    expect(controller.acceptsAsrResult({ kind: "partial", text: "anterior", sessionId: 1 })).toBe(false);
    expect(controller.acceptsAsrResult({ kind: "partial", text: "actual", sessionId: 2 })).toBe(true);
  });

  it("invalida una sesión activa antes de esperar el cierre tras una muerte", async () => {
    const pendingStop = deferred<OperationResult>();
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();
    api.stopAsr.mockReturnValueOnce(pendingStop.promise);

    const cancelled = controller.cancelReal();

    expect(controller.acceptsAsrResult({ kind: "final", text: "tardío", sessionId: 1 })).toBe(false);
    expect(controller.acceptsAsrResult({ kind: "final", text: "última frase", sessionId: 1, cause: "stop-flush" })).toBe(true);
    pendingStop.resolve({ ok: true, message: "proceso cerrado" });
    expect((await cancelled)?.kind).toBe(LISTENING_TRANSITION_RESULT.STOPPED);
  });

  it("ignora un estado terminal viejo mientras inicia una sesión nueva", async () => {
    const pendingAsr = deferred<AsrStartResult>();
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();
    await controller.stop();
    api.startAsr.mockReturnValueOnce(pendingAsr.promise);

    const restarting = controller.startReal();
    await vi.waitFor(() => expect(api.startAsr).toHaveBeenCalledTimes(2));

    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.STOPPED, 1))).toBe(false);
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.STARTING, 2, 2))).toBe(false);
    pendingAsr.resolve({ ok: true, message: "ASR reiniciado.", sessionId: 2 });
    await restarting;
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.RUNNING, 2, 2))).toBe(true);
  });

  it("impide que un RUNNING viejo se apropie de un reinicio pendiente", async () => {
    const pendingAsr = deferred<AsrStartResult>();
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();
    await controller.stop();
    api.startAsr.mockReturnValueOnce(pendingAsr.promise);

    const restarting = controller.startReal();
    await vi.waitFor(() => expect(api.startAsr).toHaveBeenCalledTimes(2));

    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.RUNNING, 1, 1))).toBe(false);
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.RUNNING, 2, 2))).toBe(false);
    pendingAsr.resolve({ ok: true, message: "ASR reiniciado.", sessionId: 2 });
    await restarting;

    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.RUNNING, 1, 1))).toBe(false);
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.RUNNING, 2, 2))).toBe(true);
  });

  it("ignora un estado terminal viejo durante la demostración", async () => {
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();
    const pendingStop = deferred<OperationResult>();
    api.stopAsr.mockReturnValueOnce(pendingStop.promise);
    const demo = controller.startDemo();

    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.STOPPED, 1))).toBe(false);
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.ERROR, 1))).toBe(false);
    pendingStop.resolve({ ok: true, message: "detenido" });
    await demo;

    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.STOPPED, 1))).toBe(false);
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.ERROR, 1))).toBe(false);
  });

  it("acepta estados activos y terminales de la sesión real actual", async () => {
    const pendingStop = deferred<OperationResult>();
    const api = services();
    const controller = new ListeningTransitionController(api);
    await controller.startReal();

    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.RUNNING, 1, 1))).toBe(true);
    api.stopAsr.mockReturnValueOnce(pendingStop.promise);
    const stopping = controller.stop();
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.STOPPING, 1))).toBe(true);
    expect(controller.acceptsSidecarStatus(status(SIDECAR_LIFECYCLE.STOPPED, 1))).toBe(true);
    pendingStop.resolve({ ok: true, message: "detenido" });
    await stopping;
  });
});
