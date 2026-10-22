import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_EXPRESA_MEDIA } from "../src/shared/bundled-media";
import { EXPRESA_SIGNS } from "../src/shared/expresa-catalog";
import { MEDIA_STATUS } from "../src/shared/types";

interface ManifestClip {
  storedPath: string;
  bytes: number;
  source: string;
  officialHash: { md5: string; sha1: string };
  calculatedHash: { sha256: string };
  transformation: string;
  license: { name: string };
  attribution: string;
}

describe("catálogo comunitario EXPRESA", () => {
  it("declara 129 originales como community, nunca academic ni validated", () => {
    expect(EXPRESA_SIGNS).toHaveLength(129);
    expect(BUNDLED_EXPRESA_MEDIA).toHaveLength(129);
    expect(BUNDLED_EXPRESA_MEDIA.every((entry) => entry.status === MEDIA_STATUS.COMMUNITY)).toBe(true);
    expect(BUNDLED_EXPRESA_MEDIA.some((entry) => entry.status === MEDIA_STATUS.ACADEMIC || entry.status === MEDIA_STATUS.VALIDATED)).toBe(false);
    expect(BUNDLED_EXPRESA_MEDIA.filter((entry) => entry.id.startsWith("expresa-alfabeto-"))).toHaveLength(27);
  });

  it("conserva nombre, bytes, hashes oficiales y transformation:none", async () => {
    const manifest = JSON.parse(await readFile(resolve("assets/lsc/expresa/manifest.json"), "utf8")) as { limits: { selectedBytes: number }; clips: ManifestClip[]; omitted: unknown[] };
    expect(manifest.clips).toHaveLength(129);
    expect(manifest.limits.selectedBytes).toBe(249_196_042);
    expect(manifest.omitted).toEqual([]);
    for (const clip of manifest.clips) {
      expect(clip.source).toBe("original");
      expect(clip.transformation).toBe("none");
      expect(clip.license.name).toBe("CC BY-NC-ND 3.0 Unported");
      expect(clip.attribution).toContain("Jhonny Alejandro Pérez Rojas");
      const path = resolve("assets/lsc/expresa", clip.storedPath);
      const bytes = await readFile(path);
      expect((await stat(path)).size).toBe(clip.bytes);
      expect(createHash("md5").update(bytes).digest("hex")).toBe(clip.officialHash.md5);
      expect(createHash("sha1").update(bytes).digest("hex")).toBe(clip.officialHash.sha1);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(clip.calculatedHash.sha256);
    }
  }, 60_000);

  it("no incorpora derivados ni SVG", async () => {
    const files = await readdir(resolve("assets/lsc/expresa"), { recursive: true });
    expect(files.filter((name) => name.endsWith(".mp4"))).toHaveLength(129);
    expect(files.filter((name) => name.endsWith(".svg"))).toEqual([]);
  });
});
