import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { get } from "node:https";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const MODEL_NAME = "vosk-model-small-es-0.42";
const MODEL_URL = new URL(`https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`);
const EXPECTED_SHA256 = "09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f";
const MAX_BYTES = 80 * 1024 * 1024;
const destination = resolve("models");
const archive = join(destination, `${MODEL_NAME}.zip`);
const extracted = join(destination, MODEL_NAME);

async function download(url, redirects = 0) {
  if (url.protocol !== "https:" || !["alphacephei.com", "www.alphacephei.com"].includes(url.hostname)) {
    throw new Error("La descarga fue redirigida a un origen no autorizado.");
  }
  if (redirects > 4) throw new Error("Demasiadas redirecciones durante la descarga.");

  await new Promise((resolveDownload, reject) => {
    const request = get(url, { headers: { "User-Agent": "SenaLSC-model-installer/0.1" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        void download(new URL(response.headers.location, url), redirects + 1).then(resolveDownload, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`El servidor respondió HTTP ${response.statusCode ?? "desconocido"}.`));
        return;
      }
      const declaredSize = Number(response.headers["content-length"] ?? 0);
      if (declaredSize > MAX_BYTES) {
        response.resume();
        reject(new Error("El archivo supera el límite de seguridad esperado."));
        return;
      }
      let received = 0;
      const output = createWriteStream(archive, { flags: "wx" });
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_BYTES) request.destroy(new Error("La descarga superó el límite de seguridad."));
      });
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
  // Continúa con una instalación nueva.
}

await rm(archive, { force: true });
console.log(`Descargando ${MODEL_NAME} desde el sitio oficial de Vosk...`);
await download(MODEL_URL);
const archiveStats = await stat(archive);
if (archiveStats.size < 10 * 1024 * 1024) throw new Error("El archivo descargado es menor de lo esperado para el modelo oficial.");
const bytes = await readFile(archive);
if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("El archivo descargado no es un ZIP válido.");
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== EXPECTED_SHA256) {
  await rm(archive, { force: true });
  throw new Error(`El SHA-256 del modelo no coincide con el valor verificado. Recibido: ${digest}`);
}

const list = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
if (list.status !== 0) throw new Error("Se requiere el comando unzip para verificar y extraer el modelo.");
const rootPrefix = `${MODEL_NAME}/`;
const unsafe = list.stdout.split(/\r?\n/).filter(Boolean).some((entry) => {
  const normalized = entry.replaceAll("\\", "/");
  const resolved = resolve(destination, normalized);
  return !normalized.startsWith(rootPrefix) || normalized.includes("../") || !resolved.startsWith(`${destination}${sep}`);
});
if (unsafe) throw new Error("El ZIP contiene rutas inesperadas y no se extraerá.");

const extraction = spawnSync("unzip", ["-q", archive, "-d", destination], { encoding: "utf8" });
if (extraction.status !== 0) throw new Error(`No se pudo extraer el modelo: ${extraction.stderr}`);
await rm(archive, { force: true });
console.log(`Modelo instalado en ${extracted}`);
console.log(`SHA-256 verificado: ${digest}`);
console.log("Licencia del modelo: Apache 2.0, consulte docs/LICENCIAS-TERCEROS.md.");
