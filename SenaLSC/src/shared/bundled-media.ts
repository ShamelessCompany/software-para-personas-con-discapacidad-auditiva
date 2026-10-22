import { MEDIA_KIND, MEDIA_SOURCE, MEDIA_STATUS, type VisualLibraryEntry } from "./types";
import { LSC50_SIGNS, LSC50_SOURCE } from "./lsc50-catalog";
import { UNIVALLE_SOURCE } from "./univalle-catalog";
import { EXPRESA_SIGNS, EXPRESA_SOURCE } from "./expresa-catalog";
import { UNIFIED_UNIVALLE_SIGNS } from "./unified-lsc-catalog";

export const BUNDLED_LSC50_MEDIA: VisualLibraryEntry[] = LSC50_SIGNS.map((sign) => ({
  id: `lsc50-${sign.classId}`,
  label: sign.phrase,
  phrases: [sign.phrase],
  keywords: [...(sign.aliases ?? [])],
  context: "Signo aislado del corpus académico LSC50; no constituye traducción gramatical de una frase.",
  region: "LSC; la variante regional no está individualizada por clip.",
  status: MEDIA_STATUS.ACADEMIC,
  validation: { validators: [], notes: "El paper documenta supervisión de intérpretes certificados, pero no registra dos validadores individuales por clip.", validatedAt: null },
  authorization: { license: LSC50_SOURCE.license, authorizationReference: LSC50_SOURCE.doi },
  media: {
    kind: MEDIA_KIND.VIDEO,
    source: MEDIA_SOURCE.BUNDLED,
    uri: `lsc50/${sign.classId}-${sign.slug}.mp4`,
    mimeType: "video/mp4",
    altText: `Participante del corpus LSC50 realizando el signo aislado “${sign.phrase}”.`,
    durationMs: sign.durationMs,
  },
  enabled: true,
  createdAt: "2024-10-31T18:04:32.000Z",
  updatedAt: "2024-10-31T18:04:32.000Z",
}));

export const BUNDLED_UNIVALLE_MEDIA: VisualLibraryEntry[] = UNIFIED_UNIVALLE_SIGNS.map((sign) => ({
  id: `univalle-${sign.classId}`,
  label: sign.phrase,
  phrases: [sign.phrase],
  keywords: [...(sign.aliases ?? [])],
  context: "Signo aislado del corpus cotidiano UniValle; no constituye traducción gramatical de una frase.",
  region: "LSC, grabado en Cali; la variante regional no está individualizada por clip.",
  status: MEDIA_STATUS.ACADEMIC,
  validation: { validators: [], notes: "El corpus documenta tres firmantes nativos y consentimiento explícito, pero no dos validadores individuales por clip.", validatedAt: null },
  authorization: { license: UNIVALLE_SOURCE.license, authorizationReference: UNIVALLE_SOURCE.url },
  media: {
    kind: MEDIA_KIND.VIDEO,
    source: MEDIA_SOURCE.BUNDLED,
    uri: `univalle/${sign.classId}-${sign.slug}.mp4`,
    mimeType: "video/mp4",
    altText: `Participante del corpus cotidiano UniValle realizando el signo aislado “${sign.phrase}”.`,
  },
  enabled: true,
  createdAt: "2026-05-29T20:35:11.237Z",
  updatedAt: "2026-05-29T20:35:11.237Z",
}));

export const BUNDLED_EXPRESA_MEDIA: VisualLibraryEntry[] = EXPRESA_SIGNS.map((sign) => {
  const stem = sign.fileName.replace(/\.mp4$/i, "").replace(/[^a-z0-9]+/gi, "-").toLocaleLowerCase("es-CO");
  return {
    id: `expresa-${sign.identifier.replace("_expresa", "")}-${stem}`,
    label: sign.gloss,
    phrases: [sign.gloss],
    keywords: [...(sign.aliases ?? [])],
    context: `Signo aislado de la colección comunitaria EXPRESA, categoría ${sign.category}; no constituye traducción gramatical de una frase.`,
    region: "Lengua de Señas Colombiana; material publicado en Bogotá, Colombia.",
    status: MEDIA_STATUS.COMMUNITY,
    validation: { validators: [], notes: "Fuente comunitaria atribuida; no documenta dos validadores individuales por clip.", validatedAt: null },
    authorization: { license: EXPRESA_SOURCE.license, authorizationReference: `https://archive.org/details/${sign.identifier}` },
    media: {
      kind: MEDIA_KIND.VIDEO,
      source: MEDIA_SOURCE.BUNDLED,
      uri: `expresa/${sign.identifier}/${sign.fileName}`,
      mimeType: "video/mp4",
      altText: `Video original de EXPRESA para el signo aislado “${sign.gloss}”.`,
      ...(sign.category === "alfabeto" ? { durationMs: 16_000 } : {}),
    },
    enabled: true,
    createdAt: "2015-06-14T00:00:00.000Z",
    updatedAt: "2015-06-14T00:00:00.000Z",
  };
});

export const BUNDLED_VISUAL_MEDIA: VisualLibraryEntry[] = [...BUNDLED_LSC50_MEDIA, ...BUNDLED_UNIVALLE_MEDIA, ...BUNDLED_EXPRESA_MEDIA];
