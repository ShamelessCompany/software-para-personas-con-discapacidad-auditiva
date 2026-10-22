import { ASR_PROFILE, CAPTION_POSITION, type AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 44,
  captionPosition: CAPTION_POSITION.BOTTOM,
  captionWidth: 920,
  captionHeight: 128,
  captionFloatingY: 0.62,
  highContrast: false,
  maxLines: 2,
  showVisualSupport: true,
  unifiedLscLibrary: false,
  includeCommunityContent: false,
  technicalSpelling: false,
  asrProfile: ASR_PROFILE.LIGHT,
  clipSpeed: 1,
  visualDurationMs: 10_000,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface LegacySettings {
  academicLsc50?: boolean;
  academicUnivalle?: boolean;
  communityExpresa?: boolean;
  spelling?: boolean;
}

export function normalizeSettings(value: Partial<AppSettings> & LegacySettings): AppSettings {
  const legacyLibraryEnabled = Boolean(value.academicLsc50 || value.academicUnivalle || value.communityExpresa || value.spelling);
  const unifiedLscLibrary = Boolean(value.unifiedLscLibrary ?? legacyLibraryEnabled);
  const includeCommunityContent = unifiedLscLibrary && Boolean(value.includeCommunityContent ?? value.communityExpresa ?? false);
  return {
    fontSize: clamp(Number(value.fontSize ?? DEFAULT_SETTINGS.fontSize), 28, 72),
    captionPosition: Object.values(CAPTION_POSITION).includes(value.captionPosition as never)
      ? value.captionPosition as AppSettings["captionPosition"]
      : DEFAULT_SETTINGS.captionPosition,
    captionWidth: Math.round(clamp(Number(value.captionWidth ?? DEFAULT_SETTINGS.captionWidth), 560, 1_200)),
    captionHeight: Math.round(clamp(Number(value.captionHeight ?? DEFAULT_SETTINGS.captionHeight), 104, 180)),
    captionFloatingY: clamp(Number(value.captionFloatingY ?? DEFAULT_SETTINGS.captionFloatingY), 0.15, 0.85),
    highContrast: Boolean(value.highContrast ?? DEFAULT_SETTINGS.highContrast),
    maxLines: 2,
    showVisualSupport: Boolean(value.showVisualSupport ?? DEFAULT_SETTINGS.showVisualSupport),
    unifiedLscLibrary,
    includeCommunityContent,
    technicalSpelling: includeCommunityContent && Boolean(value.technicalSpelling ?? value.spelling ?? DEFAULT_SETTINGS.technicalSpelling),
    asrProfile: Object.values(ASR_PROFILE).includes(value.asrProfile as never)
      ? value.asrProfile as AppSettings["asrProfile"]
      : DEFAULT_SETTINGS.asrProfile,
    clipSpeed: clamp(Number(value.clipSpeed ?? DEFAULT_SETTINGS.clipSpeed), 0.5, 1.5),
    visualDurationMs: clamp(Number(value.visualDurationMs ?? DEFAULT_SETTINGS.visualDurationMs), 8_000, 12_000),
  };
}

export function loadSettings(storage: Pick<Storage, "getItem">): AppSettings {
  try {
    const saved = storage.getItem("senalsc:settings");
    return saved ? normalizeSettings(JSON.parse(saved) as Partial<AppSettings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
