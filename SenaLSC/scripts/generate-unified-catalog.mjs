import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assets = join(root, "assets", "lsc");

const aliases = new Map([["trabajo", "trabajar"]]);
const normalize = (value) => {
  const normalized = value.normalize("NFD").toLocaleLowerCase("es-CO").replace(/n\u0303/g, "ñ").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
  return aliases.get(normalized) ?? normalized;
};

const lsc50Manifest = JSON.parse(await readFile(join(assets, "lsc50", "manifest.json"), "utf8"));
const univalleManifest = JSON.parse(await readFile(join(assets, "univalle", "manifest.json"), "utf8"));
const expresaManifest = JSON.parse(await readFile(join(assets, "expresa", "manifest.json"), "utf8"));
const recordedDuplicates = univalleManifest.omittedDuplicates ?? [];

const candidates = [
  ...lsc50Manifest.clips.map((clip) => ({
    canonicalKey: normalize(clip.phrase), id: `lsc50-${clip.classId}`, label: clip.phrase,
    source: "LSC50", priority: 3, storedPath: `lsc50/${clip.convertedName}`,
    license: clip.license, provenance: clip.source, transformation: clip.transformation,
  })),
  ...univalleManifest.clips.map((clip) => ({
    canonicalKey: normalize(clip.phrase), id: `univalle-${clip.classId}`, label: clip.phrase,
    source: "UniValle", priority: 2, storedPath: `univalle/${clip.convertedName}`,
    license: clip.license, provenance: clip.source, transformation: clip.transformation,
  })),
  ...expresaManifest.clips.map((clip) => ({
    canonicalKey: normalize(clip.gloss), id: clip.id, label: clip.gloss,
    source: "EXPRESA", priority: 1, storedPath: `expresa/${clip.storedPath}`,
    license: clip.license, provenance: { itemUrl: clip.itemUrl, fileUrl: clip.fileUrl, attribution: clip.attribution }, transformation: clip.transformation,
  })),
];

for (const candidate of candidates) await access(join(assets, candidate.storedPath));
const physicalVideos = (await readdir(assets, { recursive: true })).filter((path) => path.endsWith(".mp4")).sort();
const manifestedVideos = candidates.map((candidate) => candidate.storedPath).sort();
const orphanVideos = physicalVideos.filter((path) => !manifestedVideos.includes(path));
const missingVideos = manifestedVideos.filter((path) => !physicalVideos.includes(path));

const groups = new Map();
for (const candidate of candidates) {
  const group = groups.get(candidate.canonicalKey) ?? [];
  group.push(candidate);
  groups.set(candidate.canonicalKey, group);
}

const selected = [];
const detectedDuplicates = [];
for (const [canonicalKey, group] of groups) {
  group.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const canonical = group[0];
  if (!canonical) continue;
  selected.push(canonical);
  for (const omitted of group.slice(1)) {
    detectedDuplicates.push({ canonicalKey, selectedId: canonical.id, omittedId: omitted.id, omittedPath: omitted.storedPath, reason: "Menor prioridad de fuente para el mismo concepto normalizado o alias explícito." });
  }
}
selected.sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey, "es"));
detectedDuplicates.sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey, "es"));
const duplicates = detectedDuplicates.length > 0 ? detectedDuplicates : recordedDuplicates;
const duplicateCanonicalKeys = selected.length - new Set(selected.map((entry) => entry.canonicalKey)).size;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  normalization: "NFD sin tildes, minúsculas es-CO, puntuación a espacios, espacios compactados; alias explícito trabajo -> trabajar.",
  priority: ["validated importado/autorizado", "LSC50 academic", "UniValle academic", "EXPRESA community"],
  before: { videos: candidates.length + recordedDuplicates.length, concepts: selected.length, duplicateVariants: duplicates.length },
  currentInventory: { videos: physicalVideos.length, manifestedVideos: manifestedVideos.length },
  after: { videos: selected.length, concepts: selected.length, duplicateCanonicalKeys, orphanVideos, missingVideos },
  duplicates,
  entries: selected.map(({ priority: _priority, ...entry }) => entry),
};

if (report.before.videos !== 190 || report.after.videos !== 181 || report.after.concepts !== 181 || report.after.duplicateCanonicalKeys !== 0 || report.after.orphanVideos.length !== 0 || report.after.missingVideos.length !== 0 || report.duplicates.length !== 9) {
  throw new Error(`Conteo canónico inesperado: ${JSON.stringify({ before: report.before, after: report.after, duplicates: report.duplicates })}`);
}

await writeFile(join(assets, "unified-lsc-catalog.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(root, "docs", "REPORTE-CATALOGO-LSC.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ before: report.before, after: report.after, duplicates: report.duplicates }));
