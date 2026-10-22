import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => "/app", getPath: () => "/data" } }));

import { AsrSidecar, AudioBackpressure, isDemoDistribution, resolveConfiguredModelPath, resolveConfiguredSidecarPath, type SidecarDependencies } from "../src/main/sidecar";
import { SIDECAR_LIFECYCLE, type SidecarStatus } from "../src/shared/types";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    this.emit("close", null, "SIGTERM");
    return true;
  });
}

function childProcess(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams;
}

function dependencies(child: FakeChild): SidecarDependencies {
  return {
    spawnProcess: vi.fn(() => childProcess(child)),
    executableExists: vi.fn(() => true),
    inspectRuntime: vi.fn(() => Promise.resolve({ executable: "python", voskAvailable: true })),
    selfTestRuntime: vi.fn(() => Promise.resolve('{"type":"self-test","status":"ok","protocolVersion":1,"engine":"vosk"}')),
    modelPath: (profile) => profile === "precise" ? "/model-large" : "/model",
    resourcesPath: () => "/resources",
    appPath: () => "/app",
    isPackaged: () => false,
    isDemoPackage: () => false,
    platform: "linux",
    stopTimeoutMs: 20,
    killTimeoutMs: 20,
    startTimeoutMs: 100,
  };
}

describe("AudioBackpressure", () => {
  it("conserva FIFO mientras espera drain", () => {
    const policy = new AudioBackpressure();
    const written: string[] = [];
    const write = vi.fn((payload: string) => {
      written.push(payload);
      return written.length !== 1;
    });
    expect(policy.write({ write }, "uno", 60)).toBe(true);
    expect(policy.write({ write }, "dos", 60)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(policy.inspect()).toMatchObject({ saturated: true, audioPendingMs: 120, audioOverflows: 0 });
    policy.onDrain({ write });
    expect(written).toEqual(["uno", "dos"]);
    expect(policy.inspect()).toMatchObject({ saturated: false, audioPendingMs: 0, audioSentMs: 120, audioBlocksSent: 2 });
  });

  it("transporta diez minutos a 40 ms en orden exacto sin drops silenciosos", () => {
    const policy = new AudioBackpressure();
    const written: number[] = [];
    let writes = 0;
    const writer = {
      write: (payload: string): boolean => {
        written.push(Number(payload));
        writes += 1;
        return writes % 17 !== 0;
      },
    };
    for (let index = 0; index < 15_000; index += 1) {
      expect(policy.write(writer, String(index), 40)).toBe(true);
      if (policy.inspect().saturated) policy.onDrain(writer);
    }
    if (policy.inspect().saturated) policy.onDrain(writer);
    expect(written).toEqual(Array.from({ length: 15_000 }, (_value, index) => index));
    expect(policy.inspect()).toMatchObject({ audioSentMs: 600_000, audioPendingMs: 0, audioBlocksSent: 15_000, audioOverflows: 0 });
  });

  it("rechaza explícitamente el bloque que supera diez segundos pendientes", () => {
    const policy = new AudioBackpressure(10_000);
    const writer = { write: () => false };
    expect(policy.write(writer, "primero", 9_960)).toBe(true);
    expect(policy.write(writer, "desborde", 80)).toBe(false);
    expect(policy.inspect()).toMatchObject({ audioPendingMs: 9_960, audioOverflows: 1 });
  });
});

describe("AsrSidecar", () => {
  beforeEach(() => vi.useRealTimers());

  it("espera ready, espera exit al detener y permite reiniciar con otro proceso", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const spawned = [first, second];
    const statuses: SidecarStatus[] = [];
    const deps = dependencies(first);
    deps.spawnProcess = vi.fn(() => childProcess(spawned.shift() as FakeChild));
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: (status) => statuses.push(status) }, deps);

    const starting = sidecar.start(16_000);
    first.stdout.write('{"type":"ready"}\n');
    const firstStart = await starting;
    expect(firstStart.status.lifecycle).toBe(SIDECAR_LIFECYCLE.RUNNING);
    expect(firstStart.sessionId).toBe(1);
    const stopping = sidecar.stop();
    const restarting = sidecar.start(16_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(statuses.at(-1)?.lifecycle).toBe(SIDECAR_LIFECYCLE.STOPPING);
    expect(deps.spawnProcess).toHaveBeenCalledTimes(1);
    first.emit("close", 0, null);
    expect((await stopping).lifecycle).toBe(SIDECAR_LIFECYCLE.STOPPED);

    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.spawnProcess).toHaveBeenCalledTimes(2);
    second.stdout.write('{"type":"ready"}\n');
    const secondStart = await restarting;
    expect(secondStart.status.processRunning).toBe(true);
    expect(secondStart.sessionId).toBe(2);
    expect(secondStart.status.sessionId).toBe(2);
    expect(deps.spawnProcess).toHaveBeenCalledTimes(2);
  });

  it("reporta fallo y nunca ready cuando el proceso muere con código nulo", async () => {
    const child = new FakeChild();
    const statuses: SidecarStatus[] = [];
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: (status) => statuses.push(status) }, dependencies(child));
    const starting = sidecar.start(16_000);
    child.stdout.write('{"type":"ready"}\n');
    await starting;
    child.emit("close", null, "SIGKILL");
    await new Promise((resolve) => setImmediate(resolve));
    const status = statuses.at(-1);
    expect(status?.ready).toBe(false);
    expect(status?.processRunning).toBe(false);
    expect(status?.sessionId).toBeNull();
    expect(status?.ownerSessionId).toBe(1);
    expect(status?.lifecycle).toBe(SIDECAR_LIFECYCLE.ERROR);
    expect(status?.message).toContain("cerró inesperadamente");
  });

  it("no permite que ready tardío reviva un proceso muerto durante STARTING", async () => {
    const child = new FakeChild();
    const statuses: SidecarStatus[] = [];
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: (status) => statuses.push(status) }, dependencies(child));
    const starting = sidecar.start(16_000);
    await vi.waitFor(() => expect(statuses.some((status) => status.lifecycle === SIDECAR_LIFECYCLE.STARTING)).toBe(true));
    child.emit("close", null, "SIGKILL");
    child.stdout.write('{"type":"ready"}\n');

    const result = await starting;

    expect(result.status.lifecycle).toBe(SIDECAR_LIFECYCLE.ERROR);
    expect(result.status.ready).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.status.ownerSessionId).toBe(1);
    expect(statuses.at(-1)?.message).toContain("cerró inesperadamente");
    expect(statuses.some((status) => status.lifecycle === SIDECAR_LIFECYCLE.RUNNING)).toBe(false);
  });

  it("fuerza cierre solo después del timeout de parada", async () => {
    const child = new FakeChild();
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: () => undefined }, dependencies(child));
    const starting = sidecar.start(16_000);
    child.stdout.write('{"type":"ready"}\n');
    await starting;
    await sidecar.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("permite reiniciar después de un cierre inesperado con una sesión nueva", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const spawned = [first, second];
    const deps = dependencies(first);
    deps.spawnProcess = vi.fn(() => childProcess(spawned.shift() as FakeChild));
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: () => undefined }, deps);
    const firstStart = sidecar.start(16_000);
    first.stdout.write('{"type":"ready"}\n');
    await firstStart;
    first.emit("close", null, "SIGKILL");

    const secondStart = sidecar.start(16_000);
    await vi.waitFor(() => expect(deps.spawnProcess).toHaveBeenCalledTimes(2));
    second.stdout.write('{"type":"ready"}\n');

    expect(await secondStart).toMatchObject({ sessionId: 2, status: { lifecycle: SIDECAR_LIFECYCLE.RUNNING, sessionId: 2, ownerSessionId: 2 } });
  });

  it("etiqueta resultados con su sesión y descarta stdout de una sesión anterior", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const spawned = [first, second];
    const results: Array<{ text: string; sessionId: number }> = [];
    const deps = dependencies(first);
    deps.spawnProcess = vi.fn(() => childProcess(spawned.shift() as FakeChild));
    const sidecar = new AsrSidecar({ onResult: (result) => results.push(result), onStatus: () => undefined }, deps);

    const firstStart = sidecar.start(16_000);
    first.stdout.write('{"type":"ready"}\n');
    await firstStart;
    const stopping = sidecar.stop();
    first.emit("close", 0, null);
    await stopping;
    const secondStart = sidecar.start(16_000);
    second.stdout.write('{"type":"ready"}\n');
    await secondStart;

    first.stdout.write('{"type":"final","text":"viejo"}\n');
    second.stdout.write('{"type":"final","text":"actual"}\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(results).toEqual([expect.objectContaining({ text: "actual", kind: "final", sessionId: 2 })]);
  });

  it("conserva la sesión hasta procesar el final de stop-flush", async () => {
    const child = new FakeChild();
    const results: Array<{ text: string; sessionId: number }> = [];
    const statuses: SidecarStatus[] = [];
    const sidecar = new AsrSidecar({ onResult: (result) => results.push(result), onStatus: (status) => statuses.push(status) }, dependencies(child));
    const starting = sidecar.start(16_000);
    child.stdout.write('{"type":"ready"}\n');
    await starting;

    const stopping = sidecar.stop();
    expect(statuses.at(-1)?.sessionId).toBe(1);
    expect(statuses.at(-1)?.ownerSessionId).toBe(1);
    expect(statuses.at(-1)?.lifecycle).toBe(SIDECAR_LIFECYCLE.STOPPING);
    child.stdout.write('{"type":"final","text":"última frase","firstAudioAtMs":1,"resultAtMs":2,"latencyMs":1,"segmentDurationMs":60,"confidence":0.8,"cause":"stop-flush"}\n');
    child.emit("close", 0, null);
    await stopping;

    expect(results).toEqual([expect.objectContaining({ text: "última frase", kind: "final", sessionId: 1, cause: "stop-flush" })]);
    expect(statuses.at(-1)?.sessionId).toBeNull();
    expect(statuses.at(-1)?.ownerSessionId).toBe(1);
  });

  it("hace visible el desborde y termina el proceso para que renderer detenga la captura", async () => {
    const child = new FakeChild();
    const statuses: SidecarStatus[] = [];
    child.stdin.write = vi.fn(() => false) as typeof child.stdin.write;
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: (status) => statuses.push(status) }, dependencies(child));
    const starting = sidecar.start(16_000);
    child.stdout.write('{"type":"ready"}\n');
    await starting;
    for (let index = 0; index < 168; index += 1) sidecar.sendAudio(new Uint8Array(1_920));
    expect(statuses).toContainEqual(expect.objectContaining({ lifecycle: SIDECAR_LIFECYCLE.ERROR, ready: false, audioOverflows: 1, message: "El equipo no procesa el audio en tiempo real" }));
    expect(statuses.at(-1)).toMatchObject({ lifecycle: SIDECAR_LIFECYCLE.STOPPED, ready: false });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("invalida por muerte antes de ignorar eventos tardíos del proceso", async () => {
    const child = new FakeChild();
    const results: Array<{ text: string; sessionId: number }> = [];
    const statuses: SidecarStatus[] = [];
    const sidecar = new AsrSidecar({ onResult: (result) => results.push(result), onStatus: (status) => statuses.push(status) }, dependencies(child));
    const starting = sidecar.start(16_000);
    child.stdout.write('{"type":"ready"}\n');
    await starting;

    child.emit("close", null, "SIGKILL");
    child.stdout.write('{"type":"final","text":"después de morir"}\n');
    child.stdin.emit("drain");
    child.stderr.write("error tardío");
    await new Promise((resolve) => setImmediate(resolve));

    expect(results).toEqual([]);
    expect(statuses.at(-1)?.sessionId).toBeNull();
    expect(statuses.at(-1)?.ownerSessionId).toBe(1);
    expect(statuses.at(-1)?.lifecycle).toBe(SIDECAR_LIFECYCLE.ERROR);
  });

  it("un stop solicitado durante inspect invalida el start antes de crear una sesión", async () => {
    let resolveInspection!: (inspection: { executable: string; voskAvailable: boolean }) => void;
    const inspection = new Promise<{ executable: string; voskAvailable: boolean }>((resolve) => { resolveInspection = resolve; });
    const child = new FakeChild();
    const results: Array<{ text: string; sessionId: number }> = [];
    const statuses: SidecarStatus[] = [];
    const deps = dependencies(child);
    deps.inspectRuntime = vi.fn(() => inspection);
    const sidecar = new AsrSidecar({ onResult: (result) => results.push(result), onStatus: (status) => statuses.push(status) }, deps);

    const starting = sidecar.start(16_000);
    await vi.waitFor(() => expect(deps.inspectRuntime).toHaveBeenCalledTimes(1));
    const stopping = sidecar.stop();
    resolveInspection({ executable: "python", voskAvailable: true });

    expect((await starting).sessionId).toBeNull();
    expect(await stopping).toMatchObject({ lifecycle: SIDECAR_LIFECYCLE.STOPPED, sessionId: null, ownerSessionId: null });
    child.stdout.write('{"type":"ready"}\n{"type":"final","text":"tardío"}\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(deps.spawnProcess).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(statuses.some((status) => status.lifecycle === SIDECAR_LIFECYCLE.STARTING || status.lifecycle === SIDECAR_LIFECYCLE.RUNNING)).toBe(false);
  });

  it("no espera el timeout de inicio cuando stop invalida STARTING", async () => {
    const child = new FakeChild();
    const deps = dependencies(child);
    deps.startTimeoutMs = 60_000;
    const sidecar = new AsrSidecar({ onResult: () => undefined, onStatus: () => undefined }, deps);
    const starting = sidecar.start(16_000);
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = sidecar.stop();
    const startResult = await starting;
    expect(startResult.sessionId).toBeNull();
    expect(startResult.status).toMatchObject({ lifecycle: SIDECAR_LIFECYCLE.STOPPING, sessionId: null, ownerSessionId: 1 });
    child.emit("close", 0, null);
    expect((await stopping).lifecycle).toBe(SIDECAR_LIFECYCLE.STOPPED);
  });
});

