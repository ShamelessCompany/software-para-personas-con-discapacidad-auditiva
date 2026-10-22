#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SIGNS = [
  ["0000", "Gracias", "gracias"], ["0001", "Buenos días", "buenos-dias"], ["0002", "Buenas tardes", "buenas-tardes"],
  ["0003", "Buenas noches", "buenas-noches"], ["0004", "Seña", "sena"], ["0005", "Nombre", "nombre"],
  ["0006", "Trabajar", "trabajar"], ["0007", "Comer", "comer"], ["0008", "Vivir", "vivir"], ["0009", "Poco", "poco"],
  ["0010", "Familia", "familia"], ["0011", "Personas", "personas"], ["0012", "Mujer", "mujer"],
  ["0013", "Hombre", "hombre"], ["0014", "Niño", "nino"], ["0015", "Niña", "nina"], ["0016", "Abuelo", "abuelo"],
  ["0017", "Tío", "tio"], ["0018", "Hermano", "hermano"], ["0019", "Hambre", "hambre"], ["0020", "Feliz", "feliz"],
  ["0021", "Contento", "contento"], ["0022", "Triste", "triste"], ["0023", "Aburrido", "aburrido"],
  ["0024", "Bien", "bien"], ["0025", "Mal", "mal"], ["0026", "¿Cómo estás?", "como-estas"],
  ["0027", "Más o menos", "mas-o-menos"], ["0028", "Sentir", "sentir"], ["0029", "Juicioso", "juicioso"],
  ["0030", "Hola", "hola"], ["0031", "Adiós", "adios"], ["0032", "Por favor", "por-favor"],
  ["0033", "Con gusto", "con-gusto"], ["0034", "Bienvenido", "bienvenido"], ["0035", "Perdón", "perdon"],
  ["0036", "Permiso", "permiso"], ["0037", "Nunca", "nunca"], ["0038", "Yo", "yo"], ["0039", "Tú", "tu"],
  ["0040", "Ustedes", "ustedes"], ["0041", "¿Qué?", "que"], ["0042", "¿Cuándo?", "cuando"],
  ["0043", "¿Dónde?", "donde"], ["0044", "¿Cómo?", "como"], ["0045", "¿Por qué?", "por-que"],
  ["0046", "¿Quién?", "quien"], ["0047", "Diferente", "diferente"], ["0048", "Todos", "todos"], ["0049", "Mucho", "mucho"],
];

const SOURCE = {
  title: "LSC50: Colombian Sign Language Video and Inertial Measurement Dataset",
  year: 2024,
  authors: ["Christian Cifuentes-De la Portilla", "Luis Felipe Giraldo", "Brayan David Solórzano Quevedo"],
  doi: "10.6084/m9.figshare.27383016.v1",
  url: "https://figshare.com/articles/dataset/LSC50_Colombian_Sign_Language_Video_and_Inertial_Measurement_Dataset/27383016",
};
const LICENSE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const TRANSFORMATION = "Selected one COLOR_BODY recording per class (volunteer 0000, repetition 0000); converted AVI MPEG-4 1920x1080 to MP4 H.264 1280x720, yuv420p, CRF 28, faststart; audio removed; no trim, mirror, speed change, or looping added.";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function duration(path) {
  return Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", path]).trim());
}

async function main() {
  const inputDirectory = resolve(process.argv[2] ?? "");
  const outputDirectory = resolve(process.argv[3] ?? "assets/lsc/lsc50");
  if (!process.argv[2]) throw new Error("Usage: prepare-lsc50-assets.mjs <AVI directory> [output directory]");
  await mkdir(outputDirectory, { recursive: true });
  const clips = [];

  for (const [classId, phrase, slug] of SIGNS) {
    const originalName = `${classId}_0000_0000.avi`;
    const sourcePath = join(inputDirectory, originalName);
    const outputName = `${classId}-${slug}.mp4`;
    const outputPath = join(outputDirectory, outputName);
    run("ffmpeg", ["-v", "error", "-y", "-i", sourcePath, "-map", "0:v:0", "-an", "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", outputPath]);
    const originalStats = await stat(sourcePath);
    const convertedStats = await stat(outputPath);
    clips.push({
      classId,
      phrase,
      originalName: `VIDEOS/COLOR_BODY/${originalName}`,
      originalSha256: await sha256(sourcePath),
      originalBytes: originalStats.size,
      convertedName: outputName,
      convertedSha256: await sha256(outputPath),
      convertedBytes: convertedStats.size,
      durationMs: Math.round(duration(outputPath) * 1000),
      source: SOURCE,
      license: LICENSE,
      transformation: TRANSFORMATION,
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    archive: { name: "VIDEOS.zip", url: "https://ndownloader.figshare.com/files/50118645", bytes: 6247307413, md5: "26003107442257c7947352b18e3c2597" },
    selection: { videoType: "COLOR_BODY", volunteerId: "0000", repetitionId: "0000", participantHearingStatus: "not documented by encoded volunteer ID" },
    clips,
  };
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ clips: clips.length, convertedBytes: clips.reduce((total, clip) => total + clip.convertedBytes, 0) }, null, 2)}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
