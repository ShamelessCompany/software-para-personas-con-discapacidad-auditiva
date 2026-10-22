export const LISTENING_STATE = {
  IDLE: "idle",
  STARTING: "starting",
  LISTENING: "listening",
  PAUSED: "paused",
  ERROR: "error",
} as const;

export type ListeningState = (typeof LISTENING_STATE)[keyof typeof LISTENING_STATE];

export const MEDIA_STATUS = {
  ACADEMIC: "academic",
  COMMUNITY: "community",
  PENDING: "pending",
  VALIDATED: "validated",
} as const;

export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS];

export const MEDIA_KIND = {
  IMAGE: "image",
  VIDEO: "video",
} as const;

export type MediaKind = (typeof MEDIA_KIND)[keyof typeof MEDIA_KIND];

export const MEDIA_SOURCE = {
  BUNDLED: "bundled",
  IMPORTED: "imported",
} as const;

export type MediaSource = (typeof MEDIA_SOURCE)[keyof typeof MEDIA_SOURCE];

export const MEDIA_MATCH_KIND = {
  EXACT_PHRASE: "exact-phrase",
  PHRASE: "phrase",
  KEYWORD: "keyword",
  MANUAL: "manual",
  SPELLING: "spelling",
} as const;

export type MediaMatchKind = (typeof MEDIA_MATCH_KIND)[keyof typeof MEDIA_MATCH_KIND];

export const EXPORT_FORMAT = {
  TEXT: "txt",
  JSON: "json",
} as const;

export type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

export const SIDECAR_LIFECYCLE = {
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  ERROR: "error",
} as const;

export type SidecarLifecycle = (typeof SIDECAR_LIFECYCLE)[keyof typeof SIDECAR_LIFECYCLE];

export const ASR_PROFILE = {
  LIGHT: "light",
  PRECISE: "precise",
} as const;

export type AsrProfile = (typeof ASR_PROFILE)[keyof typeof ASR_PROFILE];

export const ASR_LANGUAGE_MODE = {
  DYNAMIC_GRAMMAR: "dynamic-grammar",
  OPEN_ALTERNATIVES: "open-alternatives",
  UNKNOWN: "unknown",
} as const;

export type AsrLanguageMode = (typeof ASR_LANGUAGE_MODE)[keyof typeof ASR_LANGUAGE_MODE];

export const ASR_ENDPOINTING_MODE = {
  API: "api",
  MODEL_CONFIG: "model-config",
  UNKNOWN: "unknown",
} as const;

export type AsrEndpointingMode = (typeof ASR_ENDPOINTING_MODE)[keyof typeof ASR_ENDPOINTING_MODE];

export const CAPTION_POSITION = {
  TOP: "top",
  BOTTOM: "bottom",
  FLOATING: "floating",
} as const;

export type CaptionPosition = (typeof CAPTION_POSITION)[keyof typeof CAPTION_POSITION];

export const RESIDENT_COMMAND = {
  TOGGLE_LISTENING: "toggle-listening",
} as const;

export type ResidentCommand = (typeof RESIDENT_COMMAND)[keyof typeof RESIDENT_COMMAND];

export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: string;
  source: "asr" | "demo";
}

export interface MediaValidation {
  validators: string[];
  notes: string;
  validatedAt: string | null;
}

export interface MediaAuthorization {
  license: string;
  authorizationReference: string;
}

export interface VisualMediaDescriptor {
  kind: MediaKind;
  source: MediaSource;
  uri: string;
  mimeType: string;
  altText: string;
  durationMs?: number;
}

