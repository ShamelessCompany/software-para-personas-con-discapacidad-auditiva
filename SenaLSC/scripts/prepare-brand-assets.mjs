import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const brandDirectory = join(root, "assets", "brand");
const iconDirectory = join(root, "assets", "icons");
const rendererPublicDirectory = join(root, "src", "renderer", "public");
const source = join(brandDirectory, "sena-logo-original.png");
const expectedSourceHash = "d5c537cae2b1a2e0943874c97bddcd72e2b04c7b8cde1fcdc7a080dcfcc9c6c9";
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

function runMagick(args) {
  const result = spawnSync("magick", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `ImageMagick falló: ${args.join(" ")}`);
  return result.stdout.trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function validatePng(path, width, height) {
  const metadata = runMagick([path, "-format", "%w|%h|%[channels]|%[opaque]|%[fx:p{0,0}.a]|%[fx:p{0,h-1}.a]|%[fx:p{w-1,0}.a]|%[fx:p{w-1,h-1}.a]", "info:"]);
  const [actualWidth, actualHeight, channels, opaque, ...corners] = metadata.split("|");
  if (Number(actualWidth) !== width || Number(actualHeight) !== height) throw new Error(`${path} tiene dimensiones inesperadas: ${actualWidth}x${actualHeight}.`);
  if (!channels.toLocaleLowerCase("en-US").includes("a") || opaque.toLocaleLowerCase("en-US") !== "false") throw new Error(`${path} perdió la transparencia.`);
  if (corners.some((corner) => Number(corner) !== 0)) throw new Error(`${path} tiene un fondo accidental en las esquinas.`);
}

await mkdir(brandDirectory, { recursive: true });
await mkdir(iconDirectory, { recursive: true });
await mkdir(rendererPublicDirectory, { recursive: true });

const sourceBuffer = await readFile(source);
if (sha256(sourceBuffer) !== expectedSourceHash) throw new Error("El logo original no coincide con el hash documentado.");
const sourceMetadata = runMagick([source, "-format", "%w %h %[channels] %[opaque]", "info:"]);
if (!sourceMetadata.startsWith("185 185 srgba ") || !sourceMetadata.toLocaleLowerCase("en-US").endsWith(" false")) {
  throw new Error(`El logo original no conserva el formato esperado: ${sourceMetadata}.`);
}

runMagick([source, "-filter", "Lanczos", "-resize", "256x256", join(brandDirectory, "sena-logo-ui.png")]);
runMagick([source, "-filter", "Lanczos", "-resize", "64x64", join(brandDirectory, "favicon.png")]);
await cp(join(brandDirectory, "sena-logo-ui.png"), join(rendererPublicDirectory, "sena-logo-ui.png"));
await cp(join(brandDirectory, "favicon.png"), join(rendererPublicDirectory, "favicon.png"));

for (const size of sizes) {
  runMagick([source, "-background", "none", "-gravity", "center", "-resize", `${Math.max(1, size - 2)}x${Math.max(1, size - 2)}`, "-extent", `${size}x${size}`, join(iconDirectory, `icon-${size}.png`)]);
}
runMagick([source, "-background", "none", "-gravity", "center", "-resize", "504x504", "-extent", "512x512", join(iconDirectory, "icon.png")]);

// La bandeja usa la silueta alfa exacta del logo, sin redibujarla. Se recorta al bbox
// medido (171x166+7+9) para conservar detalle a 16–24 px.
const trayBase = [source, "-crop", "171x166+7+9", "+repage", "-resize", "18x18", "-gravity", "center", "-background", "none", "-extent", "20x20", "-channel", "A", "-threshold", "35%", "+channel"];
runMagick([...trayBase, "-channel", "RGB", "-fill", "#0F5C2D", "-colorize", "100", "+channel", join(iconDirectory, "tray-on-light.png")]);
runMagick([...trayBase, "-channel", "RGB", "-fill", "#F7FAF5", "-colorize", "100", "+channel", join(iconDirectory, "tray-on-dark.png")]);

const icoInputs = [16, 24, 32, 48, 64, 128, 256].map((size) => join(iconDirectory, `icon-${size}.png`));
runMagick([...icoInputs, join(iconDirectory, "icon.ico")]);

await validatePng(join(brandDirectory, "sena-logo-ui.png"), 256, 256);
await validatePng(join(brandDirectory, "favicon.png"), 64, 64);
await validatePng(join(rendererPublicDirectory, "sena-logo-ui.png"), 256, 256);
await validatePng(join(rendererPublicDirectory, "favicon.png"), 64, 64);
await validatePng(join(iconDirectory, "icon.png"), 512, 512);
for (const size of sizes) await validatePng(join(iconDirectory, `icon-${size}.png`), size, size);
await validatePng(join(iconDirectory, "tray-on-light.png"), 20, 20);
await validatePng(join(iconDirectory, "tray-on-dark.png"), 20, 20);

const icoFrames = runMagick([join(iconDirectory, "icon.ico"), "-format", "%wx%h\n", "info:"]).split("\n");
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  if (!icoFrames.includes(`${size}x${size}`)) throw new Error(`El ICO no contiene el frame ${size}x${size}.`);
}

console.log(`Marca preparada: logo 185x185, bbox alfa 171x166+7+9, verde medido #1A8545, ${sizes.length} iconos PNG e ICO multi-size.`);
