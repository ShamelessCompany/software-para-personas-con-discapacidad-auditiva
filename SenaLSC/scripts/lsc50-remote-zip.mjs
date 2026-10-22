#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";

const DEFAULT_URL = "https://ndownloader.figshare.com/files/50118645";
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

let transferredBytes = 0;

function numberFromBigInt(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the safe integer range.`);
  return Number(value);
}

async function fetchRange(url, start, end) {
  const response = await fetch(url, {
    headers: { Accept: "application/zip", "Accept-Encoding": "identity", Range: `bytes=${start}-${end}` },
    redirect: "follow",
  });
  if (response.status !== 206) throw new Error(`Server rejected Range ${start}-${end}: HTTP ${response.status}.`);
  const contentRange = response.headers.get("content-range");
  const expected = `bytes ${start}-${end}/`;
  if (!contentRange?.startsWith(expected)) throw new Error(`Unexpected Content-Range: ${contentRange ?? "missing"}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== end - start + 1) throw new Error(`Incomplete range ${start}-${end}: received ${buffer.length} bytes.`);
  transferredBytes += buffer.length;
  return { buffer, totalSize: Number(contentRange.slice(contentRange.lastIndexOf("/") + 1)) };
}

function findLastSignature(buffer, signature) {
  for (let offset = buffer.length - 4; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

async function readDirectory(url) {
  const probe = await fetchRange(url, 0, 0);
  const tailLength = Math.min(probe.totalSize, UINT16_MAX + 22);
  const tailStart = probe.totalSize - tailLength;
  const tail = (await fetchRange(url, tailStart, probe.totalSize - 1)).buffer;
  const eocdOffset = findLastSignature(tail, EOCD_SIGNATURE);
  if (eocdOffset < 0) throw new Error("ZIP end-of-central-directory record not found.");

  let entryCount = tail.readUInt16LE(eocdOffset + 10);
  let directorySize = tail.readUInt32LE(eocdOffset + 12);
  let directoryOffset = tail.readUInt32LE(eocdOffset + 16);
  if (entryCount === UINT16_MAX || directorySize === UINT32_MAX || directoryOffset === UINT32_MAX) {
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset < 0 || tail.readUInt32LE(locatorOffset) !== ZIP64_LOCATOR_SIGNATURE) throw new Error("ZIP64 locator not found.");
    const zip64Offset = numberFromBigInt(tail.readBigUInt64LE(locatorOffset + 8), "ZIP64 EOCD offset");
    const zip64 = (await fetchRange(url, zip64Offset, zip64Offset + 55)).buffer;
    if (zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw new Error("Invalid ZIP64 end-of-central-directory record.");
    entryCount = numberFromBigInt(zip64.readBigUInt64LE(32), "ZIP entry count");
    directorySize = numberFromBigInt(zip64.readBigUInt64LE(40), "ZIP central-directory size");
    directoryOffset = numberFromBigInt(zip64.readBigUInt64LE(48), "ZIP central-directory offset");
  }

  const central = (await fetchRange(url, directoryOffset, directoryOffset + directorySize - 1)).buffer;
  const entries = [];
  let cursor = 0;
  while (cursor < central.length && entries.length < entryCount) {
    if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error(`Invalid central-directory entry at offset ${cursor}.`);
    const method = central.readUInt16LE(cursor + 10);
    const crc32 = central.readUInt32LE(cursor + 16);
    let compressedSize = central.readUInt32LE(cursor + 20);
    let uncompressedSize = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    let localOffset = central.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = central.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const extra = central.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);

    if (compressedSize === UINT32_MAX || uncompressedSize === UINT32_MAX || localOffset === UINT32_MAX) {
      let extraCursor = 0;
      while (extraCursor + 4 <= extra.length) {
        const id = extra.readUInt16LE(extraCursor);
        const size = extra.readUInt16LE(extraCursor + 2);
        if (id === 0x0001) {
          let valueCursor = extraCursor + 4;
          if (uncompressedSize === UINT32_MAX) {
            uncompressedSize = numberFromBigInt(extra.readBigUInt64LE(valueCursor), `${name} uncompressed size`);
            valueCursor += 8;
          }
          if (compressedSize === UINT32_MAX) {
            compressedSize = numberFromBigInt(extra.readBigUInt64LE(valueCursor), `${name} compressed size`);
            valueCursor += 8;
          }
          if (localOffset === UINT32_MAX) localOffset = numberFromBigInt(extra.readBigUInt64LE(valueCursor), `${name} local offset`);
          break;
        }
        extraCursor += 4 + size;
      }
    }

    entries.push({ name, method, crc32: crc32.toString(16).padStart(8, "0"), compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length !== entryCount) throw new Error(`Expected ${entryCount} entries but parsed ${entries.length}.`);
  return { entries, archiveSize: probe.totalSize, directoryOffset, directorySize };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

async function extractEntry(url, entry, destination) {
  const header = (await fetchRange(url, entry.localOffset, entry.localOffset + 29)).buffer;
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`Invalid local header for ${entry.name}.`);
  const dataOffset = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const compressed = (await fetchRange(url, dataOffset, dataOffset + entry.compressedSize - 1)).buffer;
  const contents = entry.method === 0 ? compressed : entry.method === 8 ? inflateRawSync(compressed) : null;
  if (!contents) throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
  if (contents.length !== entry.uncompressedSize) throw new Error(`Unexpected uncompressed size for ${entry.name}.`);
  if (crc32(contents) !== entry.crc32) throw new Error(`CRC mismatch for ${entry.name}.`);
  await pipeline(Readable.from(contents), createWriteStream(destination, { flags: "wx" }));
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  const options = { command, url: DEFAULT_URL, selection: "", output: "" };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--url" && value) options.url = value;
    else if (args[index] === "--selection" && value) options.selection = value;
    else if (args[index] === "--output" && value) options.output = value;
    else continue;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.command || !["list", "extract"].includes(options.command)) {
    throw new Error("Usage: lsc50-remote-zip.mjs list | extract --selection entries.json --output directory");
  }
  const directory = await readDirectory(options.url);
  if (options.command === "list") {
    const output = `${JSON.stringify({ ...directory, transferredBytes }, null, 2)}\n`;
    if (options.output) await writeFile(options.output, output, { flag: "wx" });
    else process.stdout.write(output);
    return;
  }
  if (!options.selection || !options.output) throw new Error("extract requires --selection and --output.");
  const selectedNames = JSON.parse(await readFile(options.selection, "utf8"));
  if (!Array.isArray(selectedNames) || selectedNames.some((name) => typeof name !== "string")) throw new Error("Selection must be a JSON array of exact ZIP entry names.");
  const entriesByName = new Map(directory.entries.map((entry) => [entry.name, entry]));
  await mkdir(options.output, { recursive: true });
  for (const name of selectedNames) {
    const entry = entriesByName.get(name);
    if (!entry || name.endsWith("/")) throw new Error(`Selected ZIP entry not found: ${name}`);
    await extractEntry(options.url, entry, join(options.output, basename(name)));
  }
  process.stdout.write(`${JSON.stringify({ extracted: selectedNames.length, transferredBytes }, null, 2)}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
