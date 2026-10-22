import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rm, stat, statfs } from "node:fs/promises";
import { get } from "node:https";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const MODEL_NAME = "vosk-model-es-0.42";
const MODEL_URL = new URL(`https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`);
const EXPECTED_BYTES = 1_484_681_703;
const EXPECTED_SHA256 = "bbbfaf9239bed5dcb0d140886b5834fcc13c13c7fb2f2799ae790f03ff20bfce";
const destination = resolve("models");
const archive = join(destination, `${MODEL_NAME}.zip`);
const extracted = join(destination, MODEL_NAME);

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, offset = 0, redirects = 0) {
  if (url.protocol !== "https:" || !["alphacephei.com", "www.alphacephei.com"].includes(url.hostname)) throw new Error("Origen de descarga no autorizado.");
  if (redirects > 4) throw new Error("Demasiadas redirecciones.");
  await new Promise((resolveDownload, reject) => {
    const headers = { "User-Agent": "SenaLSC-model-installer/0.1", ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}) };
    const request = get(url, { headers }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        void download(new URL(response.headers.location, url), offset, redirects + 1).then(resolveDownload, reject);
        return;
      }
      const expectedStatus = offset > 0 ? 206 : 200;
      if (response.statusCode !== expectedStatus) {
        response.resume();
        reject(new Error(`El servidor respondió HTTP ${response.statusCode ?? "desconocido"}.`));
        return;
      }
      const output = createWriteStream(archive, { flags: offset > 0 ? "a" : "w" });
      response.pipe(output);
      output.on("finish", () => output.close(resolveDownload));
      output.on("error", reject);
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

await mkdir(destination, { recursive: true });
try {
  await access(extracted);
  console.log(`El modelo ya existe en ${extracted}`);
  process.exit(0);
} catch {
  // Continúa con la instalación.
}

const currentBytes = await stat(archive).then((value) => value.size).catch(() => 0);
const filesystem = await statfs(destination);
const freeBytes = filesystem.bavail * filesystem.bsize;
const requiredBytes = Math.max(0, EXPECTED_BYTES - currentBytes) + 3_000_000_000;
if (freeBytes < requiredBytes) throw new Error(`Espacio insuficiente: se requieren al menos ${requiredBytes} bytes libres para descargar y extraer.`);
if (currentBytes > EXPECTED_BYTES) await rm(archive, { force: true });
const resumeAt = currentBytes <= EXPECTED_BYTES ? currentBytes : 0;
if (resumeAt < EXPECTED_BYTES) {
  console.log(`${resumeAt > 0 ? "Reanudando" : "Descargando"} ${MODEL_NAME} desde Vosk/Alpha Cephei...`);
  await download(MODEL_URL, resumeAt);
}
const archiveStats = await stat(archive);
if (archiveStats.size !== EXPECTED_BYTES) throw new Error(`Tamaño inesperado: ${archiveStats.size} bytes.`);
const digest = await sha256(archive);
if (digest !== EXPECTED_SHA256) throw new Error(`SHA-256 inesperado: ${digest}`);
const list = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
if (list.status !== 0) throw new Error("Se requiere unzip para validar el modelo.");
const prefix = `${MODEL_NAME}/`;
if (list.stdout.split(/\r?\n/).filter(Boolean).some((entry) => !entry.startsWith(prefix) || entry.includes("../") || !resolve(destination, entry).startsWith(`${destination}${sep}`))) {
  throw new Error("El ZIP contiene rutas no seguras.");
}
const extraction = spawnSync("unzip", ["-q", archive, "-d", destination], { encoding: "utf8" });
if (extraction.status !== 0) throw new Error(`No se pudo extraer el modelo: ${extraction.stderr}`);
await rm(archive, { force: true });
console.log(`Modelo preciso instalado en ${extracted}`);
console.log(`SHA-256 verificado: ${digest}`);
