import { contextBridge, ipcRenderer } from "electron";
import type { AsrProfile, AsrResult, AsrStartRequest, AsrStartResult, DefaultAudioSourceInfo, ExportRequest, ImportVisualMediaRequest, MediaEntryResult, MediaIdRequest, MediaLibraryListResult, MediaLibraryStatus, MediaUrlResult, OperationResult, OverlayState, ResidentCommand, ResidentPreferences, ResidentPreferencesResult, ResidentServiceState, SaveVisualMediaRequest, SenaLscApi, SidecarStatus } from "../shared/types";

// El preload sandboxed mantiene su lista cerrada sin cargar módulos locales en runtime.
const IPC_CHANNEL = {
  STATUS_GET: "asr:status:get",
  STATUS_CHANGED: "asr:status:changed",
  ASR_START: "asr:start",
  ASR_AUDIO: "asr:audio",
  ASR_STOP: "asr:stop",
  ASR_RESULT: "asr:result",
  AUDIO_DEFAULT_SOURCE: "audio:default-source",
  OVERLAY_UPDATE: "overlay:update",
  OVERLAY_STATE: "overlay:state",
  OVERLAY_GET_STATE: "overlay:get-state",
  OVERLAY_PLAYLIST_ADVANCE: "overlay:playlist:advance",
  RESIDENT_PREFERENCES_GET: "resident:preferences:get",
  RESIDENT_PREFERENCES_SET: "resident:preferences:set",
  RESIDENT_PREFERENCES_CHANGED: "resident:preferences:changed",
  RESIDENT_STATE_UPDATE: "resident:state:update",
  RESIDENT_COMMAND: "resident:command",
  MAIN_WINDOW_HIDE: "main-window:hide",
  TRANSCRIPT_EXPORT: "transcript:export",
  MEDIA_LIST: "media:list",
  MEDIA_STATUS: "media:status",
  MEDIA_IMPORT: "media:import",
  MEDIA_SAVE: "media:save",
  MEDIA_DELETE: "media:delete",
  MEDIA_URL: "media:url",
} as const;

const SIDECAR_LIFECYCLE = {
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  ERROR: "error",
} as const;

const ASR_PROFILE = { LIGHT: "light", PRECISE: "precise" } as const;
const ASR_LANGUAGE_MODE = { DYNAMIC_GRAMMAR: "dynamic-grammar", OPEN_ALTERNATIVES: "open-alternatives", UNKNOWN: "unknown" } as const;
const ASR_ENDPOINTING_MODE = { API: "api", MODEL_CONFIG: "model-config", UNKNOWN: "unknown" } as const;

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseAsrStartResult(value: unknown): AsrStartResult | null {
  if (!isObject(value) || typeof value.ok !== "boolean" || typeof value.message !== "string") return null;
  if (value.ok && isSessionId(value.sessionId)) return { ok: true, message: value.message, sessionId: value.sessionId };
  if (!value.ok && value.sessionId === null) return { ok: false, message: value.message, sessionId: null };
  return null;
}

function parseAsrResult(value: unknown): AsrResult | null {
  if (!isObject(value) || (value.kind !== "partial" && value.kind !== "final")) return null;
  if (typeof value.text !== "string" || value.text.length > 8_000 || !isSessionId(value.sessionId)) return null;
  if (value.firstAudioAtMs !== null && typeof value.firstAudioAtMs !== "number") return null;
  if (typeof value.resultAtMs !== "number" || (value.latencyMs !== null && typeof value.latencyMs !== "number")) return null;
  if ((value.endpointLatencyMs !== null && typeof value.endpointLatencyMs !== "number") || (value.cpuTimeMs !== null && typeof value.cpuTimeMs !== "number")) return null;
  if (typeof value.segmentDurationMs !== "number" || (value.confidence !== null && typeof value.confidence !== "number")) return null;
  if (value.cause !== "partial" && value.cause !== "endpoint" && value.cause !== "stop-flush") return null;
  return value as unknown as AsrResult;
}

