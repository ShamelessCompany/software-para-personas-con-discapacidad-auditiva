import {
  ASR_LANGUAGE_MODE,
  ASR_ENDPOINTING_MODE,
  ASR_PROFILE,
  CAPTION_POSITION,
  EXPORT_FORMAT,
  LISTENING_STATE,
  MEDIA_KIND,
  MEDIA_MATCH_KIND,
  MEDIA_SOURCE,
  MEDIA_STATUS,
  SIDECAR_LIFECYCLE,
  type ActiveVisualMedia,
  type AppSettings,
  type AsrResult,
  type AsrStartRequest,
  type AsrStartResult,
  type ExportRequest,
  type ImportVisualMediaRequest,
  type MediaIdRequest,
  type OverlayState,
  type ResidentPreferences,
  type ResidentServiceState,
  type SaveVisualMediaRequest,
  type SidecarStatus,
  type TranscriptEntry,
  type VisualLibraryEntry,
  type VisualMediaDescriptor,
  type VisualMediaDraft,
} from "./types";

const MAX_AUDIO_BYTES = 256 * 1024;
const MAX_EXPORT_ENTRIES = 50_000;
const MAX_TEXT_LENGTH = 8_000;
const MAX_FIELD_LENGTH = 500;
const MAX_TERMS = 100;
const MEDIA_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,80}$/;
const MEDIA_URI_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,120}$/i;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "video/webm"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(value: unknown, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= MAX_FIELD_LENGTH && (allowEmpty || value.trim().length > 0);
}

function isStringArray(value: unknown, minimum = 0): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= MAX_TERMS
    && value.every((item) => isBoundedString(item, false));
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  return (
    isObject(value)
    && typeof value.id === "string"
    && typeof value.text === "string"
    && value.text.length <= MAX_TEXT_LENGTH
    && typeof value.timestamp === "string"
    && (value.source === "asr" || value.source === "demo")
  );
}

function isAppSettings(value: unknown): value is AppSettings {
  return (
    isObject(value)
    && typeof value.fontSize === "number" && value.fontSize >= 28 && value.fontSize <= 72
    && Object.values(CAPTION_POSITION).includes(value.captionPosition as never)
    && typeof value.captionWidth === "number" && value.captionWidth >= 560 && value.captionWidth <= 1_200
    && typeof value.captionHeight === "number" && value.captionHeight >= 104 && value.captionHeight <= 180
    && typeof value.captionFloatingY === "number" && value.captionFloatingY >= 0.15 && value.captionFloatingY <= 0.85
    && typeof value.highContrast === "boolean"
    && value.maxLines === 2
    && typeof value.showVisualSupport === "boolean"
    && typeof value.unifiedLscLibrary === "boolean"
    && typeof value.includeCommunityContent === "boolean"
    && typeof value.technicalSpelling === "boolean"
    && Object.values(ASR_PROFILE).includes(value.asrProfile as never)
    && typeof value.clipSpeed === "number" && value.clipSpeed >= 0.5 && value.clipSpeed <= 1.5
    && typeof value.visualDurationMs === "number" && value.visualDurationMs >= 8_000 && value.visualDurationMs <= 12_000
  );
}

function isVisualMediaDescriptor(value: unknown): value is VisualMediaDescriptor {
  if (!isObject(value)) return false;
  if (!Object.values(MEDIA_KIND).includes(value.kind as never)) return false;
  if (!Object.values(MEDIA_SOURCE).includes(value.source as never)) return false;
  if (typeof value.uri !== "string" || value.uri.includes("..")) return false;
  const validUri = MEDIA_URI_PATTERN.test(value.uri) || /^(lsc50|univalle)\/[a-z0-9][a-z0-9_.-]{2,120}$/i.test(value.uri) || /^expresa\/[a-z0-9_]+\/[a-z0-9_]+\.mp4$/i.test(value.uri);
  if (!validUri) return false;
  if (typeof value.mimeType !== "string" || !ALLOWED_MIME_TYPES.has(value.mimeType)) return false;
  if (!isBoundedString(value.altText, false)) return false;
  if (value.durationMs !== undefined && (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs <= 0 || value.durationMs > 60 * 60 * 1_000)) return false;
  return value.kind === MEDIA_KIND.IMAGE ? value.mimeType.startsWith("image/") : value.mimeType.startsWith("video/");
}

