import type { Rectangle } from "electron";
import { CAPTION_POSITION, LISTENING_STATE, type AppSettings, type ResidentPreferences, type ResidentServiceState } from "../shared/types";

export const DEFAULT_RESIDENT_PREFERENCES: ResidentPreferences = {
  captionsVisible: true,
  visualSupportVisible: true,
  launchAtLogin: false,
};

export interface OverlayBounds {
  captions: Rectangle;
  visualSupport: Rectangle;
}

export interface ResidentVisibility {
  captions: boolean;
  visualSupport: boolean;
}

export interface ResidentMenuPresentation {
  status: string;
  listeningAction: "Iniciar subtítulos" | "Detener subtítulos";
  actionEnabled: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateOverlayBounds(workArea: Rectangle, settings: Pick<AppSettings, "captionPosition" | "captionWidth" | "captionHeight" | "captionFloatingY">, scaleFactor = 1): OverlayBounds {
  const dpiScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const horizontalMargin = clamp(Math.round(workArea.width * 0.018), 20, 28);
  const captionsWidth = clamp(settings.captionWidth, Math.min(560, workArea.width), Math.max(1, workArea.width - horizontalMargin * 2));
  const captionsHeight = clamp(settings.captionHeight, Math.min(104, workArea.height), Math.max(1, Math.min(180, workArea.height - 2 * horizontalMargin)));
  const captionsX = workArea.x + Math.round((workArea.width - captionsWidth) / 2);
  const topY = workArea.y + horizontalMargin;
  const bottomY = workArea.y + workArea.height - captionsHeight - horizontalMargin;
  const floatingY = workArea.y + Math.round((workArea.height - captionsHeight) * settings.captionFloatingY);
  const captionsY = settings.captionPosition === CAPTION_POSITION.TOP
    ? topY
    : settings.captionPosition === CAPTION_POSITION.FLOATING ? floatingY : bottomY;
  // Electron workArea values are DIPs; 280 x 210 remains physically scaled by the display scale factor.
  const visualWidth = clamp(Math.round(280 * Math.min(1, dpiScale)), 240, Math.min(360, Math.max(240, workArea.width - horizontalMargin * 2)));
  const visualHeight = Math.round(visualWidth * 0.75);
  const visualTop = settings.captionPosition === CAPTION_POSITION.TOP
    ? captionsY + captionsHeight + 12
    : workArea.y + horizontalMargin;
  return {
    captions: {
      x: Math.max(workArea.x, captionsX),
      y: clamp(captionsY, workArea.y, workArea.y + workArea.height - captionsHeight),
      width: captionsWidth,
      height: captionsHeight,
    },
    visualSupport: {
      x: Math.max(workArea.x, workArea.x + workArea.width - visualWidth - horizontalMargin),
      y: clamp(visualTop, workArea.y, workArea.y + workArea.height - visualHeight),
      width: visualWidth,
      height: visualHeight,
    },
  };
}

export function isServiceActive(state: ResidentServiceState): boolean {
  return state.listeningState === LISTENING_STATE.LISTENING || state.listeningState === LISTENING_STATE.PAUSED;
}

export function resolveResidentVisibility(
  state: ResidentServiceState,
  preferences: ResidentPreferences,
  hasActiveMedia: boolean,
): ResidentVisibility {
  const active = isServiceActive(state);
  return {
    captions: active && preferences.captionsVisible,
    visualSupport: active && preferences.visualSupportVisible && hasActiveMedia,
  };
}

export function shouldHideOnClose(explicitlyQuitting: boolean): boolean {
  return !explicitlyQuitting;
}

export function residentStatusLabel(state: ResidentServiceState): string {
  if (state.transitioning || state.listeningState === LISTENING_STATE.STARTING) return "Estado: preparando escucha";
  if (state.listeningState === LISTENING_STATE.LISTENING) return state.demoMode ? "Estado: demostración activa" : "Estado: subtítulos activos";
  if (state.listeningState === LISTENING_STATE.PAUSED) return "Estado: escucha pausada";
  if (state.listeningState === LISTENING_STATE.ERROR) return "Estado: requiere atención";
  return "Estado: en espera";
}

export function residentMenuPresentation(state: ResidentServiceState): ResidentMenuPresentation {
  return {
    status: residentStatusLabel(state),
    listeningAction: isServiceActive(state) ? "Detener subtítulos" : "Iniciar subtítulos",
    actionEnabled: !state.transitioning,
  };
}