describe("distribución demo", () => {
  const fixture = resolve(".tmp-demo-distribution-test");

  afterEach(async () => rm(fixture, { recursive: true, force: true }));

  it("solo se activa con un marcador explícito en package.json", async () => {
    await mkdir(fixture, { recursive: true });
    await writeFile(resolve(fixture, "package.json"), JSON.stringify({ name: "senalsc", senalscDistribution: "demo" }));
    expect(isDemoDistribution(fixture)).toBe(true);
    await writeFile(resolve(fixture, "package.json"), JSON.stringify({ name: "senalsc" }));
    expect(isDemoDistribution(fixture)).toBe(false);
  });
});

describe("ruta externa del sidecar", () => {
  it("acepta solo una ruta absoluta normalizada con el nombre esperado", () => {
    expect(resolveConfiguredSidecarPath("/opt/SenaLSC/senalsc-asr.exe")).toBe("/opt/SenaLSC/senalsc-asr.exe");
    expect(resolveConfiguredSidecarPath("/opt/SenaLSC/../senalsc-asr.exe")).toBeNull();
    expect(resolveConfiguredSidecarPath("sidecar-bin/senalsc-asr.exe")).toBeNull();
    expect(resolveConfiguredSidecarPath("/opt/SenaLSC/otro.exe")).toBeNull();
  });

  it("acepta solo la carpeta absoluta normalizada del perfil esperado", () => {
    expect(resolveConfiguredModelPath("light", "/models/vosk-model-small-es-0.42")).toBe("/models/vosk-model-small-es-0.42");
    expect(resolveConfiguredModelPath("light", "/models/../vosk-model-small-es-0.42")).toBeNull();
    expect(resolveConfiguredModelPath("precise", "/models/vosk-model-small-es-0.42")).toBeNull();
  });
});
