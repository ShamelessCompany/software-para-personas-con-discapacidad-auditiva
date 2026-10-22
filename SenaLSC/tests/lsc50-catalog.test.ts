import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_LSC50_MEDIA } from "../src/shared/bundled-media";
import { LSC50_SIGNS } from "../src/shared/lsc50-catalog";
import { MEDIA_STATUS } from "../src/shared/types";

interface ManifestClip {
  classId: string;
  phrase: string;
  originalName: string;
  originalSha256: string;
  convertedName: string;
  convertedSha256: string;
  convertedBytes: number;
  transformation: string;
}

interface Lsc50Manifest {
  schemaVersion: number;
  clips: ManifestClip[];
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

describe("catálogo LSC50 incorporado", () => {
  it("declara las 50 clases oficiales como academic y no validated", () => {
    expect(LSC50_SIGNS).toHaveLength(50);
    expect(new Set(LSC50_SIGNS.map((sign) => sign.classId)).size).toBe(50);
    expect(BUNDLED_LSC50_MEDIA).toHaveLength(50);
    expect(BUNDLED_LSC50_MEDIA.every((entry) => entry.status === MEDIA_STATUS.ACADEMIC)).toBe(true);
    expect(BUNDLED_LSC50_MEDIA.some((entry) => entry.status === MEDIA_STATUS.VALIDATED)).toBe(false);
  });

  it("mantiene manifiesto completo y hashes de los 50 MP4", async () => {
    const manifest = JSON.parse(await readFile(resolve("assets/lsc/lsc50/manifest.json"), "utf8")) as Lsc50Manifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.clips).toHaveLength(50);
    for (const clip of manifest.clips) {
      expect(clip.originalName).toMatch(/^VIDEOS\/COLOR_BODY\/\d{4}_0000_0000\.avi$/);
      expect(clip.originalSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(clip.phrase).toBe(LSC50_SIGNS.find((sign) => sign.classId === clip.classId)?.phrase);
      expect(clip.transformation).toContain("no trim, mirror, speed change, or looping");
      const path = resolve("assets/lsc/lsc50", clip.convertedName);
      expect((await stat(path)).size).toBe(clip.convertedBytes);
      expect(await sha256(path)).toBe(clip.convertedSha256);
    }
  });

  it("convive únicamente con las fuentes autorizadas y el catálogo unificado", async () => {
    expect((await readdir(resolve("assets/lsc"))).sort()).toEqual(["README.md", "expresa", "lsc50", "unified-lsc-catalog.json", "univalle"]);
    const files = await readdir(resolve("assets/lsc/lsc50"));
    expect(files.filter((file) => file.endsWith(".mp4"))).toHaveLength(50);
    expect(files.filter((file) => file !== "manifest.json" && !file.endsWith(".mp4"))).toEqual([]);
  });
});
