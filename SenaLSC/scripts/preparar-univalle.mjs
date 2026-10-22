import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const DATASET_URL = new URL("https://www.kaggle.com/api/v1/datasets/download/juanrrai/colombian-sign-language-slc-signs-dataset?datasetVersionNumber=1");
const DATASET_PAGE = "https://www.kaggle.com/datasets/juanrrai/colombian-sign-language-slc-signs-dataset";
const EXPECTED_BYTES = 534_576_388;
const EXPECTED_SHA256 = "2d9a893c00fbdec8cc4d51e6aa3bb6b666d0f1a58ed1663badd947098c129cf8";
const workDirectory = resolve("artifacts", "univalle");
const archive = process.env.UNIVALLE_ARCHIVE ? resolve(process.env.UNIVALLE_ARCHIVE) : join(workDirectory, "univalle-v1.zip");
const outputDirectory = resolve("assets", "lsc", "univalle");
const signs = [
  ["00", "Adiós", "adios", "raw/adios/00_00_000.mp4"],
  ["01", "Bonito", "bonito", "raw/bonito/01_00_000.mp4"],
  ["02", "Buenas noches", "buenas-noches", "raw/buenas_noches/02_00_000.mp4"],
  ["03", "Buenas tardes", "buenas-tardes", "raw/buenas_tardes/03_00_000.mp4"],
  ["04", "Buenos días", "buenos-dias", "raw/buenos_dias/04_00_000.mp4"],
  ["05", "Gracias", "gracias", "raw/gracias/05_00_000.mp4"],
  ["06", "Hola", "hola", "raw/hola/06_00_000.mp4"],
  ["07", "Nombre", "nombre", "raw/nombre/07_00_000.mp4"],
  ["08", "Por favor", "por-favor", "raw/por_favor/08_00_000.mp4"],
  ["09", "Trabajo", "trabajo", "raw/trabajo/09_00_000.mp4"],
  ["10", "Univalle", "univalle", "raw/univalle/10_00_000.mp4"],
];

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, offset = 0, redirects = 0) {
  if (url.protocol !== "https:" || !["www.kaggle.com", "storage.googleapis.com"].includes(url.hostname)) throw new Error("Origen de descarga no autorizado.");
  if (redirects > 5) throw new Error("Demasiadas redirecciones.");
  await new Promise((resolveDownload, reject) => {
    const headers = { "User-Agent": "SenaLSC-corpus-installer/0.1", ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}) };
    const request = get(url, { headers }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        void download(new URL(response.headers.location, url), offset, redirects + 1).then(resolveDownload, reject);
        return;
      }
      if (![200, 206].includes(response.statusCode ?? 0)) {
        response.resume();
        reject(new Error(`Kaggle respondió HTTP ${response.statusCode ?? "desconocido"}; puede requerir credenciales.`));
        return;
      }
      const output = createWriteStream(archive, { flags: offset > 0 && response.statusCode === 206 ? "a" : "w" });
      response.pipe(output);
      output.on("finish", () => output.close(resolveDownload));
      output.on("error", reject);
    });
    request.on("error", reject);
  });
}

await mkdir(workDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
let archiveBytes = await stat(archive).then((value) => value.size).catch(() => 0);
const filesystem = await statfs(workDirectory);
if (filesystem.bavail * filesystem.bsize < EXPECTED_BYTES * 2) throw new Error("Espacio insuficiente para descargar y procesar el corpus UniValle.");
if (archiveBytes > EXPECTED_BYTES) {
  await rm(archive, { force: true });
  archiveBytes = 0;
}
if (archiveBytes < EXPECTED_BYTES) await download(DATASET_URL, archiveBytes);
if ((await stat(archive)).size !== EXPECTED_BYTES) throw new Error("El tamaño del corpus no coincide con la versión 1 verificada.");
const archiveSha256 = await sha256(archive);
if (archiveSha256 !== EXPECTED_SHA256) throw new Error(`SHA-256 inesperado para el corpus: ${archiveSha256}`);

const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
if (listing.status !== 0) throw new Error("Se requiere unzip para validar el corpus.");
const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
if (entries.some((entry) => entry.includes("../") || !resolve(workDirectory, entry).startsWith(`${workDirectory}${sep}`))) throw new Error("El ZIP contiene rutas no seguras.");

const clips = [];
for (const [classId, phrase, slug, relativePath] of signs) {
  const originalName = `lsc-signs-dataset/${relativePath}`;
  if (!entries.includes(originalName)) throw new Error(`Falta el clip esperado ${originalName}.`);
  const sourcePath = join(workDirectory, basename(relativePath));
  const extraction = spawnSync("unzip", ["-p", archive, originalName], { encoding: null, maxBuffer: 100 * 1024 * 1024 });
  if (extraction.status !== 0 || !extraction.stdout) throw new Error(`No se pudo extraer ${originalName}.`);
  await writeFile(sourcePath, extraction.stdout);
  const convertedName = `${classId}-${slug}.mp4`;
  const convertedPath = join(outputDirectory, convertedName);
  const conversion = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", sourcePath, "-map", "0:v:0", "-an", "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", convertedPath], { encoding: "utf8" });
  if (conversion.status !== 0) throw new Error(`FFmpeg falló para ${phrase}: ${conversion.stderr}`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", convertedPath], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`No se pudo medir ${convertedName}.`);
  clips.push({
    classId,
    phrase,
    originalName,
    originalSha256: await sha256(sourcePath),
    originalBytes: (await stat(sourcePath)).size,
    convertedName,
    convertedSha256: await sha256(convertedPath),
    convertedBytes: (await stat(convertedPath)).size,
    durationMs: Math.round(Number(probe.stdout.trim()) * 1000),
    source: { title: "Colombian Sign Language (SLC/csn) Signs Dataset", authors: ["Juan José Rodriguez-Rodriguez", "Wilfredo Alfonso-Morales"], institution: "Universidad del Valle · Univalle TV", year: 2023, url: DATASET_PAGE },
    license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
    transformation: "Selected signer 00 recording; converted MP4 H.264 1920x1080 to MP4 H.264 1280x720, yuv420p, CRF 24, faststart; audio removed; no trim, mirror, speed change, or looping added. This clip adaptation is distributed under CC BY-SA 4.0.",
  });
  await rm(sourcePath, { force: true });
}
const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), archive: { name: basename(archive), url: DATASET_URL.href, bytes: EXPECTED_BYTES, sha256: archiveSha256 }, selection: { signerId: "00", recordingId: "000", rationale: "Una toma representativa consistente por cada glosa; movimiento completo conservado." }, clips };
await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Corpus UniValle preparado: ${clips.length} clips, manifiesto y atribución CC BY-SA 4.0.`);
