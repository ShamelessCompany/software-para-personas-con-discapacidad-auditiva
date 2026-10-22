import { describe, expect, it } from "vitest";
import { CAPTION_POSITION, LISTENING_STATE, type AppSettings, type ResidentPreferences, type ResidentServiceState } from "../src/shared/types";
import { calculateOverlayBounds, residentMenuPresentation, resolveResidentVisibility, shouldHideOnClose } from "../src/main/resident-shell";

const preferences: ResidentPreferences = { captionsVisible: true, visualSupportVisible: true, launchAtLogin: false };
const geometry: Pick<AppSettings, "captionPosition" | "captionWidth" | "captionHeight" | "captionFloatingY"> = { captionPosition: CAPTION_POSITION.BOTTOM, captionWidth: 920, captionHeight: 128, captionFloatingY: 0.62 };

function serviceState(listeningState: ResidentServiceState["listeningState"], transitioning = false): ResidentServiceState {
  return { listeningState, transitioning, demoMode: false };
}

describe("utilidad residente", () => {
  it("oculta la configuración al cerrar y permite el cierre explícito", () => {
    expect(shouldHideOnClose(false)).toBe(true);
    expect(shouldHideOnClose(true)).toBe(false);
  });

  it("mueve la barra flotante desde la app principal sin habilitar interacción en el overlay", () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const upper = calculateOverlayBounds(workArea, { ...geometry, captionPosition: CAPTION_POSITION.FLOATING, captionFloatingY: 0.2 });
    const lower = calculateOverlayBounds(workArea, { ...geometry, captionPosition: CAPTION_POSITION.FLOATING, captionFloatingY: 0.8 });
    expect(lower.captions.y).toBeGreaterThan(upper.captions.y);
    expect(lower.captions.x).toBe(upper.captions.x);
  });

  it("presenta estado y acción coherentes en la bandeja", () => {
    expect(residentMenuPresentation(serviceState(LISTENING_STATE.IDLE))).toEqual({
      status: "Estado: en espera",
      listeningAction: "Iniciar subtítulos",
      actionEnabled: true,
    });
    expect(residentMenuPresentation(serviceState(LISTENING_STATE.LISTENING, true))).toEqual({
      status: "Estado: preparando escucha",
      listeningAction: "Detener subtítulos",
      actionEnabled: false,
    });
  });

  it("mantiene ambos overlays dentro del área de trabajo", () => {
    const workArea = { x: 100, y: 50, width: 1366, height: 728 };
    const bounds = calculateOverlayBounds(workArea, geometry);
    for (const value of [bounds.captions, bounds.visualSupport]) {
      expect(value.x).toBeGreaterThanOrEqual(workArea.x);
      expect(value.y).toBeGreaterThanOrEqual(workArea.y);
      expect(value.x + value.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(value.y + value.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }
    expect(bounds.captions.y).toBeGreaterThan(bounds.visualSupport.y);
    expect(bounds.visualSupport.y + bounds.visualSupport.height).toBeLessThanOrEqual(bounds.captions.y);
  });

  it.each([
    [{ x: 0, y: 0, width: 1280, height: 680 }, 1, CAPTION_POSITION.TOP],
    [{ x: 1920, y: 0, width: 1366, height: 728 }, 1.25, CAPTION_POSITION.BOTTOM],
    [{ x: 0, y: 40, width: 1920, height: 1040 }, 2, CAPTION_POSITION.FLOATING],
  ] as const)("calcula geometría determinista dentro de %j a DPI %s en %s", (workArea, scaleFactor, captionPosition) => {
    const bounds = calculateOverlayBounds(workArea, { ...geometry, captionPosition }, scaleFactor);
    for (const value of [bounds.captions, bounds.visualSupport]) {
      expect(value.x).toBeGreaterThanOrEqual(workArea.x);
      expect(value.y).toBeGreaterThanOrEqual(workArea.y);
      expect(value.x + value.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(value.y + value.height).toBeLessThanOrEqual(workArea.y + workArea.height);
      expect(value.width).toBeGreaterThan(0);
      expect(value.height).toBeGreaterThan(0);
    }
    expect(bounds.visualSupport.width).toBeGreaterThanOrEqual(240);
    expect(bounds.visualSupport.width).toBeLessThanOrEqual(360);
    expect(bounds.visualSupport.x).toBeGreaterThan(bounds.captions.x);
    if (captionPosition === CAPTION_POSITION.TOP) expect(bounds.visualSupport.y).toBeGreaterThan(bounds.captions.y + bounds.captions.height);
  });

  it("muestra captions solo con servicio activo y apoyo solo con medio", () => {
    expect(resolveResidentVisibility(serviceState(LISTENING_STATE.IDLE), preferences, true)).toEqual({ captions: false, visualSupport: false });
    expect(resolveResidentVisibility(serviceState(LISTENING_STATE.LISTENING), preferences, false)).toEqual({ captions: true, visualSupport: false });
    expect(resolveResidentVisibility(serviceState(LISTENING_STATE.LISTENING), preferences, true)).toEqual({ captions: true, visualSupport: true });
    expect(resolveResidentVisibility(serviceState(LISTENING_STATE.LISTENING), { ...preferences, captionsVisible: false }, true).captions).toBe(false);
  });
});