function hasValidValidationPolicy(value: VisualLibraryEntry | VisualMediaDraft): boolean {
  if (value.status === MEDIA_STATUS.ACADEMIC) {
    return "media" in value
      && value.media.source === MEDIA_SOURCE.BUNDLED
      && value.authorization.license.trim().length > 0
      && value.authorization.authorizationReference.trim().length > 0;
  }
  if (value.status === MEDIA_STATUS.COMMUNITY) {
    return "media" in value
      && value.media.source === MEDIA_SOURCE.BUNDLED
      && value.media.uri.startsWith("expresa/")
      && value.authorization.license.includes("BY-NC-ND")
      && value.authorization.authorizationReference.startsWith("https://archive.org/details/");
  }
  if (value.status !== MEDIA_STATUS.VALIDATED) return true;
  const validators = "validation" in value ? value.validation.validators : value.validators;
  const license = "authorization" in value ? value.authorization.license : value.license;
  const authorizationReference = "authorization" in value ? value.authorization.authorizationReference : value.authorizationReference;
  return license.trim().length > 0
    && authorizationReference.trim().length > 0
    && validators.filter((validator) => validator.trim().length > 0).length >= 2;
}

export function validateVisualLibraryEntry(value: unknown): VisualLibraryEntry | null {
  if (!isObject(value) || typeof value.id !== "string" || !MEDIA_ID_PATTERN.test(value.id)) return null;
  if (!isBoundedString(value.label, false) || !isStringArray(value.phrases, 1) || !isStringArray(value.keywords)) return null;
  if (!isBoundedString(value.context, false) || !isBoundedString(value.region, false)) return null;
  if (!Object.values(MEDIA_STATUS).includes(value.status as never) || !isObject(value.validation)) return null;
  if (!isStringArray(value.validation.validators) || !isBoundedString(value.validation.notes)) return null;
  if (value.validation.validatedAt !== null && !isBoundedString(value.validation.validatedAt, false)) return null;
  if (!isObject(value.authorization) || !isBoundedString(value.authorization.license) || !isBoundedString(value.authorization.authorizationReference)) return null;
  if (!isVisualMediaDescriptor(value.media) || typeof value.enabled !== "boolean") return null;
  if (value.media.mimeType === "image/svg+xml" && value.media.source !== MEDIA_SOURCE.BUNDLED) return null;
  if (!isBoundedString(value.createdAt, false) || !isBoundedString(value.updatedAt, false)) return null;
  const entry = value as unknown as VisualLibraryEntry;
  return hasValidValidationPolicy(entry) ? entry : null;
}

export function validateVisualMediaDraft(value: unknown): VisualMediaDraft | null {
  if (!isObject(value)) return null;
  if (!isBoundedString(value.label, false) || !isStringArray(value.phrases, 1) || !isStringArray(value.keywords)) return null;
  if (!isBoundedString(value.context, false) || !isBoundedString(value.region, false) || !isBoundedString(value.altText, false)) return null;
  if (!Object.values(MEDIA_STATUS).includes(value.status as never) || !isStringArray(value.validators)) return null;
  if (!isBoundedString(value.validationNotes) || !isBoundedString(value.license) || !isBoundedString(value.authorizationReference)) return null;
  const draft = value as unknown as VisualMediaDraft;
  return hasValidValidationPolicy(draft) ? draft : null;
}

export function validateImportVisualMediaRequest(value: unknown): ImportVisualMediaRequest | null {
  if (!isObject(value)) return null;
  const draft = validateVisualMediaDraft(value.draft);
  return draft ? { draft } : null;
}

export function validateSaveVisualMediaRequest(value: unknown): SaveVisualMediaRequest | null {
  if (!isObject(value)) return null;
  const entry = validateVisualLibraryEntry(value.entry);
  return entry ? { entry } : null;
}

export function validateMediaId(value: unknown): string | null {
  return typeof value === "string" && MEDIA_ID_PATTERN.test(value) ? value : null;
}

export function validateMediaIdRequest(value: unknown): MediaIdRequest | null {
  if (!isObject(value)) return null;
  const id = validateMediaId(value.id);
  return id ? { id } : null;
}

function isActiveVisualMedia(value: unknown): value is ActiveVisualMedia {
  if (!isObject(value)) return false;
  const entry = validateVisualLibraryEntry(value.entry);
  if (!entry || typeof value.mediaUrl !== "string" || value.mediaUrl !== `senalsc-media://media/${entry.id}`) return false;
  if (!Array.isArray(value.playlist) || value.playlist.length < 1 || value.playlist.length > 100) return false;
  if (!value.playlist.every((item) => isObject(item) && Boolean(validateVisualLibraryEntry(item.entry)) && item.mediaUrl === `senalsc-media://media/${(item.entry as VisualLibraryEntry).id}`)) return false;
  if (typeof value.playlistIndex !== "number" || !Number.isSafeInteger(value.playlistIndex) || value.playlistIndex < 0 || value.playlistIndex >= value.playlist.length) return false;
  const playlist = value.playlist as unknown[];
  const activeItem: unknown = playlist[value.playlistIndex];
  if (!isObject(activeItem) || !isObject(activeItem.entry) || activeItem.entry.id !== entry.id || activeItem.mediaUrl !== value.mediaUrl) return false;
  if (!isBoundedString(value.presentationText, false) || (value.badgeLabel !== null && !isBoundedString(value.badgeLabel, false))) return false;
  if (!isObject(value.match) || !Object.values(MEDIA_MATCH_KIND).includes(value.match.kind as never)) return false;
  if (!isBoundedString(value.match.term, false) || !isBoundedString(value.match.recognizedText, false) || typeof value.match.isFinal !== "boolean") return false;
  return typeof value.playbackKey === "number" && Number.isSafeInteger(value.playbackKey) && value.playbackKey > 0
    && typeof value.activatedAt === "number" && Number.isFinite(value.activatedAt)
    && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt) && value.expiresAt >= value.activatedAt
    && typeof value.held === "boolean";
}

