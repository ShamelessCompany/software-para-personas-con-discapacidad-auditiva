import { describe, expect, it } from "vitest";
import { isOverlayState, validateAsrResult, validateAsrStartRequest, validateAsrStartResult, validateAudioChunk, validateExportRequest, validateImportVisualMediaRequest, validateMediaId, validateMediaIdRequest, validateResidentPreferences, validateResidentServiceState, validateSampleRate, validateSaveVisualMediaRequest, validateSessionId, validateSidecarStatus, validateVisualLibraryEntry } from "../src/shared/validation";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { ASR_ENDPOINTING_MODE, ASR_LANGUAGE_MODE, ASR_PROFILE, MEDIA_KIND, MEDIA_SOURCE, MEDIA_STATUS, SIDECAR_LIFECYCLE, type VisualLibraryEntry } from "../src/shared/types";

function mediaEntry(status: VisualLibraryEntry["status"] = MEDIA_STATUS.PENDING): VisualLibraryEntry {
  return {
    id: "media-prueba",
    label: "Prueba",
    phrases: ["frase de prueba"],
    keywords: ["prueba"],
    context: "Aula",
    region: "Bogotá",
    status,
    validation: { validators: [], notes: "", validatedAt: null },
    authorization: { license: "", authorizationReference: "" },
    media: { kind: MEDIA_KIND.IMAGE, source: MEDIA_SOURCE.IMPORTED, uri: "archivo.png", mimeType: "image/png", altText: "Imagen de prueba" },
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("validación IPC", () => {
  it("acepta solo frecuencias de audio razonables", () => {
    expect(validateSampleRate(16_000)).toBe(16_000);
    expect(validateSampleRate(1_000)).toBeNull();
    expect(validateSampleRate("16000")).toBeNull();
  });

  it("acepta únicamente PCM 16 kHz y perfiles conocidos al iniciar", () => {
    expect(validateAsrStartRequest({ sampleRate: 16_000, profile: ASR_PROFILE.PRECISE })).toEqual({ sampleRate: 16_000, profile: ASR_PROFILE.PRECISE });
    expect(validateAsrStartRequest({ sampleRate: 48_000, profile: ASR_PROFILE.PRECISE })).toBeNull();
    expect(validateAsrStartRequest({ sampleRate: 16_000, profile: "otro" })).toBeNull();
  });

  it("rechaza audio vacío o excesivo", () => {
    expect(validateAudioChunk(new Uint8Array([1, 2]))).not.toBeNull();
    expect(validateAudioChunk(new Uint8Array())).toBeNull();
    expect(validateAudioChunk(new Uint8Array(300_000))).toBeNull();
  });

  it("valida la identidad de sesión en inicio y resultados ASR", () => {
    expect(validateSessionId(1)).toBe(1);
    expect(validateSessionId(0)).toBeNull();
    expect(validateAsrStartResult({ ok: true, message: "activo", sessionId: 7 })).toEqual({ ok: true, message: "activo", sessionId: 7 });
    expect(validateAsrStartResult({ ok: true, message: "activo", sessionId: null })).toBeNull();
    const result = { kind: "final", text: "hola", sessionId: 7, firstAudioAtMs: 1, resultAtMs: 2, latencyMs: 1, endpointLatencyMs: 800, cpuTimeMs: 20, segmentDurationMs: 60, confidence: 0.9, cause: "endpoint" };
    expect(validateAsrResult(result)).toEqual(result);
    expect(validateAsrResult({ kind: "final", text: "hola" })).toBeNull();
    expect(validateAsrResult({ kind: "final", text: "hola", sessionId: 0 })).toBeNull();
  });

  it("exige una sesión válida o null en cada estado ASR", () => {
    const status = {
      sessionId: 7,
      ownerSessionId: 7,
      lifecycle: SIDECAR_LIFECYCLE.RUNNING,
      processRunning: true,
      pythonAvailable: true,
      voskAvailable: true,
      modelAvailable: true,
      ready: true,
      audioSaturated: false,
      audioSentMs: 60,
      audioPendingMs: 0,
      audioBlocksSent: 1,
      maximumQueueMs: 60,
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
      message: "activo",
    };
    expect(validateSidecarStatus(status)).toEqual(status);
    expect(validateSidecarStatus({ ...status, sessionId: 0 })).toBeNull();
    expect(validateSidecarStatus({ ...status, sessionId: undefined })).toBeNull();
    expect(validateSidecarStatus({ ...status, ownerSessionId: 0 })).toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.STOPPED })).toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.STOPPED, sessionId: null })).not.toBeNull();
    expect(validateSidecarStatus({ ...status, sessionId: null })).toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.STARTING, sessionId: null })).toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.STOPPING, sessionId: null })).toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.ERROR, sessionId: null })).not.toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.ERROR, sessionId: null, ownerSessionId: null })).toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.STOPPED, sessionId: null, ownerSessionId: null })).not.toBeNull();
    expect(validateSidecarStatus({ ...status, lifecycle: SIDECAR_LIFECYCLE.STOPPING, sessionId: null, ownerSessionId: null })).toBeNull();
  });

  it("rechaza formatos de exportación no permitidos", () => {
    expect(validateExportRequest({ format: "csv", entries: [] })).toBeNull();
    expect(validateExportRequest({ format: "txt", entries: [] })).toEqual({ format: "txt", entries: [] });
  });

  it("rechaza preferencias y estado residente incompletos", () => {
    expect(validateResidentPreferences({ captionsVisible: true, visualSupportVisible: false, launchAtLogin: false })).toEqual({ captionsVisible: true, visualSupportVisible: false, launchAtLogin: false });
    expect(validateResidentPreferences({ captionsVisible: true })).toBeNull();
    expect(validateResidentServiceState({ listeningState: "listening", demoMode: false, transitioning: false })).toEqual({ listeningState: "listening", demoMode: false, transitioning: false });
    expect(validateResidentServiceState({ listeningState: "externo", demoMode: false, transitioning: false })).toBeNull();
  });

  it("valida completamente el estado del overlay", () => {
    const valid = {
      livePartial: "hola",
      confirmedPhrase: null,
      confirmedExpiresAt: null,
      demoMode: false,
      contentSource: "asr",
      listeningState: "listening",
      microphoneLabel: "Micrófono de prueba",
      settings: DEFAULT_SETTINGS,
      activeMedia: null,
      mediaError: null,
    };
    expect(isOverlayState(valid)).toBe(true);
    expect(isOverlayState({ ...valid, contentSource: "externa" })).toBe(false);
    expect(isOverlayState({ ...valid, settings: { ...DEFAULT_SETTINGS, fontSize: 500 } })).toBe(false);
    expect(isOverlayState({ ...valid, activeMedia: { id: "incompleto" } })).toBe(false);
  });

  it("valida IDs de medios sin traversal", () => {
    expect(validateMediaId("media-buenos-dias")).toBe("media-buenos-dias");
    expect(validateMediaId("../secreto")).toBeNull();
    expect(validateMediaId("A")).toBeNull();
    expect(validateMediaId("demo%2Fsecreto")).toBeNull();
    expect(validateMediaIdRequest({ id: "media-buenos-dias" })).toEqual({ id: "media-buenos-dias" });
    expect(validateMediaIdRequest({ id: "../secreto" })).toBeNull();
  });

  it("exige autorización y dos validadores para validated", () => {
    const incomplete = mediaEntry(MEDIA_STATUS.VALIDATED);
    expect(validateVisualLibraryEntry(incomplete)).toBeNull();
    const valid = { ...incomplete, validation: { validators: ["Validador 1", "Validador 2"], notes: "Revisión comunitaria", validatedAt: "2026-01-02T00:00:00.000Z" }, authorization: { license: "Permiso escrito", authorizationReference: "AUT-7" } };
    expect(validateVisualLibraryEntry(valid)?.status).toBe(MEDIA_STATUS.VALIDATED);
  });

  it("acepta academic incorporado con fuente y rechaza academic importado", () => {
    const academic = {
      ...mediaEntry(MEDIA_STATUS.ACADEMIC),
      authorization: { license: "CC BY 4.0", authorizationReference: "10.6084/m9.figshare.27383016.v1" },
      media: { ...mediaEntry().media, source: MEDIA_SOURCE.BUNDLED, uri: "lsc50/0000-gracias.mp4", kind: MEDIA_KIND.VIDEO, mimeType: "video/mp4" },
    };
    expect(validateVisualLibraryEntry(academic)?.status).toBe(MEDIA_STATUS.ACADEMIC);
    expect(validateVisualLibraryEntry({ ...academic, media: { ...academic.media, source: MEDIA_SOURCE.IMPORTED } })).toBeNull();
  });

  it("reserva community a EXPRESA incorporado con licencia completa", () => {
    const community = { ...mediaEntry(MEDIA_STATUS.COMMUNITY), authorization: { license: "CC BY-NC-ND 3.0 Unported", authorizationReference: "https://archive.org/details/tecnologia_expresa" }, media: { ...mediaEntry().media, source: MEDIA_SOURCE.BUNDLED, uri: "expresa/tecnologia_expresa/computador.mp4", kind: MEDIA_KIND.VIDEO, mimeType: "video/mp4" } };
    expect(validateVisualLibraryEntry(community)?.status).toBe(MEDIA_STATUS.COMMUNITY);
    expect(validateVisualLibraryEntry({ ...community, media: { ...community.media, source: MEDIA_SOURCE.IMPORTED } })).toBeNull();
  });

  it("aplica la misma política al payload de importación", () => {
    const baseDraft = {
      label: "Clip",
      phrases: ["frase"],
      keywords: [],
      context: "Aula",
      region: "Bogotá",
      status: MEDIA_STATUS.VALIDATED,
      validators: ["Uno"],
      validationNotes: "",
      license: "Permiso",
      authorizationReference: "AUT",
      altText: "Persona presentando una seña autorizada",
    };
    expect(validateImportVisualMediaRequest({ draft: baseDraft })).toBeNull();
    expect(validateImportVisualMediaRequest({ draft: { ...baseDraft, validators: ["Uno", "Dos"] } })?.draft.status).toBe(MEDIA_STATUS.VALIDATED);
  });

  it("rechaza URI de archivo peligrosa y SVG importado", () => {
    expect(validateVisualLibraryEntry({ ...mediaEntry(), media: { ...mediaEntry().media, uri: "../archivo.png" } })).toBeNull();
    expect(validateVisualLibraryEntry({ ...mediaEntry(), media: { ...mediaEntry().media, uri: "archivo.svg", mimeType: "image/svg+xml" } })).toBeNull();
  });

  it("valida el payload de guardado completo", () => {
    expect(validateSaveVisualMediaRequest({ entry: mediaEntry() })?.entry.id).toBe("media-prueba");
    expect(validateSaveVisualMediaRequest({ entry: { id: "incompleto" } })).toBeNull();
  });
});
