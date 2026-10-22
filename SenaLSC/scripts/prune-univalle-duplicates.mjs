import { readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = join(root, "assets", "lsc", "univalle");
const manifestPath = join(directory, "manifest.json");
const duplicateNames = new Set([
  "00-adios.mp4",
  "02-buenas-noches.mp4",
  "03-buenas-tardes.mp4",
  "04-buenos-dias.mp4",
  "05-gracias.mp4",
  "06-hola.mp4",
  "07-nombre.mp4",
  "08-por-favor.mp4",
  "09-trabajo.mp4",
]);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const omitted = manifest.clips.filter((clip) => duplicateNames.has(clip.convertedName));
const retained = manifest.clips.filter((clip) => !duplicateNames.has(clip.convertedName));
if (omitted.length !== 9 || retained.length !== 2 || retained.map((clip) => clip.convertedName).join(",") !== "01-bonito.mp4,10-univalle.mp4") {
  throw new Error("El manifiesto UniValle no coincide con la poda canónica esperada.");
}

for (const clip of omitted) await unlink(join(directory, clip.convertedName));
manifest.generatedAt = new Date().toISOString();
manifest.selection.rationale = "Una toma representativa por glosa sin equivalente canónico de mayor prioridad; movimiento completo conservado.";
manifest.originalClipCount = manifest.clips.length;
manifest.clips = retained;
manifest.omittedDuplicates = omitted.map((clip) => ({
  classId: clip.classId,
  phrase: clip.phrase,
  convertedName: clip.convertedName,
  convertedSha256: clip.convertedSha256,
  source: clip.source,
  license: clip.license,
  canonicalReplacementId: clip.classId === "09" ? "lsc50-0006" : ({
    "00": "lsc50-0031",
    "02": "lsc50-0003",
    "03": "lsc50-0002",
    "04": "lsc50-0001",
    "05": "lsc50-0000",
    "06": "lsc50-0030",
    "07": "lsc50-0005",
    "08": "lsc50-0032",
  })[clip.classId],
  reason: "Omitido físicamente porque LSC50 aporta el concepto canónico de mayor prioridad.",
}));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ removed: omitted.map((clip) => clip.convertedName), retained: retained.map((clip) => clip.convertedName) }));
