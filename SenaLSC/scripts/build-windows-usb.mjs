import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";

const VERSION = "0.1.0";
const ROOT = resolve(".");
const RELEASE = join(ROOT, "release");
const USB_NAME = "SenaLSC-Windows-USB";
const USB = join(RELEASE, USB_NAME);
const ZIP = join(RELEASE, `SenaLSC-Windows-USB-Candidato-${VERSION}.zip`);
const APP_NAME = `SenaLSC-Windows-Candidato-NoValidado-${VERSION}-x64.exe`;
const CANDIDATE = join(RELEASE, "candidate-build", APP_NAME);
const MODEL_NAME = "vosk-model-small-es-0.42";

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function safeRelative(path) {
  const value = relative(USB, path).split(sep).join("/");
  if (!value || value.startsWith("../") || value.includes("/../")) throw new Error(`Ruta no segura: ${path}`);
  return value;
}

await stat(CANDIDATE);
await rm(USB, { recursive: true, force: true });
await mkdir(join(USB, "Aplicacion"), { recursive: true });
await Promise.all([
  cp(CANDIDATE, join(USB, "Aplicacion", APP_NAME)),
  cp(join(ROOT, "models", MODEL_NAME), join(USB, "modelo", MODEL_NAME), { recursive: true }),
  cp(join(ROOT, "windows-usb", "Preparar-SenaLSC.ps1"), join(USB, "Preparar-SenaLSC.ps1")),
  cp(join(ROOT, "windows-usb", "Iniciar-SenaLSC.ps1"), join(USB, "Iniciar-SenaLSC.ps1")),
  cp(join(ROOT, "windows-usb", "LEEME-WINDOWS.txt"), join(USB, "LEEME-WINDOWS.txt")),
]);

const sidecarSource = join(USB, "sidecar-source");
await mkdir(sidecarSource, { recursive: true });
for (const name of ["asr.py", "requirements-build.txt", "build-windows.ps1"]) {
  await cp(join(ROOT, "sidecar", name), join(sidecarSource, name));
}

const modelRoot = join(USB, "modelo", MODEL_NAME);
const modelFiles = await filesUnder(modelRoot);
const modelLines = [];
let modelBytes = 0;
for (const path of modelFiles) {
  const info = await stat(path);
  modelBytes += info.size;
  modelLines.push(`${await hashFile(path)}  ${relative(modelRoot, path).split(sep).join("/")}`);
}
const treeHash = createHash("sha256").update(`${modelLines.join("\n")}\n`).digest("hex");
await writeFile(join(USB, "MODELO-INFO.txt"), [
  `Modelo: ${MODEL_NAME}`,
  "Origen oficial: https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip",
  "Licencia: Apache-2.0",
  `Archivos: ${modelFiles.length}`,
  `Tamaño de archivos: ${modelBytes} bytes`,
  `SHA-256 del árbol (lista ordenada hash + ruta): ${treeHash}`,
  "SHA-256 del ZIP oficial verificado por el proyecto: 09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f",
  "",
  ...modelLines,
  "",
].join("\n"));

const payloadFiles = (await filesUnder(USB)).filter((path) => !path.endsWith(`${sep}SHA256SUMS.txt`));
const sumLines = [];
for (const path of payloadFiles) sumLines.push(`${await hashFile(path)}  ${safeRelative(path)}`);
await writeFile(join(USB, "SHA256SUMS.txt"), `${sumLines.join("\n")}\n`);

await rm(ZIP, { force: true });
const zip = spawnSync("zip", ["-q", "-r", ZIP, USB_NAME], { cwd: RELEASE, encoding: "utf8" });
if (zip.status !== 0) throw new Error(`No se pudo crear el ZIP: ${zip.stderr || zip.error?.message || "error desconocido"}`);

const [zipInfo, appInfo] = await Promise.all([stat(ZIP), stat(CANDIDATE)]);
console.log(JSON.stringify({
  app: { path: CANDIDATE, size: appInfo.size, sha256: await hashFile(CANDIDATE) },
  model: { files: modelFiles.length, size: modelBytes, treeSha256: treeHash },
  zip: { path: ZIP, size: zipInfo.size, sha256: await hashFile(ZIP) },
}, null, 2));