export function validateSampleRate(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 8_000 && value <= 48_000 ? value : null;
}

export function validateAsrStartRequest(value: unknown): AsrStartRequest | null {
  if (!isObject(value) || value.sampleRate !== 16_000 || !Object.values(ASR_PROFILE).includes(value.profile as never)) return null;
  return { sampleRate: 16_000, profile: value.profile as AsrStartRequest["profile"] };
}

export function validateSessionId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function validateAsrStartResult(value: unknown): AsrStartResult | null {
  if (!isObject(value) || typeof value.ok !== "boolean" || typeof value.message !== "string") return null;
  if (value.ok) {
    const sessionId = validateSessionId(value.sessionId);
    return sessionId === null ? null : { ok: true, message: value.message, sessionId };
  }
  return value.sessionId === null ? { ok: false, message: value.message, sessionId: null } : null;
}

export function validateAsrResult(value: unknown): AsrResult | null {
  if (!isObject(value) || (value.kind !== "partial" && value.kind !== "final")) return null;
  if (typeof value.text !== "string" || value.text.length > MAX_TEXT_LENGTH) return null;
  const sessionId = validateSessionId(value.sessionId);
  if (sessionId === null) return null;
  if (value.firstAudioAtMs !== null && typeof value.firstAudioAtMs !== "number") return null;
  if (typeof value.resultAtMs !== "number" || (value.latencyMs !== null && typeof value.latencyMs !== "number")) return null;
  if ((value.endpointLatencyMs !== null && typeof value.endpointLatencyMs !== "number") || (value.cpuTimeMs !== null && typeof value.cpuTimeMs !== "number")) return null;
  if (typeof value.segmentDurationMs !== "number" || (value.confidence !== null && typeof value.confidence !== "number")) return null;
  if (value.cause !== "partial" && value.cause !== "endpoint" && value.cause !== "stop-flush") return null;
  return value as unknown as AsrResult;
}

