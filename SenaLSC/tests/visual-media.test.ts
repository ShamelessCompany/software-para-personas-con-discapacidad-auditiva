import { describe, expect, it } from "vitest";
import { mediaErrorMessage, mediaStatusLabel } from "../src/renderer/components/VisualMedia";
import { presentOverlay } from "../src/shared/overlay-presentation";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { LISTENING_STATE, MEDIA_KIND, MEDIA_SOURCE, MEDIA_STATUS, type OverlayState, type VisualLibraryEntry } from "../src/shared/types";

const OVERLAY_CONTEXT = { listeningState: LISTENING_STATE.LISTENING, microphoneLabel: "Micrófono de prueba" } as const;

function entry(kind: VisualLibraryEntry["media"]["kind"]): VisualLibraryEntry {
  return {
    id: `media-${kind}`,
    label: "Medio",
    phrases: ["frase"],
    keywords: [],
    context: "Aula",
    region: "Bogotá",
    status: MEDIA_STATUS.PENDING,
    validation: { validators: [], notes: "", validatedAt: null },
    authorization: { license: "", authorizationReference: "" },
    media: { kind, source: MEDIA_SOURCE.IMPORTED, uri: kind === MEDIA_KIND.IMAGE ? "medio.png" : "medio.mp4", mimeType: kind === MEDIA_KIND.IMAGE ? "image/png" : "video/mp4", altText: "Medio de prueba" },
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("errores de medio", () => {
  it("explica errores de imagen y códec de video", () => {
    expect(mediaErrorMessage(entry(MEDIA_KIND.IMAGE))).toContain("imagen");
    expect(mediaErrorMessage(entry(MEDIA_KIND.VIDEO))).toContain("códec");
  });

  it("conserva el subtítulo cuando falla el medio", () => {
    const state: OverlayState = {
      livePartial: "",
      confirmedPhrase: { id: "1", text: "Presten atención", timestamp: "2026-01-01T00:00:00.000Z", source: "asr" },
      confirmedExpiresAt: 10_000,
      demoMode: false,
      contentSource: "asr",
      ...OVERLAY_CONTEXT,
      settings: DEFAULT_SETTINGS,
      activeMedia: null,
      mediaError: "No cargó",
    };
    expect(presentOverlay(state, null, 5_000)).toEqual({ finalText: "Presten atención", captionText: "Presten atención", mediaError: "No cargó" });
    expect(presentOverlay(state, null, 10_000).captionText).toBe("");
  });

  it("prioriza habla nueva y expira una frase confirmada con reloj controlado", () => {
    const base: OverlayState = {
      livePartial: "",
      confirmedPhrase: { id: "1", text: "frase anterior", timestamp: "2026-01-01T00:00:00.000Z", source: "asr" },
      confirmedExpiresAt: 3_500,
      demoMode: false,
      contentSource: "asr",
      ...OVERLAY_CONTEXT,
      settings: DEFAULT_SETTINGS,
      activeMedia: null,
      mediaError: null,
    };
    expect(presentOverlay(base, null, 3_499).captionText).toBe("frase anterior");
    expect(presentOverlay({ ...base, livePartial: "habla nueva en curso" }, null, 2_000).captionText).toBe("habla nueva en curso");
    expect(presentOverlay(base, null, 3_500).captionText).toBe("");
  });

  it("rotula LSC50 como fuente académica y no como validado", () => {
    const academic = entry(MEDIA_KIND.VIDEO);
    academic.status = MEDIA_STATUS.ACADEMIC;
    expect(mediaStatusLabel(academic)).toBe("FUENTE ACADÉMICA · LSC50");
    expect(mediaStatusLabel(academic)).not.toContain("VALIDADO");
  });

  it("rotula UniValle con el badge académico exacto", () => {
    const academic = entry(MEDIA_KIND.VIDEO);
    academic.id = "univalle-01";
    academic.status = MEDIA_STATUS.ACADEMIC;
    expect(mediaStatusLabel(academic)).toBe("FUENTE ACADÉMICA · UNIVALLE");
  });

  it("rotula EXPRESA como comunitario y no como validado", () => {
    const community = entry(MEDIA_KIND.VIDEO);
    community.id = "expresa-tecnologia-computador";
    community.status = MEDIA_STATUS.COMMUNITY;
    expect(mediaStatusLabel(community)).toBe("LSC COMUNITARIA · EXPRESA");
    expect(mediaStatusLabel(community)).not.toContain("VALIDADO");
  });

  it("fija el texto asociado mientras el medio sigue activo", () => {
    const mediaEntry = entry(MEDIA_KIND.VIDEO);
    const mediaUrl = "senalsc-media://media/media-video";
    const state: OverlayState = {
      livePartial: "un parcial nuevo",
      confirmedPhrase: { id: "1", text: "Python", timestamp: "2026-01-01T00:00:00.000Z", source: "asr" },
      confirmedExpiresAt: 100,
      demoMode: false,
      contentSource: "asr",
      ...OVERLAY_CONTEXT,
      settings: DEFAULT_SETTINGS,
      activeMedia: { entry: mediaEntry, mediaUrl, playlist: [{ entry: mediaEntry, mediaUrl }], playlistIndex: 0, presentationText: "Python", badgeLabel: "DELETREO LSC · TÉRMINO TÉCNICO", match: { kind: "spelling", term: "Python", recognizedText: "usamos Python hoy", isFinal: true }, playbackKey: 1, activatedAt: 1, expiresAt: 100, held: false },
      mediaError: null,
    };
    expect(presentOverlay(state, null).captionText).toBe("Python");
    expect(presentOverlay({ ...state, activeMedia: null }, null).captionText).toBe("un parcial nuevo");
  });
});
