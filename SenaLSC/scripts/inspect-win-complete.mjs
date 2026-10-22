import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { extractFile, listPackage } from "@electron/asar";
import { COMPLETE_ARTIFACT, countMedia, listFiles, sha256File, treeSummary, validateModel, validatePeX64 } from "./complete-package-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const artifact = join(root, "release", COMPLETE_ARTIFACT);
const extraction = join(tmpdir(), "senalsc-complete-inspection");

function fail(message) {
  console.error(`Inspección del portable falló: ${message}`);
  process.exit(1);
}

function requireText(text, values, label) {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label} no contiene ${value}`);
  }
}

function validateNativeModule(buffer, name) {
  const error = validatePeX64(buffer, 8 * 1024);
  if (error) fail(`${name} no es PE32+ AMD64: ${error}`);
}

function validatePortableLauncher(buffer) {
  if (buffer.length < 64 * 1024) return `el ejecutable es demasiado pequeño (${buffer.length} bytes)`;
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) return "falta la cabecera DOS MZ";
  const offset = buffer.readUInt32LE(0x3c);
  if (offset < 0x40 || offset + 26 > buffer.length) return "el offset PE es inválido";
  if (!buffer.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) return "la firma PE es inválida";
  return null;
}

async function readTextResources(resources, files) {
  const textExtensions = /\.(?:json|md|txt|py|pth|conf|ini)$/i;
  const contents = [];
  for (const file of files.filter((candidate) => textExtensions.test(candidate))) {
    contents.push(await readFile(join(resources, file), "utf8"));
  }
  return contents.join("\n");
}

try {
  await rm(extraction, { recursive: true, force: true });
  await mkdir(extraction, { recursive: true });
  const artifactBuffer = await readFile(artifact);
  const artifactPeError = validatePortableLauncher(artifactBuffer);
  if (artifactPeError) fail(`el lanzador portable no es un PE válido: ${artifactPeError}`);
  const extracted = spawnSync("bsdtar", ["-xf", artifact, "-C", extraction], { encoding: "utf8" });
  if (extracted.status !== 0) fail(`no se pudo extraer el EXE: ${extracted.stderr.trim()}`);

  const applicationPeError = validatePeX64(await readFile(join(extraction, "SenaLSC.exe")), 64 * 1024);
  if (applicationPeError) fail(`el ejecutable de aplicación interno no es PE32+ AMD64: ${applicationPeError}`);

  const resources = join(extraction, "resources");
  const extractedFiles = await listFiles(extraction);
  const files = await listFiles(resources);
  const media = countMedia(files.filter((file) => file.startsWith("assets/lsc/")));
  if (media.mp4 !== 181 || media.manifests !== 3 || media.svg !== 0) fail(`medios internos inválidos: ${JSON.stringify(media)}`);
  const mediaManifests = files.filter((file) => file.startsWith("assets/lsc/") && file.endsWith("/manifest.json"));
  for (const manifest of ["assets/lsc/expresa/manifest.json", "assets/lsc/lsc50/manifest.json", "assets/lsc/univalle/manifest.json"]) {
    if (!mediaManifests.includes(manifest)) fail(`falta el manifiesto ${manifest}`);
  }

  const runtimeDirectory = join(resources, "embedded-asr");
  const runtimeManifest = JSON.parse(await readFile(join(runtimeDirectory, "embedded-asr.manifest.json"), "utf8"));
  if (runtimeManifest.platform !== "win32" || runtimeManifest.architecture !== "x64") fail("el manifiesto ASR no corresponde a Windows x64");
  if (runtimeManifest.python?.version !== "3.12.10" || runtimeManifest.python?.executable !== "pythonw.exe" || runtimeManifest.python?.format !== "PE32+ AMD64") fail("el manifiesto no identifica el Python oficial esperado");
  if (runtimeManifest.engine?.name !== "vosk" || runtimeManifest.engine?.version !== "0.3.45" || runtimeManifest.engine?.importPath !== "site-packages/vosk/__init__.py") fail("el manifiesto no identifica Vosk 0.3.45 y su import layout");
  const pythonSource = runtimeManifest.sources?.find((source) => source.name === "Python");
  if (pythonSource?.url !== "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" || pythonSource?.sha256 !== "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3") fail("la procedencia del Python embebible oficial no coincide");
  for (const file of runtimeManifest.requiredFiles ?? []) {
    if (!files.includes(`embedded-asr/${file}`)) fail(`falta el archivo requerido embedded-asr/${file}`);
  }
  const pythonw = await readFile(join(resources, "embedded-asr", "pythonw.exe"));
  const peError = validatePeX64(pythonw);
  if (peError) fail(`pythonw interno inválido: ${peError}`);
  validateNativeModule(await readFile(join(runtimeDirectory, "site-packages", "vosk", "libvosk.dll")), "libvosk.dll");
  validateNativeModule(await readFile(join(runtimeDirectory, "site-packages", "_cffi_backend.cp312-win_amd64.pyd")), "_cffi_backend.cp312-win_amd64.pyd");
  const runtimeSummary = await treeSummary(runtimeDirectory, new Set(["embedded-asr.manifest.json"]));
  if (runtimeSummary.files !== runtimeManifest.runtime?.files || runtimeSummary.size !== runtimeManifest.runtime?.size || runtimeSummary.sha256 !== runtimeManifest.runtime?.sha256) fail("el runtime interno no coincide con el hash de árbol del manifiesto");

  const model = await validateModel(join(resources, "models", "vosk-model-small-es-0.42"));
  if (model.missing.length > 0) fail(`modelo interno incompleto: ${model.missing.join(", ")}`);
  const modelSummary = await treeSummary(join(resources, "models", "vosk-model-small-es-0.42"));
  if (modelSummary.files !== runtimeManifest.model?.files || modelSummary.size !== runtimeManifest.model?.size || modelSummary.sha256 !== runtimeManifest.model?.sha256) fail("el modelo interno no coincide con el hash de árbol del manifiesto");
  const packagedModels = files.filter((file) => file.startsWith("models/"));
  if (packagedModels.some((file) => !file.startsWith("models/vosk-model-small-es-0.42/"))) fail("el portable contiene un modelo distinto del modelo ligero esperado");

  for (const file of ["sidecar/asr.py", "embedded-asr/embedded-asr.manifest.json", "THIRD_PARTY_NOTICES.md", "app.asar"]) {
    if (!files.includes(file)) fail(`falta resources/${file}`);
  }
  for (const file of [
    "assets/brand/sena-logo-original.png",
    "assets/brand/sena-logo-ui.png",
    "assets/icons/icon-16.png",
    "assets/icons/icon-256.png",
    "assets/icons/icon-512.png",
    "assets/icons/icon.png",
    "assets/icons/tray-on-light.png",
    "assets/icons/tray-on-dark.png",
  ]) {
    if (!files.includes(file)) fail(`falta la identidad visual resources/${file}`);
  }
  if (files.some((file) => file.startsWith("assets/") && file.endsWith(".svg"))) fail("el portable contiene un SVG visual fabricado");
  const forbiddenFile = extractedFiles.find((file) => /(?:\.ps1|\.cmd|\.bat|\.sh|\.log)$|(?:^|\/)(?:\.venv|requirements-build|build-windows|prepare-embedded-asr|preflight-win|inspect-win|python\.exe|vosk-model-es-0\.42)(?:$|[./])/i.test(file));
  if (forbiddenFile) fail(`el portable contiene preparación, terminal, log, .venv, python.exe o modelo grande: ${forbiddenFile}`);
  const sensitiveFile = extractedFiles.find((file) => /(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_dsa|credentials?|secrets?)(?:$|\.)/i.test(file));
  if (sensitiveFile) fail(`el portable contiene un archivo potencialmente sensible: ${sensitiveFile}`);

  const appAsar = join(resources, "app.asar");
  const metadata = JSON.parse(extractFile(appAsar, "package.json").toString("utf8"));
  if (metadata.senalscDistribution === "demo" || metadata.senalscDistribution !== "complete-windows") fail("app.asar no corresponde a la distribución completa");
  if (metadata.scripts && Object.keys(metadata.scripts).length > 0) fail("package.json interno conserva scripts técnicos");
  if (metadata.devDependencies || metadata.build) fail("package.json interno conserva metadata de desarrollo o empaquetado");

  const asarFiles = listPackage(appAsar).map((file) => file.replace(/^\//, ""));
  for (const file of ["dist/renderer/favicon.png", "dist/renderer/sena-logo-ui.png"]) {
    if (!asarFiles.includes(file)) fail(`app.asar no contiene ${file}`);
  }
  const forbiddenAsarFile = asarFiles.find((file) => /(?:^|\/)(?:scripts?|tests?|docs?)(?:\/|$)|(?:\.map|\.ts|\.tsx|\.ps1|\.cmd|\.bat|\.sh|\.log)$|(?:^|\/)\.env(?:\.|$)/i.test(file));
  if (forbiddenAsarFile) fail(`app.asar contiene source o artefactos de desarrollo innecesarios: ${forbiddenAsarFile}`);

  const mainCode = extractFile(appAsar, "dist-electron/main/index.js").toString("utf8");
  const permissionCode = extractFile(appAsar, "dist-electron/main/window-security.js").toString("utf8");
  const audioCode = extractFile(appAsar, "dist-electron/shared/audio.js").toString("utf8");
  const rendererAsset = asarFiles.find((file) => /^dist\/renderer\/assets\/index-.*\.js$/.test(file));
  if (!rendererAsset) fail("falta el bundle renderer para verificar el selector de micrófono");
  const rendererCode = extractFile(appAsar, rendererAsset).toString("utf8");
  const sidecarCode = await readFile(join(resources, "sidecar", "asr.py"), "utf8");
  requireText(mainCode, ["setPermissionCheckHandler", "setPermissionRequestHandler", "details.mediaTypes"], "main empaquetado");
  requireText(permissionCode, ["permission === \"media\"", "mediaTypes.length === 1", "mediaTypes[0] === \"audio\"", "allowedOrigin"], "restricción de permisos");
  requireText(audioCode, ["getUserMedia({ audio: true, video: false })", "enumerateDevices()", "devicechange", "Predeterminado del sistema", "Comunicaciones del sistema"], "selector empaquetado");
  requireText(rendererCode, ["Logo del SENA", "Probar micrófono", "Actualizar", "Probando micrófono durante 4 segundos", "Recibiendo audio", "181 videos", "181 conceptos", "Biblioteca LSC", "Rápido, incluido y recomendado", "Arriba", "Abajo", "Flotante", "Frase confirmada", "Local ·"], "consola y overlay empaquetados");
  requireText(sidecarCode, ["KaldiRecognizer(model, sample_rate)", "SetWords(True)", "SetPartialWords(True)", "PartialDeduplicator", "configure_endpointing", "endpointLatencyMs", "cpuTimeMs"], "sidecar abierto empaquetado");
  if (sidecarCode.includes("KaldiRecognizer(model, sample_rate, grammar)")) fail("el sidecar empaquetado vuelve a restringir conversación abierta a una gramática cerrada");
  const unifiedCatalog = JSON.parse(await readFile(join(resources, "assets", "lsc", "unified-lsc-catalog.json"), "utf8"));
  if (unifiedCatalog.after?.videos !== 181 || unifiedCatalog.after?.concepts !== 181 || unifiedCatalog.after?.duplicateCanonicalKeys !== 0 || unifiedCatalog.after?.orphanVideos?.length !== 0 || unifiedCatalog.after?.missingVideos?.length !== 0) fail("el catálogo unificado empaquetado no prueba 181 conceptos sin duplicados ni huérfanos");

  const notices = await readFile(join(resources, "THIRD_PARTY_NOTICES.md"), "utf8");
  requireText(notices, ["Python", "Vosk", "LSC50", "EXPRESA", "UniValle"], "atribuciones");
  const textualPayload = `${await readTextResources(resources, files)}\n${mainCode}\n${permissionCode}\n${audioCode}\n${rendererCode}`;
  if (/(?:^|["'\s])(\/home\/|\/tmp\/|\/usr\/|\/opt\/|\/var\/)/m.test(textualPayload)) fail("el portable contiene una ruta absoluta Linux");
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(textualPayload)) fail("el portable contiene una clave privada");

  const size = (await stat(artifact)).size;
  const sha256 = await sha256File(artifact);
  await writeFile(join(root, "release", "LEEME-SENALSC-WINDOWS.txt"), [
    `1. Copie ${COMPLETE_ARTIFACT} al computador Windows.`,
    `2. Haga doble clic en ${COMPLETE_ARTIFACT}.`,
    "3. Permita el acceso al micrófono.",
    "4. En la consola de activación, elija el dispositivo de entrada (por ejemplo, WO Mic).",
    "5. Pulse Probar micrófono y confirme que recibe audio.",
    "6. Elija Arriba, Abajo o Flotante y ajuste tamaño/ancho si lo necesita.",
    "7. Use Rápido, incluido y recomendado. Preciso solo funciona si el modelo grande está instalado aparte y puede tardar en cargar.",
    "8. Pulse Iniciar subtítulos. El micrófono nunca se inicia automáticamente.",
    "9. La ventana se ocultará; use el icono de SenaLSC en la bandeja para detener o volver a mostrar la configuración.",
    "",
    "Contenido: 181 videos para 181 conceptos canónicos; 0 claves duplicadas y 0 assets huérfanos.",
    `Tamaño: ${size} bytes.`,
    `SHA-256: ${sha256}`,
    "Procesamiento: local/offline. El audio no se guarda ni se envía a internet.",
    "Limitación: los subtítulos automáticos pueden contener errores. El portable incluye el modelo Rápido, no el modelo grande Preciso.",
    "",
    "SenaLSC es un proyecto académico SENA. No es una aplicación oficial ni reemplaza a un intérprete de LSC.",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "release", "SenaLSC-Portable-Completo-0.1.0-x64.sha256.txt"), `${sha256}  ${COMPLETE_ARTIFACT}\n`, "utf8");
  console.log(JSON.stringify({
    artifact: `release/${COMPLETE_ARTIFACT}`,
    size,
    sha256,
    distribution: metadata.senalscDistribution,
    packageScripts: metadata.scripts ?? null,
    applicationExecutable: "PE32+ AMD64",
    extractedFiles: extractedFiles.length,
    internalFiles: files.length,
    runtime: runtimeSummary,
    model: modelSummary,
    media,
    microphoneSecurity: "audio-only-local-origin",
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : "error desconocido");
} finally {
  await rm(extraction, { recursive: true, force: true });
}