function parseSidecarStatus(value: unknown): SidecarStatus | null {
  if (!isObject(value)) return null;
  const sessionId = value.sessionId === null ? null : (isSessionId(value.sessionId) ? value.sessionId : undefined);
  const ownerSessionId = value.ownerSessionId === null ? null : (isSessionId(value.ownerSessionId) ? value.ownerSessionId : undefined);
  if (sessionId === undefined || ownerSessionId === undefined) return null;
  if (!Object.values(SIDECAR_LIFECYCLE).includes(value.lifecycle as never)) return null;
  if (
    typeof value.processRunning !== "boolean" || typeof value.pythonAvailable !== "boolean" ||
    typeof value.voskAvailable !== "boolean" || typeof value.modelAvailable !== "boolean" ||
    typeof value.ready !== "boolean" || typeof value.audioSaturated !== "boolean" ||
    typeof value.audioSentMs !== "number" || value.audioSentMs < 0 ||
    typeof value.audioPendingMs !== "number" || value.audioPendingMs < 0 ||
    typeof value.audioBlocksSent !== "number" || !Number.isSafeInteger(value.audioBlocksSent) || value.audioBlocksSent < 0 ||
    typeof value.maximumQueueMs !== "number" || value.maximumQueueMs < 0 ||
    typeof value.audioOverflows !== "number" || !Number.isSafeInteger(value.audioOverflows) || value.audioOverflows < 0 ||
    (value.firstPartialLatencyMs !== null && typeof value.firstPartialLatencyMs !== "number") ||
    (value.lastFinalLatencyMs !== null && typeof value.lastFinalLatencyMs !== "number") ||
    (value.endpointFinalLatencyMs !== null && typeof value.endpointFinalLatencyMs !== "number") ||
    (value.cpuTimeMs !== null && typeof value.cpuTimeMs !== "number") ||
    typeof value.modelPath !== "string" || typeof value.message !== "string" ||
    !Object.values(ASR_PROFILE).includes(value.requestedProfile as never) ||
    !Object.values(ASR_PROFILE).includes(value.activeProfile as never) ||
    typeof value.modelName !== "string" || (value.fallbackReason !== null && typeof value.fallbackReason !== "string") ||
    !Object.values(ASR_LANGUAGE_MODE).includes(value.languageMode as never) ||
    !Object.values(ASR_ENDPOINTING_MODE).includes(value.endpointingMode as never) || typeof value.endpointingMessage !== "string"
  ) return null;
  const activeLifecycle = value.lifecycle === SIDECAR_LIFECYCLE.STARTING || value.lifecycle === SIDECAR_LIFECYCLE.RUNNING || value.lifecycle === SIDECAR_LIFECYCLE.STOPPING;
  if (activeLifecycle && (sessionId === null || ownerSessionId !== sessionId)) return null;
  if (!activeLifecycle && sessionId !== null) return null;
  if (value.lifecycle === SIDECAR_LIFECYCLE.ERROR && ownerSessionId === null) return null;
  return value as unknown as SidecarStatus;
}

function parseOperationResult(value: unknown): OperationResult | null {
  return isObject(value) && typeof value.ok === "boolean" && typeof value.message === "string"
    ? { ok: value.ok, message: value.message }
    : null;
}

function parseMediaEntryResult(value: unknown): MediaEntryResult | null {
  const operation = parseOperationResult(value);
  if (!operation || !isObject(value) || !("entry" in value)) return null;
  if (value.entry !== null && (!isObject(value.entry) || typeof value.entry.id !== "string" || !isObject(value.entry.media))) return null;
  return value as unknown as MediaEntryResult;
}

function parseMediaUrlResult(value: unknown): MediaUrlResult | null {
  const operation = parseOperationResult(value);
  if (!operation || !isObject(value) || (value.url !== null && (typeof value.url !== "string" || !value.url.startsWith("senalsc-media://media/")))) return null;
  return { ...operation, url: value.url };
}

function parseMediaList(value: unknown): MediaLibraryListResult | null {
  if (!isObject(value) || !Array.isArray(value.entries) || !isObject(value.status)) return null;
  if (!value.entries.every((entry) => isObject(entry) && typeof entry.id === "string" && isObject(entry.media))) return null;
  if (typeof value.status.importAvailable !== "boolean" || typeof value.status.demoDistribution !== "boolean") return null;
  return value as unknown as MediaLibraryListResult;
}

function parseMediaStatus(value: unknown): MediaLibraryStatus | null {
  if (!isObject(value)) return null;
  if (typeof value.importAvailable !== "boolean" || typeof value.demoDistribution !== "boolean") return null;
  if (typeof value.imageLimitBytes !== "number" || typeof value.videoLimitBytes !== "number" || typeof value.message !== "string") return null;
  return value as unknown as MediaLibraryStatus;
}

function subscribeAsrResults(listener: (value: AsrResult) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
    const result = parseAsrResult(value);
    if (result) listener(result);
  };
  ipcRenderer.on(IPC_CHANNEL.ASR_RESULT, wrapped);
  return () => ipcRenderer.removeListener(IPC_CHANNEL.ASR_RESULT, wrapped);
}

