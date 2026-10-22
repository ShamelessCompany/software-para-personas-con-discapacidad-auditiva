import { spawnSync } from "node:child_process";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { extractFile, listPackage } from "@electron/asar";
import { countMedia, listFiles, sha256File } from "./complete-package-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const artifactName = "SenaLSC-0.1.0-x86_64.AppImage";
const artifact = join(root, "release", artifactName);
const extraction = join(tmpdir(), "senalsc-appimage-inspection");

function fail(message) {
  console.error(`Inspección del AppImage falló: ${message}`);
  process.exit(1);
}

try {
  await rm(extraction, { recursive: true, force: true });
  await mkdir(extraction, { recursive: true });
  await chmod(artifact, 0o755);
  const result = spawnSync(artifact, ["--appimage-extract"], { cwd: extraction, encoding: "utf8", env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" } });
  if (result.status !== 0) fail(result.stderr.trim() || "no se pudo extraer el AppImage");
  const appDir = join(extraction, "squashfs-root");
  const files = await listFiles(appDir);
  const resources = join(appDir, "resources");
  const resourceFiles = await listFiles(resources);
  const media = countMedia(resourceFiles.filter((file) => file.startsWith("assets/lsc/")));
  if (media.mp4 !== 181 || media.manifests !== 3 || media.svg !== 0) fail(`medios internos inválidos: ${JSON.stringify(media)}`);
  for (const file of [
    "assets/brand/sena-logo-original.png",
    "assets/brand/sena-logo-ui.png",
    "assets/icons/icon-16.png",
    "assets/icons/icon-256.png",
    "assets/icons/icon-512.png",
    "assets/icons/tray-on-light.png",
    "assets/icons/tray-on-dark.png",
    "app.asar",
  ]) {
    if (!resourceFiles.includes(file)) fail(`falta resources/${file}`);
  }
  if (resourceFiles.some((file) => file.startsWith("assets/") && file.endsWith(".svg"))) fail("el AppImage contiene un SVG visual fabricado");
  const appAsar = join(resources, "app.asar");
  const asarFiles = listPackage(appAsar).map((file) => file.replace(/^\//, ""));
  for (const file of ["dist/renderer/favicon.png", "dist/renderer/sena-logo-ui.png"]) {
    if (!asarFiles.includes(file)) fail(`app.asar no contiene ${file}`);
  }
  const rendererAsset = asarFiles.find((file) => /^dist\/renderer\/assets\/index-.*\.js$/.test(file));
  if (!rendererAsset) fail("falta el bundle del renderer");
  const rendererCode = extractFile(appAsar, rendererAsset).toString("utf8");
  for (const value of ["Logo del SENA", "Iniciar subtítulos", "Probar micrófono", "181 videos", "181 conceptos", "Biblioteca LSC", "Rápido, incluido y recomendado", "Arriba", "Abajo", "Flotante", "Frase confirmada", "Local ·"]) {
    if (!rendererCode.includes(value)) fail(`el renderer empaquetado no contiene ${value}`);
  }
  const size = (await stat(artifact)).size;
  const sha256 = await sha256File(artifact);
  console.log(JSON.stringify({ artifact: `release/${artifactName}`, size, sha256, extractedFiles: files.length, media, brand: "png-derived-no-svg" }));
} catch (error) {
  fail(error instanceof Error ? error.message : "error desconocido");
} finally {
  await rm(extraction, { recursive: true, force: true });
}
