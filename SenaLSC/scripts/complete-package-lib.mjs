import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const COMPLETE_ARTIFACT = "SenaLSC-Portable-Completo-0.1.0-x64.exe";
export const REQUIRED_MODEL_FILES = [
  "am/final.mdl",
  "conf/mfcc.conf",
  "conf/model.conf",
  "graph/Gr.fst",
  "graph/HCLr.fst",
  "graph/disambig_tid.int",
  "graph/phones/word_boundary.int",
  "ivector/final.dubm",
  "ivector/final.ie",
  "ivector/final.mat",
  "ivector/global_cmvn.stats",
  "ivector/online_cmvn.conf",
  "ivector/splice.conf",
];

export function validatePeX64(buffer, minimumSize = 16 * 1024) {
  if (buffer.length < minimumSize) return `el ejecutable es demasiado pequeño (${buffer.length} bytes)`;
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) return "falta la cabecera DOS MZ";
  const offset = buffer.readUInt32LE(0x3c);
  if (offset < 0x40 || offset + 26 > buffer.length) return "el offset PE es inválido";
  if (!buffer.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) return "la firma PE es inválida";
  if (buffer.readUInt16LE(offset + 4) !== 0x8664) return "la arquitectura no es AMD64/x64";
  if (buffer.readUInt16LE(offset + 24) !== 0x20b) return "la cabecera no es PE32+";
  return null;
}

export async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

export async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function summarizeFiles(directory) {
  const files = await listFiles(directory);
  let size = 0;
  for (const file of files) size += (await stat(join(directory, file))).size;
  return { files, size };
}

export async function treeSummary(directory, excluded = new Set()) {
  const files = (await listFiles(directory)).filter((file) => !excluded.has(file));
  const hash = createHash("sha256");
  let size = 0;
  for (const file of files) {
    const buffer = await readFile(join(directory, file));
    size += buffer.length;
    hash.update(file).update("\0").update(buffer).update("\0");
  }
  return { files: files.length, size, sha256: hash.digest("hex") };
}

export async function validateModel(modelDirectory) {
  const files = await listFiles(modelDirectory);
  const missing = REQUIRED_MODEL_FILES.filter((file) => !files.includes(file));
  return { files, missing };
}

export function countMedia(files) {
  return {
    mp4: files.filter((file) => file.toLocaleLowerCase("en-US").endsWith(".mp4")).length,
    manifests: files.filter((file) => file.endsWith("/manifest.json")).length,
    svg: files.filter((file) => file.toLocaleLowerCase("en-US").endsWith(".svg")).length,
  };
}
