import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { Pcm16ChunkAggregator } from "../dist-electron/shared/audio.js";

const FRAME_MS = 20;
const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1_000;
const FRAMES = 30_000;
const BATCHES = [60, 40];

function percentile(values, fraction) {
  return values[Math.floor((values.length - 1) * fraction)] ?? 0;
}

function measure(batchMs) {
  const aggregator = new Pcm16ChunkAggregator(SAMPLE_RATE * batchMs / 1_000);
  const frame = new Int16Array(FRAME_SAMPLES);
  const samples = [];
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  let chunks = 0;
  for (let index = 0; index < FRAMES; index += 1) {
    const start = performance.now();
    chunks += aggregator.push(frame).length;
    samples.push((performance.now() - start) * 1_000);
  }
  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);
  samples.sort((left, right) => left - right);
  return {
    batchMs,
    frames: FRAMES,
    representedAudioMinutes: FRAMES * FRAME_MS / 60_000,
    chunks,
    wallMs: Number(wallMs.toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1_000).toFixed(3)),
    pushP50Us: Number(percentile(samples, 0.5).toFixed(3)),
    pushP95Us: Number(percentile(samples, 0.95).toFixed(3)),
    maximumAssemblyDelayMs: batchMs - FRAME_MS,
  };
}

const measurements = BATCHES.map(measure);
const selected = measurements.reduce((best, current) => (
  current.maximumAssemblyDelayMs < best.maximumAssemblyDelayMs && current.cpuMs <= best.cpuMs * 1.25
    ? current
    : best
));
const report = {
  generatedAt: new Date().toISOString(),
  fixture: "Synthetic zero PCM; measures batching overhead and assembly delay, not ASR accuracy or WER.",
  measurements,
  selectedBatchMs: selected.batchMs,
  limitations: [
    "No labeled speech fixture is bundled, so first-partial and endpoint-final p50/p95 are not asserted here.",
    "Runtime session telemetry reports first partial, endpoint-to-final, queue, overflows and sidecar CPU when speech is available.",
  ],
};

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/audio-benchmark.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
