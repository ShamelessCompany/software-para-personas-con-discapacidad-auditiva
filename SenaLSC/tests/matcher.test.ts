import { describe, expect, it } from "vitest";
import { matchVisualMedia, VisualMatchController } from "../src/shared/matcher";
import { MEDIA_KIND, MEDIA_MATCH_KIND, MEDIA_SOURCE, MEDIA_STATUS, type VisualLibraryEntry } from "../src/shared/types";

function entry(overrides: Partial<VisualLibraryEntry> = {}): VisualLibraryEntry {
  return {
    id: "validated-seguridad",
    label: "Seguridad",
    phrases: ["elementos de protección"],
    keywords: ["seguridad"],
    context: "Taller",
    region: "Bogotá",
    status: MEDIA_STATUS.VALIDATED,
    validation: { validators: ["Validador 1", "Validador 2"], notes: "Validado", validatedAt: "2026-01-01T00:00:00.000Z" },
    authorization: { license: "Autorización escrita", authorizationReference: "AUT-1" },
    media: { kind: MEDIA_KIND.IMAGE, source: MEDIA_SOURCE.IMPORTED, uri: "seguridad.png", mimeType: "image/png", altText: "Escena de seguridad" },
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("matchVisualMedia", () => {
  it("prioriza la frase exacta y más larga sobre palabras clave", () => {
    const keyword = entry({ id: "keyword", phrases: ["otra frase"], keywords: ["equipo"] });
    const phrase = entry({ id: "phrase", label: "Trabajo en equipo", phrases: ["trabajo en equipo"], keywords: [] });
    const match = matchVisualMedia("Trabajo en equipo", [keyword, phrase], { isFinal: true });
    expect(match?.entry.id).toBe("phrase");
    expect(match?.reason.kind).toBe(MEDIA_MATCH_KIND.EXACT_PHRASE);
  });

  it("elige la frase incluida más larga antes que una frase corta", () => {
    const short = entry({ id: "short", phrases: ["atención"], keywords: [] });
    const long = entry({ id: "long", phrases: ["presten atención"], keywords: [] });
    expect(matchVisualMedia("Por favor presten atención ahora", [short, long], { isFinal: true })?.entry.id).toBe("long");
  });

  it("usa palabra clave con límite de palabra e ignora tildes", () => {
    expect(matchVisualMedia("Revisemos la SEGURIDAD", [entry()], { isFinal: true })?.reason.kind).toBe(MEDIA_MATCH_KIND.KEYWORD);
    expect(matchVisualMedia("Hablamos de inseguridad", [entry()], { isFinal: true })).toBeNull();
    expect(matchVisualMedia("elementos de proteccion", [entry()], { isFinal: true })?.entry.id).toBe("validated-seguridad");
  });
});

describe("política de activación", () => {
  const validated = entry({
    id: "validated",
    status: MEDIA_STATUS.VALIDATED,
    validation: { validators: ["Persona sorda 1", "Persona sorda 2"], notes: "Validado", validatedAt: "2026-01-01T00:00:00.000Z" },
    authorization: { license: "Autorización escrita", authorizationReference: "AUT-1" },
  });

  it("nunca activa pending", () => {
    expect(matchVisualMedia("seguridad", [entry({ status: MEDIA_STATUS.PENDING })], { isFinal: true })).toBeNull();
  });

  it("activa validated únicamente con frase final y metadatos completos", () => {
    expect(matchVisualMedia("seguridad", [validated], { isFinal: false })).toBeNull();
    expect(matchVisualMedia("seguridad", [validated], { isFinal: true })?.entry.id).toBe("validated");
    expect(matchVisualMedia("seguridad", [entry({ ...validated, validation: { ...validated.validation, validators: ["Solo uno"] } })], { isFinal: true })).toBeNull();
  });

  it("respeta enabled", () => {
    expect(matchVisualMedia("seguridad", [entry({ enabled: false })], { isFinal: true })).toBeNull();
  });

  it("activa LSC50 solo con catálogo explícito, resultado final y glosa exacta", () => {
    const academic = entry({
      id: "lsc50-0038",
      label: "Yo",
      phrases: ["Yo"],
      keywords: [],
      status: MEDIA_STATUS.ACADEMIC,
      authorization: { license: "CC BY 4.0", authorizationReference: "10.6084/m9.figshare.27383016.v1" },
    });
    expect(matchVisualMedia("yo", [academic], { unifiedLscLibrary: false, isFinal: true })).toBeNull();
    expect(matchVisualMedia("yo", [academic], { unifiedLscLibrary: true, isFinal: false })).toBeNull();
    expect(matchVisualMedia("yo trabajo", [academic], { unifiedLscLibrary: true, isFinal: true })).toBeNull();
    expect(matchVisualMedia("YO", [academic], { unifiedLscLibrary: true, isFinal: true })?.entry.id).toBe("lsc50-0038");
  });

  it("acepta frases distintivas dentro de finales naturales sin substring parcial", () => {
    const academic = entry({ id: "lsc50-0001", label: "Buenos días", phrases: ["Buenos días"], keywords: [], status: MEDIA_STATUS.ACADEMIC, authorization: { license: "CC BY 4.0", authorizationReference: "DOI" } });
    expect(matchVisualMedia("Hola, buenos días a todos", [academic], { unifiedLscLibrary: true, isFinal: true })?.entry.id).toBe("lsc50-0001");
    expect(matchVisualMedia("los días buenos", [academic], { unifiedLscLibrary: true, isFinal: true })).toBeNull();
    expect(matchVisualMedia("holanda", [entry({ id: "lsc50-hola", phrases: ["hola"], keywords: [], status: MEDIA_STATUS.ACADEMIC, authorization: { license: "CC", authorizationReference: "ref" } })], { unifiedLscLibrary: true, isFinal: true })).toBeNull();
  });

  it("prioriza frase exacta, frase más larga y luego alias; respeta fuente preferida", () => {
    const lsc50 = entry({ id: "lsc50-0006", phrases: ["Trabajar"], keywords: ["Trabajo"], status: MEDIA_STATUS.ACADEMIC, authorization: { license: "CC", authorizationReference: "ref" } });
    const univalle = entry({ id: "univalle-09", phrases: ["Trabajo"], keywords: ["Trabajar"], status: MEDIA_STATUS.ACADEMIC, authorization: { license: "CC", authorizationReference: "ref" } });
    expect(matchVisualMedia("mi trabajo final", [lsc50, univalle], { unifiedLscLibrary: true, isFinal: true })?.entry.id).toBe("lsc50-0006");
    expect(matchVisualMedia("voy a trabajar", [lsc50, univalle], { unifiedLscLibrary: true, isFinal: true })?.entry.id).toBe("lsc50-0006");
    expect(matchVisualMedia("trabajo", [univalle], { unifiedLscLibrary: false, isFinal: true })).toBeNull();
  });

  it("mantiene LSC validado por encima del catálogo académico ante la misma glosa", () => {
    const academic = entry({ id: "lsc50-0000", phrases: ["gracias"], keywords: [], status: MEDIA_STATUS.ACADEMIC, authorization: { license: "CC BY 4.0", authorizationReference: "DOI" } });
    const validatedThanks = { ...validated, id: "validated-gracias", phrases: ["gracias"], keywords: [] };
    expect(matchVisualMedia("gracias", [academic, validatedThanks], { unifiedLscLibrary: true, isFinal: true })?.entry.id).toBe("validated-gracias");
  });

  it("activa community solo con toggle, final, fuente y licencia completas", () => {
    const community = entry({ id: "expresa-tecnologia-computador", phrases: ["Computador"], keywords: [], status: MEDIA_STATUS.COMMUNITY, authorization: { license: "CC BY-NC-ND 3.0 Unported", authorizationReference: "https://archive.org/details/tecnologia_expresa" }, media: { kind: MEDIA_KIND.VIDEO, source: MEDIA_SOURCE.BUNDLED, uri: "expresa/tecnologia_expresa/computador.mp4", mimeType: "video/mp4", altText: "Original EXPRESA" } });
    expect(matchVisualMedia("computador", [community], { unifiedLscLibrary: true, includeCommunityContent: false, isFinal: true })).toBeNull();
    expect(matchVisualMedia("computador", [community], { unifiedLscLibrary: true, includeCommunityContent: true, isFinal: false })).toBeNull();
    expect(matchVisualMedia("computador", [community], { unifiedLscLibrary: true, includeCommunityContent: true, isFinal: true })?.entry.id).toBe(community.id);
    expect(matchVisualMedia("computadores", [community], { unifiedLscLibrary: true, includeCommunityContent: true, isFinal: true })).toBeNull();
  });
});

describe("VisualMatchController", () => {
  it("no activa contenido validado desde parciales", () => {
    const controller = new VisualMatchController(() => [entry()], 600, 5_000);
    controller.setSession("asr:1");
    expect(controller.update({ text: "seguridad", isFinal: false, sessionKey: "asr:1", now: 1_000 })).toBeNull();
    expect(controller.update({ text: "seguridad", isFinal: false, sessionKey: "asr:1", now: 1_600 })).toBeNull();
  });

  it("no relanza continuamente la misma ayuda y permite otra coincidencia", () => {
    const second = entry({ id: "preguntas", phrases: ["tienen preguntas"], keywords: [] });
    const controller = new VisualMatchController(() => [entry(), second], 0, 5_000);
    controller.setSession("asr:1");
    expect(controller.update({ text: "seguridad", isFinal: true, sessionKey: "asr:1", now: 1_000 })?.entry.id).toBe("validated-seguridad");
    expect(controller.update({ text: "seguridad", isFinal: true, sessionKey: "asr:1", now: 2_000 })).toBeNull();
    expect(controller.update({ text: "tienen preguntas", isFinal: true, sessionKey: "asr:1", now: 2_100 })?.entry.id).toBe("preguntas");
  });

  it("ignora texto de una sesión vieja", () => {
    const controller = new VisualMatchController(() => [entry()], 0, 0);
    controller.setSession("asr:2");
    expect(controller.update({ text: "seguridad", isFinal: true, sessionKey: "asr:1", now: 1_000 })).toBeNull();
    expect(controller.update({ text: "seguridad", isFinal: true, sessionKey: "asr:2", now: 1_000 })?.entry.id).toBe("validated-seguridad");
  });
});
