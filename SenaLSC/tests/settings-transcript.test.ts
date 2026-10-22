import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings } from "../src/shared/settings";
import { formatTranscriptText, transcriptReducer, TRANSCRIPT_ACTION } from "../src/shared/transcript";

describe("settings", () => {
  it("limita valores fuera del rango accesible", () => {
    const result = normalizeSettings({ fontSize: 500, clipSpeed: 8, maxLines: 2 });
    expect(result).toMatchObject({ fontSize: 72, captionWidth: 920, captionHeight: 128, captionFloatingY: 0.62, clipSpeed: 1.5, maxLines: 2 });
  });

  it("recupera valores por defecto si el almacenamiento está corrupto", () => {
    expect(loadSettings({ getItem: () => "{" })).toEqual(DEFAULT_SETTINGS);
  });

  it("migra preferencias antiguas sin habilitar contenido comunitario silenciosamente", () => {
    expect(normalizeSettings({ academicLsc50: true })).toMatchObject({ unifiedLscLibrary: true, includeCommunityContent: false });
    expect(normalizeSettings({ academicUnivalle: true })).toMatchObject({ unifiedLscLibrary: true, includeCommunityContent: false });
    expect(normalizeSettings({ communityExpresa: true, technicalSpelling: true })).toMatchObject({ unifiedLscLibrary: true, includeCommunityContent: true, technicalSpelling: true });
  });

  it("migra la geometría del overlay con defaults tipados y limita valores", () => {
    expect(normalizeSettings({ fontSize: 44 })).toMatchObject({ captionPosition: "bottom", captionWidth: 920, captionHeight: 128, captionFloatingY: 0.62, asrProfile: "light" });
    expect(normalizeSettings({ captionPosition: "top", captionWidth: 9_000, captionHeight: 20, captionFloatingY: 2 })).toMatchObject({ captionPosition: "top", captionWidth: 1_200, captionHeight: 104, captionFloatingY: 0.85 });
  });

  it("apaga las subopciones legales al desactivar la biblioteca principal", () => {
    expect(normalizeSettings({ unifiedLscLibrary: false, includeCommunityContent: true, technicalSpelling: true })).toMatchObject({
      unifiedLscLibrary: false,
      includeCommunityContent: false,
      technicalSpelling: false,
    });
  });
});

describe("transcriptReducer", () => {
  it("agrega texto final limpio y permite borrar toda la sesión", () => {
    const state = transcriptReducer([], {
      type: TRANSCRIPT_ACTION.ADD_FINAL,
      entry: { id: "1", text: "  hola clase  ", timestamp: "2026-09-01T00:00:00.000Z", source: "asr" },
    });
    expect(state[0]?.text).toBe("hola clase");
    expect(transcriptReducer(state, { type: TRANSCRIPT_ACTION.CLEAR })).toEqual([]);
  });

  it("ignora resultados vacíos", () => {
    expect(transcriptReducer([], {
      type: TRANSCRIPT_ACTION.ADD_FINAL,
      entry: { id: "1", text: "  ", timestamp: "2026-09-01T00:00:00.000Z", source: "asr" },
    })).toEqual([]);
  });

  it("incluye el origen explícito en TXT", () => {
    const text = formatTranscriptText([
      { id: "1", text: "frase preparada", timestamp: "2026-09-01T00:00:00.000Z", source: "demo" },
      { id: "2", text: "frase reconocida", timestamp: "2026-09-01T00:00:01.000Z", source: "asr" },
    ]);
    expect(text).toContain("[DEMOSTRACIÓN] frase preparada");
    expect(text).toContain("[RECONOCIMIENTO LOCAL] frase reconocida");
  });
});