export function validateSidecarStatus(value: unknown): SidecarStatus | null {
  if (!isObject(value)) return null;
  const sessionId = value.sessionId === null ? null : validateSessionId(value.sessionId);
  const ownerSessionId = value.ownerSessionId === null ? null : validateSessionId(value.ownerSessionId);
  if (value.sessionId !== null && sessionId === null) return null;
  if (value.ownerSessionId !== null && ownerSessionId === null) return null;
  if (!Object.values(SIDECAR_LIFECYCLE).includes(value.lifecycle as never)) return null;
  if (
    typeof value.processRunning !== "boolean"
    || typeof value.pythonAvailable !== "boolean"
    || typeof value.voskAvailable !== "boolean"
    || typeof value.modelAvailable !== "boolean"
    || typeof value.ready !== "boolean"
    || typeof value.audioSaturated !== "boolean"
    || typeof value.audioSentMs !== "number" || value.audioSentMs < 0
    || typeof value.audioPendingMs !== "number" || value.audioPendingMs < 0
    || typeof value.audioBlocksSent !== "number" || !Number.isSafeInteger(value.audioBlocksSent) || value.audioBlocksSent < 0
    || typeof value.maximumQueueMs !== "number" || value.maximumQueueMs < 0
    || typeof value.audioOverflows !== "number" || !Number.isSafeInteger(value.audioOverflows) || value.audioOverflows < 0
    || (value.firstPartialLatencyMs !== null && typeof value.firstPartialLatencyMs !== "number")
    || (value.lastFinalLatencyMs !== null && typeof value.lastFinalLatencyMs !== "number")
    || (value.endpointFinalLatencyMs !== null && typeof value.endpointFinalLatencyMs !== "number")
    || (value.cpuTimeMs !== null && typeof value.cpuTimeMs !== "number")
    || typeof value.modelPath !== "string"
    || !Object.values(ASR_PROFILE).includes(value.requestedProfile as never)
    || !Object.values(ASR_PROFILE).includes(value.activeProfile as never)
    || typeof value.modelName !== "string"
    || (value.fallbackReason !== null && typeof value.fallbackReason !== "string")
    || !Object.values(ASR_LANGUAGE_MODE).includes(value.languageMode as never)
    || !Object.values(ASR_ENDPOINTING_MODE).includes(value.endpointingMode as never)
    || typeof value.endpointingMessage !== "string"
    || typeof value.message !== "string"
  ) return null;
  const activeLifecycle = value.lifecycle === SIDECAR_LIFECYCLE.STARTING || value.lifecycle === SIDECAR_LIFECYCLE.RUNNING || value.lifecycle === SIDECAR_LIFECYCLE.STOPPING;
  if (activeLifecycle && (sessionId === null || ownerSessionId !== sessionId)) return null;
  if (!activeLifecycle && sessionId !== null) return null;
  if (value.lifecycle === SIDECAR_LIFECYCLE.ERROR && ownerSessionId === null) return null;
  return {
    sessionId,
    ownerSessionId,
    lifecycle: value.lifecycle as SidecarStatus["lifecycle"],
    processRunning: value.processRunning,
    pythonAvailable: value.pythonAvailable,
    voskAvailable: value.voskAvailable,
    modelAvailable: value.modelAvailable,
    ready: value.ready,
    audioSaturated: value.audioSaturated,
    audioSentMs: value.audioSentMs,
    audioPendingMs: value.audioPendingMs,
    audioBlocksSent: value.audioBlocksSent,
    maximumQueueMs: value.maximumQueueMs,
    audioOverflows: value.audioOverflows,
    firstPartialLatencyMs: value.firstPartialLatencyMs,
    lastFinalLatencyMs: value.lastFinalLatencyMs,
    endpointFinalLatencyMs: value.endpointFinalLatencyMs,
    cpuTimeMs: value.cpuTimeMs,
    modelPath: value.modelPath,
    requestedProfile: value.requestedProfile as SidecarStatus["requestedProfile"],
    activeProfile: value.activeProfile as SidecarStatus["activeProfile"],
    modelName: value.modelName,
    fallbackReason: value.fallbackReason,
    languageMode: value.languageMode as SidecarStatus["languageMode"],
    endpointingMode: value.endpointingMode as SidecarStatus["endpointingMode"],
    endpointingMessage: value.endpointingMessage,
    message: value.message,
  };
}

export function validateAudioChunk(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_AUDIO_BYTES ? value : null;
}

export function validateExportRequest(value: unknown): ExportRequest | null {
  if (!isObject(value)) return null;
  if (value.format !== EXPORT_FORMAT.TEXT && value.format !== EXPORT_FORMAT.JSON) return null;
  if (!Array.isArray(value.entries) || value.entries.length > MAX_EXPORT_ENTRIES || !value.entries.every(isTranscriptEntry)) return null;
  return { format: value.format, entries: value.entries };
}

export function validateResidentPreferences(value: unknown): ResidentPreferences | null {
  if (!isObject(value)) return null;
  if (typeof value.captionsVisible !== "boolean" || typeof value.visualSupportVisible !== "boolean" || typeof value.launchAtLogin !== "boolean") return null;
  return {
    captionsVisible: value.captionsVisible,
    visualSupportVisible: value.visualSupportVisible,
    launchAtLogin: value.launchAtLogin,
  };
}

export function validateResidentServiceState(value: unknown): ResidentServiceState | null {
  if (!isObject(value) || !Object.values(LISTENING_STATE).includes(value.listeningState as never)) return null;
  if (typeof value.demoMode !== "boolean" || typeof value.transitioning !== "boolean") return null;
  return { listeningState: value.listeningState as ResidentServiceState["listeningState"], demoMode: value.demoMode, transitioning: value.transitioning };
}

export function isOverlayState(value: unknown): value is OverlayState {
  return (
    isObject(value)
    && typeof value.livePartial === "string"
    && value.livePartial.length <= MAX_TEXT_LENGTH
    && (value.confirmedPhrase === null || isTranscriptEntry(value.confirmedPhrase))
    && (value.confirmedExpiresAt === null || typeof value.confirmedExpiresAt === "number")
    && typeof value.demoMode === "boolean"
    && (value.contentSource === null || value.contentSource === "asr" || value.contentSource === "demo")
    && Object.values(LISTENING_STATE).includes(value.listeningState as never)
    && isBoundedString(value.microphoneLabel)
    && isAppSettings(value.settings)
    && (value.activeMedia === null || isActiveVisualMedia(value.activeMedia))
    && (value.mediaError === null || isBoundedString(value.mediaError, false))
  );
}