const api: SenaLscApi = {
  getSidecarStatus: async (profile: AsrProfile): Promise<SidecarStatus> => {
    const status = parseSidecarStatus(await ipcRenderer.invoke(IPC_CHANNEL.STATUS_GET, profile));
    if (!status) throw new Error("El proceso principal devolvió un estado ASR no válido.");
    return status;
  },
  startAsr: async (request: AsrStartRequest): Promise<AsrStartResult> => {
    const result = parseAsrStartResult(await ipcRenderer.invoke(IPC_CHANNEL.ASR_START, request));
    if (!result) throw new Error("El proceso principal devolvió una sesión ASR no válida.");
    return result;
  },
  sendAudio: (audio: ArrayBuffer) => ipcRenderer.send(IPC_CHANNEL.ASR_AUDIO, new Uint8Array(audio)),
  stopAsr: async () => parseOperationResult(await ipcRenderer.invoke(IPC_CHANNEL.ASR_STOP)) ?? { ok: false, message: "Respuesta IPC no válida." },
  getDefaultAudioSource: async (): Promise<DefaultAudioSourceInfo> => {
    const result = await ipcRenderer.invoke(IPC_CHANNEL.AUDIO_DEFAULT_SOURCE) as unknown;
    if (!isObject(result) || typeof result.isWoMic !== "boolean" || Object.keys(result).length !== 1) throw new Error("El proceso principal devolvió una fuente de audio no válida.");
    return { isWoMic: result.isWoMic };
  },
  updateOverlay: (state: OverlayState) => ipcRenderer.send(IPC_CHANNEL.OVERLAY_UPDATE, state),
  getOverlayState: () => ipcRenderer.invoke(IPC_CHANNEL.OVERLAY_GET_STATE) as Promise<OverlayState | null>,
  advanceOverlayPlaylist: () => ipcRenderer.send(IPC_CHANNEL.OVERLAY_PLAYLIST_ADVANCE),
  getResidentPreferences: () => ipcRenderer.invoke(IPC_CHANNEL.RESIDENT_PREFERENCES_GET) as Promise<ResidentPreferencesResult>,
  setResidentPreferences: (preferences: ResidentPreferences) => ipcRenderer.invoke(IPC_CHANNEL.RESIDENT_PREFERENCES_SET, preferences) as Promise<ResidentPreferencesResult>,
  reportResidentState: (state: ResidentServiceState) => ipcRenderer.send(IPC_CHANNEL.RESIDENT_STATE_UPDATE, state),
  hideMainWindow: () => ipcRenderer.send(IPC_CHANNEL.MAIN_WINDOW_HIDE),
  exportTranscript: async (request: ExportRequest) => parseOperationResult(await ipcRenderer.invoke(IPC_CHANNEL.TRANSCRIPT_EXPORT, request)) ?? { ok: false, message: "Respuesta IPC no válida." },
  listVisualMedia: async () => {
    const result = parseMediaList(await ipcRenderer.invoke(IPC_CHANNEL.MEDIA_LIST));
    if (!result) throw new Error("El proceso principal devolvió una biblioteca visual no válida.");
    return result;
  },
  getVisualMediaStatus: async () => {
    const status = parseMediaStatus(await ipcRenderer.invoke(IPC_CHANNEL.MEDIA_STATUS));
    if (!status) throw new Error("El proceso principal devolvió un estado multimedia no válido.");
    return status;
  },
  importVisualMedia: async (request: ImportVisualMediaRequest) => parseMediaEntryResult(await ipcRenderer.invoke(IPC_CHANNEL.MEDIA_IMPORT, request)) ?? { ok: false, message: "Respuesta IPC no válida.", entry: null },
  saveVisualMedia: async (request: SaveVisualMediaRequest) => parseMediaEntryResult(await ipcRenderer.invoke(IPC_CHANNEL.MEDIA_SAVE, request)) ?? { ok: false, message: "Respuesta IPC no válida.", entry: null },
  deleteVisualMedia: async (request: MediaIdRequest) => parseOperationResult(await ipcRenderer.invoke(IPC_CHANNEL.MEDIA_DELETE, request)) ?? { ok: false, message: "Respuesta IPC no válida." },
  getVisualMediaUrl: async (request: MediaIdRequest) => parseMediaUrlResult(await ipcRenderer.invoke(IPC_CHANNEL.MEDIA_URL, request)) ?? { ok: false, message: "Respuesta IPC no válida.", url: null },
  onAsrResult: subscribeAsrResults,
  onSidecarStatus: (listener: (status: SidecarStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const status = parseSidecarStatus(value);
      if (status) listener(status);
    };
    ipcRenderer.on(IPC_CHANNEL.STATUS_CHANGED, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNEL.STATUS_CHANGED, wrapped);
  },
  onOverlayState: (listener: (state: OverlayState) => void) => subscribe(IPC_CHANNEL.OVERLAY_STATE, listener),
  onOverlayPlaylistAdvance: (listener: () => void) => subscribe(IPC_CHANNEL.OVERLAY_PLAYLIST_ADVANCE, listener),
  onResidentCommand: (listener: (command: ResidentCommand) => void) => subscribe(IPC_CHANNEL.RESIDENT_COMMAND, listener),
  onResidentPreferences: (listener: (preferences: ResidentPreferencesResult) => void) => subscribe(IPC_CHANNEL.RESIDENT_PREFERENCES_CHANGED, listener),
};

contextBridge.exposeInMainWorld("senaLsc", api);
