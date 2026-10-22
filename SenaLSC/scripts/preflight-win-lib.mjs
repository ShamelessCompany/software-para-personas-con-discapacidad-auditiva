import { createHash } from "node:crypto";

export const SIDECAR_FILE = "senalsc-asr.exe";
export const MANIFEST_FORMAT_VERSION = 2;
export const SELF_TEST_PROTOCOL_VERSION = 1;
export const SELF_TEST_TIMEOUT_MS = 10_000;
export const MINIMUM_SIDECAR_SIZE = 64 * 1024;

const EXPECTED_SELF_TEST = {
  type: "self-test",
  status: "ok",
  protocolVersion: SELF_TEST_PROTOCOL_VERSION,
  engine: "vosk",
};

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePeX64(buffer) {
  if (buffer.length < MINIMUM_SIDECAR_SIZE) return `el sidecar es demasiado pequeño (${buffer.length} bytes)`;
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) return "el sidecar no tiene cabecera DOS MZ";
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 26 > buffer.length) return "el offset de cabecera PE es inválido";
  if (!buffer.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) return "la firma PE es inválida";
  if (buffer.readUInt16LE(peOffset + 4) !== 0x8664) return "la arquitectura no es AMD64/x64";
  if (buffer.readUInt16LE(peOffset + 20) < 2 || buffer.readUInt16LE(peOffset + 24) !== 0x20b) return "la cabecera opcional PE32+ es inválida";
  return null;
}

export function parseSelfTestOutput(stdout) {
  const output = stdout.trim();
  if (!output || output.includes("\n") || output.includes("\r")) return null;
  try {
    const payload = JSON.parse(output);
    if (!isObject(payload) || Object.keys(payload).length !== Object.keys(EXPECTED_SELF_TEST).length) return null;
    return Object.entries(EXPECTED_SELF_TEST).every(([key, value]) => payload[key] === value)
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validateManifest(manifest, fileSize, fileSha256) {
  if (!isObject(manifest) || !isObject(manifest.selfTest)) return false;
  return (
    manifest.formatVersion === MANIFEST_FORMAT_VERSION
    && manifest.file === SIDECAR_FILE
    && manifest.platform === "win32"
    && manifest.architecture === "x64"
    && manifest.size === fileSize
    && manifest.sha256 === fileSha256
    && manifest.selfTest.status === "passed"
    && manifest.selfTest.protocolVersion === SELF_TEST_PROTOCOL_VERSION
  );
}
