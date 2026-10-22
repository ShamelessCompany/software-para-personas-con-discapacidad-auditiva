import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_LSC50_MEDIA, BUNDLED_UNIVALLE_MEDIA } from "../src/shared/bundled-media";
import { canonicalLscKey, UNIFIED_LSC_CONCEPT_COUNT } from "../src/shared/unified-lsc-catalog";
import { UNIVALLE_SIGNS } from "../src/shared/univalle-catalog";
import { MEDIA_STATUS } from "../src/shared/types";

describe("catálogo cotidiano UniValle", () => {
  it("declara solo los dos conceptos UniValle únicos y 181 conceptos totales", () => {
    expect(UNIVALLE_SIGNS).toHaveLength(2);
    expect(BUNDLED_UNIVALLE_MEDIA).toHaveLength(2);
    expect(BUNDLED_UNIVALLE_MEDIA.every((entry) => entry.status === MEDIA_STATUS.ACADEMIC)).toBe(true);
    const concepts = [...BUNDLED_LSC50_MEDIA, ...BUNDLED_UNIVALLE_MEDIA].map((entry) => canonicalLscKey(entry.label));
    expect(new Set(concepts).size).toBe(52);
    expect(UNIFIED_LSC_CONCEPT_COUNT).toBe(181);
    expect(canonicalLscKey("N")).not.toBe(canonicalLscKey("Ñ"));
  });

  it("mantiene manifiesto, hashes y cero SVG", async () => {
    const manifest = JSON.parse(await readFile(resolve("assets/lsc/univalle/manifest.json"), "utf8")) as { clips: Array<{ convertedName: string; convertedBytes: number; convertedSha256: string; transformation: string }>; omittedDuplicates: Array<{ convertedName: string; license: { name: string }; canonicalReplacementId: string }> };
    expect(manifest.clips).toHaveLength(2);
    expect(manifest.omittedDuplicates).toHaveLength(9);
    expect(manifest.omittedDuplicates.every((clip) => clip.license.name === "CC BY-SA 4.0" && clip.canonicalReplacementId.startsWith("lsc50-"))).toBe(true);
    expect((await readdir(resolve("assets/lsc/univalle"))).filter((name) => name.endsWith(".mp4"))).toHaveLength(2);
    for (const clip of manifest.clips) {
      const path = resolve("assets/lsc/univalle", clip.convertedName);
      expect((await stat(path)).size).toBe(clip.convertedBytes);
      expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(clip.convertedSha256);
      expect(clip.transformation).toContain("no trim, mirror, speed change, or looping");
    }
  });
});
