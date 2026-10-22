import { access, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const requiredFiles = [
  "dist/renderer/index.html",
  "dist-electron/main/index.js",
  "dist-electron/preload/index.js",
  "sidecar/asr.py",
  "assets/lsc/README.md",
  "assets/lsc/unified-lsc-catalog.json",
  "assets/lsc/lsc50/manifest.json",
  "assets/lsc/lsc50/0000-gracias.mp4",
  "assets/lsc/lsc50/0049-mucho.mp4",
  "assets/lsc/univalle/manifest.json",
  "assets/lsc/univalle/01-bonito.mp4",
  "assets/brand/sena-logo-original.png",
  "assets/brand/sena-logo-ui.png",
  "assets/icons/icon-16.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon.ico",
  "assets/icons/tray-on-light.png",
  "assets/icons/tray-on-dark.png",
  "THIRD_PARTY_NOTICES.md",
];

await Promise.all(requiredFiles.map((file) => access(file)));
const bundledEntries = await readdir("assets/lsc");
const catalogEntries = await readdir("assets/lsc/lsc50");
if (bundledEntries.sort().join(",") !== "README.md,expresa,lsc50,unified-lsc-catalog.json,univalle") throw new Error("El paquete fuente contiene catálogos visuales no autorizados.");
if (catalogEntries.filter((file) => file.endsWith(".mp4")).length !== 50 || catalogEntries.some((file) => file.endsWith(".svg"))) {
  throw new Error("El catálogo incorporado debe contener exactamente 50 MP4 y ningún SVG.");
}
const univalleEntries = await readdir("assets/lsc/univalle");
if (univalleEntries.filter((file) => file.endsWith(".mp4")).length !== 2 || univalleEntries.some((file) => file.endsWith(".svg"))) throw new Error("UniValle debe contener 2 MP4 canónicos y ningún SVG.");
const expresaEntries = await readdir("assets/lsc/expresa", { recursive: true });
if (expresaEntries.filter((file) => file.endsWith(".mp4")).length !== 129 || expresaEntries.some((file) => file.endsWith(".svg"))) throw new Error("EXPRESA debe contener 129 MP4 y ningún SVG.");
const html = await readFile("dist/renderer/index.html", "utf8");
if (!html.includes("Content-Security-Policy")) throw new Error("El build del renderer no conserva la CSP.");
if (!html.includes("senalsc-media:")) throw new Error("La CSP no permite exclusivamente el protocolo administrado de medios.");
if (!html.includes("favicon.png")) throw new Error("El build del renderer no incluye el favicon derivado del logo.");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!packageJson.scripts?.["package:win"]?.startsWith("npm run package:win:preflight")) {
  throw new Error("El paquete Windows completo no ejecuta el preflight del sidecar.");
}
if (!packageJson.scripts?.["package:win:demo"]?.includes("electron-builder.demo.yml")) {
  throw new Error("El paquete Windows demo no usa una configuración rotulada e independiente.");
}
if (!packageJson.scripts?.["package:win:candidate"]?.includes("electron-builder.candidate.yml")) {
  throw new Error("El candidato Windows no usa una configuración independiente.");
}
const demoConfig = await readFile("electron-builder.demo.yml", "utf8");
if (!demoConfig.includes("productName: SenaLSC Demo") || !demoConfig.includes("senalscDistribution: demo") || demoConfig.includes("sidecar-bin")) {
  throw new Error("La configuración Windows demo no está rotulada correctamente o incluye el sidecar real.");
}
const candidateConfig = await readFile("electron-builder.candidate.yml", "utf8");
if (!candidateConfig.includes("Candidato No Validado") || candidateConfig.includes("VITE_SENALSC_DEMO") || candidateConfig.includes("sidecar-bin") || candidateConfig.includes("models")) {
  throw new Error("La configuración candidata no está rotulada o incorpora componentes ASR externos.");
}

const python = spawnSync(process.platform === "win32" ? "python" : "python3", ["sidecar/asr.py"], { encoding: "utf8" });
if (python.status !== 2 || !python.stdout.includes('"type": "error"')) {
  throw new Error("El sidecar no reportó correctamente argumentos ausentes.");
}

const builtMain = await readFile("dist-electron/main/index.js", "utf8");
if (!builtMain.includes("senalsc-media") || !builtMain.includes("MediaLibrary")) throw new Error("El build final no contiene el protocolo y la biblioteca visual.");
console.log(`Smoke correcto: ${requiredFiles.length} artefactos, 181 MP4 y 0 SVG, catálogo canónico, CSP, protocolo de medios, paquetes Windows y sidecar verificados.`);
