import type { OverlayState } from "./types";

export interface OverlayPresentation {
  finalText: string;
  captionText: string;
  mediaError: string | null;
}

export function recentWordWindow(text: string, maximumWords = 18): string {
  return text.trim().split(/\s+/).slice(-maximumWords).join(" ");
}

export function presentOverlay(state: OverlayState, localMediaError: string | null, now = Date.now()): OverlayPresentation {
  const finalText = state.confirmedPhrase && state.confirmedExpiresAt !== null && now < state.confirmedExpiresAt
    ? state.confirmedPhrase.text
    : "";
  return {
    finalText,
    captionText: state.activeMedia?.presentationText || recentWordWindow(state.livePartial) || finalText,
    mediaError: localMediaError ?? state.mediaError,
  };
}
