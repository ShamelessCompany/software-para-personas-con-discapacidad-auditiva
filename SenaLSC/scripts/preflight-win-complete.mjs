import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { countMedia, listFiles, treeSummary, validateModel, validatePeX64 } from "./complete-package-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const runtime = join(root, "resources", "embedded-asr");
const model = join(root, "models", "vosk-model-small-es-0.42");
const media = join(root, "assets", "lsc");

function fail(message) {
  console.error(`Preflight Windows completo falló: ${message}`);
  process.exit(1);
}

try {
  const manifest = JSON.parse(await readFile(join(runtime, "embedded-asr.manifest.json"), "utf8"));
  if (manifest.formatVersion !== 1 || manifest.platform !== "win32" || manifest.architecture !== "x64") fail("manifiesto ASR incompatible");
  for (const file of manifest.requiredFiles ?? []) await access(join(runtime, file));
  await access(join(root, "sidecar", "asr.py"));

  const pythonw = await readFile(join(runtime, "pythonw.exe"));
  const peError = validatePeX64(pythonw);
  if (peError) fail(`pythonw.exe: ${peError}`);
  const voskDll = await readFile(join(runtime, "site-packages", "vosk", "libvosk.dll"));
  const voskPeError = validatePeX64(voskDll, 64 * 1024);
  if (voskPeError) fail(`libvosk.dll: ${voskPeError}`);
  const cffi = (await listFiles(join(runtime, "site-packages"))).find((file) => /^_cffi_backend.*\.pyd$/.test(file));
  if (!cffi) fail("falta el módulo nativo _cffi_backend para CPython 3.12");
  const pth = await readFile(join(runtime, "python312._pth"), "utf8");
  if (!pth.split(/\r?\n/).includes("site-packages") || !pth.includes("import site")) fail("python312._pth no habilita site-packages");

  const modelResult = await validateModel(model);
  if (modelResult.missing.length > 0) fail(`modelo incompleto: ${modelResult.missing.join(", ")}`);
  if (modelResult.files.length !== manifest.model.files) fail("el número de archivos del modelo no coincide con el manifiesto");
  const modelSummary = await treeSummary(model);
  if (modelSummary.size !== manifest.model.size || modelSummary.sha256 !== manifest.model.sha256) fail("el hash de árbol del modelo no coincide con el manifiesto");
  const runtimeSummary = await treeSummary(runtime, new Set(["embedded-asr.manifest.json"]));
  if (runtimeSummary.files !== manifest.runtime.files || runtimeSummary.size !== manifest.runtime.size || runtimeSummary.sha256 !== manifest.runtime.sha256) fail("el hash de árbol del runtime no coincide con el manifiesto");

  const mediaFiles = await listFiles(media);
  const mediaCount = countMedia(mediaFiles);
  if (mediaCount.mp4 !== 181 || mediaCount.manifests !== 3 || mediaCount.svg !== 0) fail(`medios inválidos: ${JSON.stringify(mediaCount)}`);
  const unifiedCatalog = JSON.parse(await readFile(join(media, "unified-lsc-catalog.json"), "utf8"));
  if (unifiedCatalog.after?.videos !== 181 || unifiedCatalog.after?.concepts !== 181 || unifiedCatalog.after?.duplicateCanonicalKeys !== 0 || unifiedCatalog.after?.orphanVideos?.length !== 0 || unifiedCatalog.after?.missingVideos?.length !== 0) fail("el catálogo unificado no prueba 181 conceptos físicos sin duplicados ni huérfanos");
  await access(join(root, "THIRD_PARTY_NOTICES.md"));

  const config = await readFile(join(root, "electron-builder.complete.yml"), "utf8");
  if (!config.includes("complete-windows") || config.includes("senalscDistribution: demo")) fail("la configuración no identifica el portable completo no-demo");
  for (const required of ["resources/embedded-asr", "models/vosk-model-small-es-0.42", "assets/lsc", "THIRD_PARTY_NOTICES.md"]) {
    if (!config.includes(required)) fail(`extraResources no incluye ${required}`);
  }
  if (/\.venv|build-windows\.ps1|requirements-build|python\.exe\b/.test(config)) fail("la configuración incluye preparación o source innecesario");

  const runtimeSize = (await stat(join(runtime, "pythonw.exe"))).size;
  console.log(`Preflight completo correcto: pythonw PE32+ AMD64 (${runtimeSize} bytes), Vosk/DLLs, modelo de ${modelResult.files.length} archivos y ${mediaCount.mp4} MP4 verificados.`);
} catch (error) {
  fail(error instanceof Error ? error.message : "error desconocido");
}
