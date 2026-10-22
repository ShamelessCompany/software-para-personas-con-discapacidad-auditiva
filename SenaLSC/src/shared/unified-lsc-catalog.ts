import { EXPRESA_SIGNS } from "./expresa-catalog";
import { LSC50_SIGNS } from "./lsc50-catalog";
import { UNIVALLE_SIGNS } from "./univalle-catalog";

const EXPLICIT_ALIASES: Readonly<Record<string, string>> = {
  trabajo: "trabajar",
};

export function canonicalLscKey(value: string): string {
  const normalized = value
    .normalize("NFD")
    .toLocaleLowerCase("es-CO")
    .replace(/n\u0303/g, "ñ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return EXPLICIT_ALIASES[normalized] ?? normalized;
}

const lsc50Keys = new Set(LSC50_SIGNS.map((sign) => canonicalLscKey(sign.phrase)));

export const UNIFIED_UNIVALLE_SIGNS = UNIVALLE_SIGNS.filter((sign) => !lsc50Keys.has(canonicalLscKey(sign.phrase)));
export const UNIFIED_LSC_CONCEPT_COUNT = LSC50_SIGNS.length + UNIFIED_UNIVALLE_SIGNS.length + EXPRESA_SIGNS.length;
export const REMOVED_DUPLICATE_COUNT = UNIVALLE_SIGNS.length - UNIFIED_UNIVALLE_SIGNS.length;