export interface VisualLibraryEntry {
  id: string;
  label: string;
  phrases: string[];
  keywords: string[];
  context: string;
  region: string;
  status: MediaStatus;
  validation: MediaValidation;
  authorization: MediaAuthorization;
  media: VisualMediaDescriptor;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaMatchReason {
  kind: MediaMatchKind;
  term: string;
  recognizedText: string;
  isFinal: boolean;
}

export interface ActiveVisualMedia {
  entry: VisualLibraryEntry;
  mediaUrl: string;
  playlist: VisualMediaPlaylistItem[];
  playlistIndex: number;
  presentationText: string;
  badgeLabel: string | null;
  match: MediaMatchReason;
  playbackKey: number;
  activatedAt: number;
  expiresAt: number;
  held: boolean;
}

export interface VisualMediaPlaylistItem {
  entry: VisualLibraryEntry;
  mediaUrl: string;
}

export interface VisualMediaDraft {
  label: string;
  phrases: string[];
  keywords: string[];
  context: string;
  region: string;
  status: MediaStatus;
  validators: string[];
  validationNotes: string;
  license: string;
  authorizationReference: string;
  altText: string;
}

export interface ImportVisualMediaRequest {
  draft: VisualMediaDraft;
}

export interface SaveVisualMediaRequest {
  entry: VisualLibraryEntry;
}

export interface MediaIdRequest {
  id: string;
}

export interface MediaLibraryStatus {
  importAvailable: boolean;
  demoDistribution: boolean;
  imageLimitBytes: number;
  videoLimitBytes: number;
  message: string;
}

export interface MediaLibraryListResult {
  entries: VisualLibraryEntry[];
  status: MediaLibraryStatus;
}

export interface MediaEntryResult extends OperationResult {
  entry: VisualLibraryEntry | null;
}

export interface MediaUrlResult extends OperationResult {
  url: string | null;
}

export interface AppSettings {
  fontSize: number;
  captionPosition: CaptionPosition;
  captionWidth: number;
  captionHeight: number;
  captionFloatingY: number;
  highContrast: boolean;
  maxLines: 2;
  showVisualSupport: boolean;
  unifiedLscLibrary: boolean;
  includeCommunityContent: boolean;
  technicalSpelling: boolean;
  asrProfile: AsrProfile;
  clipSpeed: number;
  visualDurationMs: number;
}

export interface SidecarStatus {
  sessionId: number | null;
  ownerSessionId: number | null;
  lifecycle: SidecarLifecycle;
  processRunning: boolean;
  pythonAvailable: boolean;
  voskAvailable: boolean;
  modelAvailable: boolean;
  ready: boolean;
  audioSaturated: boolean;
  audioSentMs: number;
  audioPendingMs: number;
  audioBlocksSent: number;
  maximumQueueMs: number;
  audioOverflows: number;
  firstPartialLatencyMs: number | null;
  lastFinalLatencyMs: number | null;
  endpointFinalLatencyMs: number | null;
  cpuTimeMs: number | null;
  modelPath: string;
  requestedProfile: AsrProfile;
  activeProfile: AsrProfile;
  modelName: string;
  fallbackReason: string | null;
  languageMode: AsrLanguageMode;
  endpointingMode: AsrEndpointingMode;
  endpointingMessage: string;
  message: string;
}

export interface AsrStartRequest {
  profile: AsrProfile;
  sampleRate: 16000;
}

export interface AsrResult {
  kind: "partial" | "final";
  text: string;
  sessionId: number;
  firstAudioAtMs: number | null;
  resultAtMs: number;
  latencyMs: number | null;
  endpointLatencyMs: number | null;
  cpuTimeMs: number | null;
  segmentDurationMs: number;
  confidence: number | null;
  cause: "partial" | "endpoint" | "stop-flush";
}

export interface OperationResult {
  ok: boolean;
  message: string;
}

export interface AsrStartResult extends OperationResult {
  sessionId: number | null;
}

export interface ExportRequest {
  format: ExportFormat;
  entries: TranscriptEntry[];
}

export interface OverlayState {
  livePartial: string;
  confirmedPhrase: TranscriptEntry | null;
  confirmedExpiresAt: number | null;
  demoMode: boolean;
  contentSource: TranscriptEntry["source"] | null;
  listeningState: ListeningState;
  microphoneLabel: string;
  settings: AppSettings;
  activeMedia: ActiveVisualMedia | null;
  mediaError: string | null;
}

export interface ResidentPreferences {
  captionsVisible: boolean;
  visualSupportVisible: boolean;
  launchAtLogin: boolean;
}

export interface ResidentPreferencesResult {
  preferences: ResidentPreferences;
  launchAtLoginAvailable: boolean;
}

export interface ResidentServiceState {
  listeningState: ListeningState;
  demoMode: boolean;
  transitioning: boolean;
}

export interface DefaultAudioSourceInfo {
  isWoMic: boolean;
}

export interface SenaLscApi {
  getSidecarStatus: (profile: AsrProfile) => Promise<SidecarStatus>;
  startAsr: (request: AsrStartRequest) => Promise<AsrStartResult>;
  sendAudio: (audio: ArrayBuffer) => void;
  stopAsr: () => Promise<OperationResult>;
  getDefaultAudioSource: () => Promise<DefaultAudioSourceInfo>;
  updateOverlay: (state: OverlayState) => void;
  getOverlayState: () => Promise<OverlayState | null>;
  advanceOverlayPlaylist: () => void;
  getResidentPreferences: () => Promise<ResidentPreferencesResult>;
  setResidentPreferences: (preferences: ResidentPreferences) => Promise<ResidentPreferencesResult>;
  reportResidentState: (state: ResidentServiceState) => void;
  hideMainWindow: () => void;
  exportTranscript: (request: ExportRequest) => Promise<OperationResult>;
  listVisualMedia: () => Promise<MediaLibraryListResult>;
  getVisualMediaStatus: () => Promise<MediaLibraryStatus>;
  importVisualMedia: (request: ImportVisualMediaRequest) => Promise<MediaEntryResult>;
  saveVisualMedia: (request: SaveVisualMediaRequest) => Promise<MediaEntryResult>;
  deleteVisualMedia: (request: MediaIdRequest) => Promise<OperationResult>;
  getVisualMediaUrl: (request: MediaIdRequest) => Promise<MediaUrlResult>;
  onAsrResult: (listener: (result: AsrResult) => void) => () => void;
  onSidecarStatus: (listener: (status: SidecarStatus) => void) => () => void;
  onOverlayState: (listener: (state: OverlayState) => void) => () => void;
  onOverlayPlaylistAdvance: (listener: () => void) => () => void;
  onResidentCommand: (listener: (command: ResidentCommand) => void) => () => void;
  onResidentPreferences: (listener: (preferences: ResidentPreferencesResult) => void) => () => void;
}
