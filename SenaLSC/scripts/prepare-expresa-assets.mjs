import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const ARCHIVE_ORIGIN = "https://archive.org";
const LICENSE = "CC BY-NC-ND 3.0 Unported";
const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-nd/3.0/";
const ATTRIBUTION = "Jhonny Alejandro Pérez Rojas, con colaboración de Luz Adriana Ruiz González · Proyecto EXPRESA";
const MAX_BYTES = 250_000_000;
const OUTPUT_ROOT = resolve("assets/lsc/expresa");

const names = (value) => value.split(" ").map((name) => `${name}.mp4`);

export const EXPRESA_SELECTION = {
  alfabeto_expresa: {
    category: "alfabeto",
    files: names("a b c d e enie f g h i j k l m n o p q r s t u v w x y z"),
  },
  tecnologia_expresa: { category: "tecnologia", files: "all" },
  colegio_expresa: { category: "colegio", files: "all" },
  hogar_expresa: {
    category: "hogar",
    files: names("bano cama cobija cocina cuchara cuchillo dormitorio ducha hijo hogar inodoro lampara lavamanos mama mesa olla papa sala sofa tenedor"),
  },
  comidas_bebidas_expresa: {
    category: "comida-bebida",
    files: names("agua arroz bebida cafe carne comida huevo jugo leche pan sopa"),
  },
  cuerpo_expresa: {
    category: "cuerpo-acciones",
    files: names("boca brazo cabeza corazon cuerpo dedo dormir jugar mano nariz ojo pie reir"),
  },
};

const GLOSS_OVERRIDES = {
  enie: "Ñ",
  bano: "Baño",
  cafe: "Café",
  camara: "Cámara",
  camion: "Camión",
  corazon: "Corazón",
  helicoptero: "Helicóptero",
  lampara: "Lámpara",
  mama: "Mamá",
  papa: "Papá",
  reir: "Reír",
  tecnologia: "Tecnología",
  telefono: "Teléfono",
  television: "Televisión",
};

function glossFromName(name) {
  const stem = basename(name, ".mp4");
  const explicit = GLOSS_OVERRIDES[stem];
  if (explicit) return explicit;
  const value = stem.replaceAll("_", " ");
  return value.length === 1 ? value.toLocaleUpperCase("es-CO") : `${value[0].toLocaleUpperCase("es-CO")}${value.slice(1)}`;
}

async function hashFile(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadWithResume(url, destination, expectedBytes) {
  const partial = `${destination}.part`;
  let offset = 0;
  try { offset = (await stat(partial)).size; } catch { offset = 0; }
  if (offset > expectedBytes) {
    await rm(partial, { force: true });
    offset = 0;
  }
  if (offset < expectedBytes) {
    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body || (offset > 0 && response.status !== 206)) {
      if (offset > 0) {
        await rm(partial, { force: true });
        return downloadWithResume(url, destination, expectedBytes);
      }
      throw new Error(`No se pudo descargar ${url}: HTTP ${response.status}`);
    }
    await pipeline(response.body, createWriteStream(partial, { flags: offset > 0 ? "a" : "w" }));
  }
  const downloaded = await stat(partial);
  if (downloaded.size !== expectedBytes) throw new Error(`Tamaño incorrecto para ${url}: ${downloaded.size}/${expectedBytes}`);
  await rename(partial, destination);
}

function inspectCodec(path) {
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", path], { encoding: "utf8" });
  if (result.status !== 0) return { playable: false, codec: "desconocido" };
  const codec = result.stdout.trim();
  return { playable: ["h264", "vp8", "vp9", "av1"].includes(codec), codec };
}

