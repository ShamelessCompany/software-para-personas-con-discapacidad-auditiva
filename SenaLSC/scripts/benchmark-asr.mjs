import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const ITERATIONS = 5;
const PROFILES = [
  { profile: "light", model: "models/vosk-model-small-es-0.42" },
  { profile: "precise", model: "models/vosk-model-es-0.42" },
];
const python = process.platform === "win32" ? "python" : resolve(".venv/bin/python");

function percentile(values, fraction) {
  return values[Math.floor((values.length - 1) * fraction)] ?? 0;
}

function run(profile, model) {
  return new Promise((resolveRun, reject) => {
    const startedAt = performance.now();
    const child = spawn(python, ["sidecar/asr.py", resolve(model), "16000", profile, resolve("models/vosk-model-small-es-0.42")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = createInterface({ input: child.stdout });
    let stderr = "";
    let ready = null;
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    output.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.type !== "ready" || ready) return;
      ready = { ...message, readyMs: Number((performance.now() - startedAt).toFixed(3)) };
      child.stdin.end(`${JSON.stringify({ type: "stop" })}\n`);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      output.close();
      if (code !== 0 || !ready) {
        reject(new Error(`ASR ${profile} terminó sin ready (código ${code}): ${stderr.trim()}`));
        return;
      }
      resolveRun(ready);
    });
  });
}

const measurements = [];
for (const { profile, model } of PROFILES) {
  const runs = [];
  for (let index = 0; index < ITERATIONS; index += 1) runs.push(await run(profile, model));
  const readyTimes = runs.map((runResult) => runResult.readyMs).sort((left, right) => left - right);
  measurements.push({
    profile,
    model: runs[0].modelName,
    activeProfile: runs[0].activeProfile,
    languageMode: runs[0].languageMode,
    endpointingMode: runs[0].endpointingMode,
    endpointing: runs[0].endpointing,
    iterations: ITERATIONS,
    readyP50Ms: percentile(readyTimes, 0.5),
    readyP95Ms: percentile(readyTimes, 0.95),
    readyTimesMs: readyTimes,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  measurement: "process-start-to-ready without microphone or speech",
  measurements,
  limitations: [
    "These values measure model/process readiness, not first-partial or endpoint-final latency.",
    "No labeled local speech fixture is bundled; WER and speech p50/p95 are therefore not reported.",
  ],
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/asr-benchmark.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