async function metadata(identifier) {
  const response = await fetch(`${ARCHIVE_ORIGIN}/metadata/${identifier}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`No se pudo consultar metadata de ${identifier}.`);
  return response.json();
}

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const clips = [];
  const omitted = [];
  let selectedBytes = 0;

  for (const [identifier, selection] of Object.entries(EXPRESA_SELECTION)) {
    const item = await metadata(identifier);
    const originals = (item.files ?? []).filter((file) => /\.(mp4|webm)$/i.test(file.name ?? "") && file.source === "original");
    const selected = selection.files === "all" ? originals : originals.filter((file) => selection.files.includes(file.name));
    const missing = selection.files === "all" ? [] : selection.files.filter((name) => !selected.some((file) => file.name === name));
    if (missing.length > 0) throw new Error(`${identifier} no contiene originales esperados: ${missing.join(", ")}`);
    const collectionDirectory = join(OUTPUT_ROOT, identifier);
    await mkdir(collectionDirectory, { recursive: true });

    for (const file of selected) {
      const expectedBytes = Number(file.size);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) throw new Error(`Tamaño oficial inválido: ${identifier}/${file.name}`);
      selectedBytes += expectedBytes;
      if (selectedBytes > MAX_BYTES) throw new Error(`La selección supera el objetivo de ${MAX_BYTES} bytes.`);
      const encodedName = file.name.split("/").map(encodeURIComponent).join("/");
      const fileUrl = `${ARCHIVE_ORIGIN}/download/${identifier}/${encodedName}`;
      const destination = join(collectionDirectory, file.name);
      let validExisting = false;
      try {
        validExisting = (await stat(destination)).size === expectedBytes && (!file.md5 || await hashFile(destination, "md5") === file.md5);
      } catch { validExisting = false; }
      if (!validExisting) {
        await rm(destination, { force: true });
        await downloadWithResume(fileUrl, destination, expectedBytes);
      }
      const [md5, sha1, sha256] = await Promise.all([hashFile(destination, "md5"), hashFile(destination, "sha1"), hashFile(destination, "sha256")]);
      if (file.md5 && md5 !== file.md5) throw new Error(`MD5 no coincide: ${identifier}/${file.name}`);
      if (file.sha1 && sha1 !== file.sha1) throw new Error(`SHA-1 no coincide: ${identifier}/${file.name}`);
      const media = inspectCodec(destination);
      if (!media.playable) {
        omitted.push({ identifier, originalName: file.name, reason: `Códec no reproducible sin transformación: ${media.codec}` });
        await rm(destination, { force: true });
        selectedBytes -= expectedBytes;
        continue;
      }
      clips.push({
        id: `expresa-${identifier.replace("_expresa", "")}-${basename(file.name, ".mp4").replace(/[^a-z0-9]+/gi, "-").toLocaleLowerCase("es-CO")}`,
        identifier,
        itemUrl: `${ARCHIVE_ORIGIN}/details/${identifier}`,
        fileUrl,
        originalName: file.name,
        storedPath: `${identifier}/${file.name}`,
        bytes: expectedBytes,
        officialHash: { md5: file.md5 ?? null, sha1: file.sha1 ?? null },
        calculatedHash: { md5, sha1, sha256 },
        gloss: glossFromName(file.name),
        category: selection.category,
        source: file.source,
        codec: media.codec,
        license: { name: LICENSE, url: LICENSE_URL },
        attribution: ATTRIBUTION,
        transformation: "none",
      });
    }
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "Colección EXPRESA en Internet Archive",
    authorship: ATTRIBUTION,
    license: { name: LICENSE, url: LICENSE_URL, restrictions: ["non-commercial", "no-derivatives"] },
    selectionPolicy: "Una toma original por concepto; alfabeto y tecnología completos, colegio completo y vocabulario cotidiano priorizado. Sin cuentos ni archivos derivados de Internet Archive.",
    limits: { targetBytes: MAX_BYTES, hardMaximumBytes: 400_000_000, selectedBytes },
    clips,
    omitted,
  };
  await writeFile(join(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`EXPRESA preparado: ${clips.length} originales, ${selectedBytes} bytes, ${omitted.length} omitidos.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await main();
}
