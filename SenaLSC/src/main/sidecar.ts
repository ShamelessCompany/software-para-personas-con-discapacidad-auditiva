import { app } from "electron";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, normalize } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { ASR_ENDPOINTING_MODE, ASR_LANGUAGE_MODE, ASR_PROFILE, SIDECAR_LIFECYCLE, type AsrEndpointingMode, type AsrLanguageMode, type AsrProfile, type AsrResult, type SidecarLifecycle, type SidecarStatus } from "../shared/types";

interface SidecarEventHandlers {
  onResult: (result: AsrResult) => void;
  onStatus: (status: SidecarStatus) => void;
}

interface SidecarMessage {
  type?: string;
  text?: string;
  message?: string;
  activeProfile?: AsrProfile;
  modelName?: string;
  fallbackReason?: string | null;
  languageMode?: AsrLanguageMode;
  endpointingMode?: AsrEndpointingMode;
  endpointing?: string;
  firstAudioAtMs?: number | null;
  resultAtMs?: number;
  latencyMs?: number | null;
  endpointLatencyMs?: number | null;
  cpuTimeMs?: number | null;
  segmentDurationMs?: number;
  confidence?: number | null;
  cause?: AsrResult["cause"];
}

export interface SidecarDependencies {
  spawnProcess: (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
  executableExists: typeof existsSync;
  inspectRuntime: () => Promise<RuntimeInspection>;
  selfTestRuntime: (executable: string, args: readonly string[]) => Promise<string>;
  modelPath: (profile: AsrProfile) => string;
  resourcesPath: () => string;
  appPath: () => string;
  isPackaged: () => boolean;
  isDemoPackage: () => boolean;
  platform: NodeJS.Platform;
  stopTimeoutMs: number;
  killTimeoutMs: number;
  startTimeoutMs: number;
}

interface RuntimeInspection {
  executable: string | null;
  voskAvailable: boolean;
  kind?: "pyinstaller" | "embedded-python" | "development-python";
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SidecarStartResult {
  status: SidecarStatus;
  sessionId: number | null;
}

export interface AudioWriteState {
  saturated: boolean;
  audioSentMs: number;
  audioPendingMs: number;
  audioBlocksSent: number;
  maximumQueueMs: number;
  audioOverflows: number;
}

export class AudioBackpressure {
  private saturated = false;
  private audioSentMs = 0;
  private audioPendingMs = 0;
  private audioBlocksSent = 0;
  private maximumQueueMs = 0;
  private audioOverflows = 0;
  private inFlightMs = 0;
  private queue: Array<{ payload: string; durationMs: number }> = [];
  private idleResolvers: Array<(idle: boolean) => void> = [];

  constructor(private readonly maximumDurationMs = 10_000) {}

  write(writer: Pick<NodeJS.WritableStream, "write">, payload: string, durationMs: number): boolean {
    if (durationMs <= 0 || this.audioPendingMs + durationMs > this.maximumDurationMs) {
      this.audioOverflows += 1;
      return false;
    }
    this.queue.push({ payload, durationMs });
    this.audioPendingMs += durationMs;
    this.maximumQueueMs = Math.max(this.maximumQueueMs, this.audioPendingMs);
    this.pump(writer);
    return true;
  }

  onDrain(writer: Pick<NodeJS.WritableStream, "write">): void {
    this.saturated = false;
    this.audioPendingMs = Math.max(0, this.audioPendingMs - this.inFlightMs);
    this.inFlightMs = 0;
    this.pump(writer);
  }

  reset(): void {
    this.saturated = false;
    this.audioSentMs = 0;
    this.audioPendingMs = 0;
    this.audioBlocksSent = 0;
    this.maximumQueueMs = 0;
    this.audioOverflows = 0;
    this.inFlightMs = 0;
    this.queue = [];
    this.resolveIdle(false);
  }

  inspect(): AudioWriteState {
    return {
      saturated: this.saturated,
      audioSentMs: Math.round(this.audioSentMs),
      audioPendingMs: Math.round(this.audioPendingMs),
      audioBlocksSent: this.audioBlocksSent,
      maximumQueueMs: Math.round(this.maximumQueueMs),
      audioOverflows: this.audioOverflows,
    };
  }

  waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.isIdle()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const index = this.idleResolvers.indexOf(resolver);
        if (index >= 0) this.idleResolvers.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      timeout.unref();
      const resolver = (idle: boolean): void => {
        clearTimeout(timeout);
        resolve(idle);
      };
      this.idleResolvers.push(resolver);
    });
  }

  private pump(writer: Pick<NodeJS.WritableStream, "write">): void {
    while (!this.saturated) {
      const item = this.queue.shift();
      if (!item) break;
      this.audioSentMs += item.durationMs;
      this.audioBlocksSent += 1;
      if (writer.write(item.payload)) {
        this.audioPendingMs = Math.max(0, this.audioPendingMs - item.durationMs);
      } else {
        this.saturated = true;
        this.inFlightMs = item.durationMs;
      }
    }
    if (this.isIdle()) this.resolveIdle(true);
  }

  private isIdle(): boolean {
    return !this.saturated && this.queue.length === 0 && this.audioPendingMs === 0;
  }

  private resolveIdle(idle: boolean): void {
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve(idle);
  }
}

const MODEL_NAME: Record<AsrProfile, string> = {
  [ASR_PROFILE.LIGHT]: "vosk-model-small-es-0.42",
  [ASR_PROFILE.PRECISE]: "vosk-model-es-0.42",
};

function getModelPath(profile: AsrProfile): string {
  const configured = app.isPackaged ? undefined : profile === ASR_PROFILE.PRECISE ? process.env.SENA_LSC_LARGE_MODEL_PATH : process.env.SENA_LSC_MODEL_PATH;
  const configuredPath = resolveConfiguredModelPath(profile, configured);
  if (configuredPath) return configuredPath;
  const root = app.isPackaged && process.platform === "win32" && profile === ASR_PROFILE.LIGHT
    ? join(process.resourcesPath, "models")
    : app.isPackaged ? join(app.getPath("userData"), "models") : join(app.getAppPath(), "models");
  return join(root, MODEL_NAME[profile]);
}

export function resolveConfiguredModelPath(profile: AsrProfile, configured?: string): string | null {
  if (!configured || !isAbsolute(configured) || normalize(configured) !== configured) return null;
  return basename(configured) === MODEL_NAME[profile] ? configured : null;
}

export function resolveConfiguredSidecarPath(configured = process.env.SENA_LSC_SIDECAR_PATH): string | null {
  if (!configured || !isAbsolute(configured) || normalize(configured) !== configured) return null;
  return basename(configured).toLocaleLowerCase("en-US") === "senalsc-asr.exe" ? configured : null;
}

export function isDemoDistribution(appPath = app.getAppPath()): boolean {
  try {
    const packageJson = JSON.parse(readFileSync(join(appPath, "package.json"), "utf8")) as unknown;
    return typeof packageJson === "object" && packageJson !== null && "senalscDistribution" in packageJson && packageJson.senalscDistribution === "demo";
  } catch {
    return false;
  }
}

function getPythonCandidates(): string[] {
  if (process.platform !== "linux") return [];
  const configured = process.env.SENA_LSC_PYTHON;
  const local = join(app.getAppPath(), ".venv", "bin", "python");
  const validConfigured = configured && isAbsolute(configured) && normalize(configured) === configured && configured.startsWith(`${app.getAppPath()}/`)
    ? configured
    : null;
  return [validConfigured, local, "python3"].filter((value): value is string => Boolean(value));
}

function runProbe(executable: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(executable, ["-c", "import vosk"], { timeout: 5_000, windowsHide: true }, (error) => resolve(!error));
  });
}

async function findPython(): Promise<RuntimeInspection> {
  for (const executable of getPythonCandidates()) {
    const available = await new Promise<boolean>((resolve) => {
      execFile(executable, ["--version"], { timeout: 3_000, windowsHide: true }, (error) => resolve(!error));
    });
    if (available) return { executable, voskAvailable: await runProbe(executable) };
  }
  return { executable: null, voskAvailable: false };
}

const DEFAULT_DEPENDENCIES: SidecarDependencies = {
  spawnProcess: (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }),
  executableExists: existsSync,
  inspectRuntime: findPython,
  selfTestRuntime: (executable, args) => new Promise((resolve, reject) => {
    execFile(executable, [...args], { timeout: 10_000, windowsHide: true, encoding: "utf8" }, (error, stdout) => error ? reject(error instanceof Error ? error : new Error("Falló el proceso de self-check.")) : resolve(stdout.trim()));
  }),
  modelPath: getModelPath,
  resourcesPath: () => process.resourcesPath,
  appPath: () => app.getAppPath(),
  isPackaged: () => app.isPackaged,
  isDemoPackage: isDemoDistribution,
  platform: process.platform,
  stopTimeoutMs: 1_500,
  killTimeoutMs: 1_000,
  startTimeoutMs: 10_000,
};

export class AsrSidecar {
  private process: ChildProcessWithoutNullStreams | null = null;
  private output: ReadlineInterface | null = null;
  private pythonExecutable: string | null = null;
  private lastStatus: SidecarStatus | null = null;
  private lifecycle: SidecarLifecycle = SIDECAR_LIFECYCLE.STOPPED;
  private operation = Promise.resolve();
  private expectedExit = false;
  private startupResolver: ((status: SidecarStatus) => void) | null = null;
  private exitResolver: ((result: ExitResult) => void) | null = null;
  private readonly backpressure = new AudioBackpressure();
  private operationGeneration = 0;
  private sessionSequence = 0;
  private processGeneration: number | null = null;
  private activeSessionId: number | null = null;
  private ownerSessionId: number | null = null;
  private requestedProfile: AsrProfile = ASR_PROFILE.LIGHT;
  private activeProfile: AsrProfile = ASR_PROFILE.LIGHT;
  private activeModelPath: string;
  private fallbackReason: string | null = null;
  private languageMode: AsrLanguageMode = ASR_LANGUAGE_MODE.UNKNOWN;
  private endpointingMode: AsrEndpointingMode = ASR_ENDPOINTING_MODE.UNKNOWN;
  private endpointingMessage = "Se confirmará al iniciar el motor.";
  private firstPartialLatencyMs: number | null = null;
  private lastFinalLatencyMs: number | null = null;
  private endpointFinalLatencyMs: number | null = null;
  private cpuTimeMs: number | null = null;
  private lastMetricsEmissionAt = 0;

  constructor(
    private readonly handlers: SidecarEventHandlers,
    private readonly dependencies: SidecarDependencies = DEFAULT_DEPENDENCIES,
  ) {
    this.activeModelPath = dependencies.modelPath(ASR_PROFILE.LIGHT);
  }

  inspect(profile: AsrProfile = ASR_PROFILE.LIGHT): Promise<SidecarStatus> {
    this.requestedProfile = profile;
    return this.enqueue(() => this.inspectInternal());
  }

  start(sampleRate: number, profile: AsrProfile = ASR_PROFILE.LIGHT): Promise<SidecarStartResult> {
    this.requestedProfile = profile;
    const generation = ++this.operationGeneration;
    if (this.lifecycle === SIDECAR_LIFECYCLE.RUNNING && this.process && this.activeSessionId !== null) {
      this.processGeneration = generation;
    } else if (this.process) {
      this.activeSessionId = null;
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPING;
      this.expectedExit = true;
      const status = this.emitCurrentStatus("Cancelando el inicio anterior...");
      this.resolveStartup(status);
    }
    return this.enqueue(() => this.startInternal(sampleRate, generation));
  }

  stop(): Promise<SidecarStatus> {
    this.operationGeneration += 1;
    if (this.process && this.ownerSessionId !== null) {
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPING;
      this.expectedExit = true;
      const status = this.emitCurrentStatus("Deteniendo reconocimiento local...");
      this.resolveStartup(status);
    }
    return this.enqueue(() => this.stopInternal());
  }

  sendAudio(audio: Uint8Array): void {
    const child = this.process;
    if (this.lifecycle !== SIDECAR_LIFECYCLE.RUNNING || !child?.stdin.writable) return;
    if (audio.byteLength % 2 !== 0) {
      this.failAudioFlow(child, "El bloque PCM recibido no está alineado a 16 bits.");
      return;
    }
    const durationMs = audio.byteLength / 2 / 16;
    const payload = `${JSON.stringify({ type: "audio", data: Buffer.from(audio).toString("base64") })}\n`;
    if (!this.backpressure.write(child.stdin, payload, durationMs)) {
      this.failAudioFlow(child, "El equipo no procesa el audio en tiempo real");
      return;
    }
    const now = Date.now();
    if (now - this.lastMetricsEmissionAt >= 250) {
      this.lastMetricsEmissionAt = now;
      this.emitCurrentStatus(this.backpressure.inspect().saturated ? "Procesando audio pendiente..." : "Reconocimiento local activo.");
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async inspectRuntime(): Promise<RuntimeInspection> {
    if (this.dependencies.isDemoPackage()) return { executable: null, voskAvailable: false };
    const configuredExecutable = this.dependencies.isPackaged() ? null : resolveConfiguredSidecarPath();
    const configuredAvailable = this.dependencies.platform === "win32"
      && configuredExecutable !== null
      && this.dependencies.executableExists(configuredExecutable);
    if (configuredAvailable) return { executable: configuredExecutable, voskAvailable: true, kind: "pyinstaller" };
    const bundledExecutable = join(this.dependencies.resourcesPath(), "sidecar", "senalsc-asr.exe");
    const bundledAvailable = this.dependencies.isPackaged() && this.dependencies.platform === "win32" && this.dependencies.executableExists(bundledExecutable);
    if (bundledAvailable) return { executable: bundledExecutable, voskAvailable: true, kind: "pyinstaller" };
    const embeddedPython = join(this.dependencies.resourcesPath(), "embedded-asr", "pythonw.exe");
    const embeddedVosk = join(this.dependencies.resourcesPath(), "embedded-asr", "site-packages", "vosk", "libvosk.dll");
    const embeddedAvailable = this.dependencies.isPackaged() && this.dependencies.platform === "win32"
      && this.dependencies.executableExists(embeddedPython) && this.dependencies.executableExists(embeddedVosk);
    if (embeddedAvailable) return { executable: embeddedPython, voskAvailable: true, kind: "embedded-python" };
    if (this.dependencies.isPackaged()) return { executable: null, voskAvailable: false };
    const development = await this.dependencies.inspectRuntime();
    return development.executable ? { ...development, kind: "development-python" } : development;
  }

  private scriptPath(): string {
    return this.dependencies.isPackaged()
      ? join(this.dependencies.resourcesPath(), "sidecar", "asr.py")
      : join(this.dependencies.appPath(), "sidecar", "asr.py");
  }

  private async selfTest(executable: string): Promise<void> {
    const bundled = executable.endsWith("senalsc-asr.exe");
    const args = bundled ? ["--self-test"] : [this.scriptPath(), "--self-test"];
    const output = await this.dependencies.selfTestRuntime(executable, args);
    const payload = JSON.parse(output) as SidecarMessage & { status?: string; protocolVersion?: number; engine?: string };
    if (payload.type !== "self-test" || payload.status !== "ok" || payload.protocolVersion !== 1 || payload.engine !== "vosk") {
      throw new Error("El self-check del motor embebido devolvió un protocolo no válido.");
    }
  }

  private async inspectInternal(): Promise<SidecarStatus>;
  private async inspectInternal(generation: number): Promise<SidecarStatus | null>;
  private async inspectInternal(generation?: number): Promise<SidecarStatus | null> {
    const runtime = await this.inspectRuntime();
    if (generation !== undefined && !this.isCurrentGeneration(generation)) return null;
    this.pythonExecutable = runtime.executable;
    const requestedPath = this.dependencies.modelPath(this.requestedProfile);
    const lightPath = this.dependencies.modelPath(ASR_PROFILE.LIGHT);
    const requestedAvailable = this.dependencies.executableExists(requestedPath);
    const lightAvailable = this.dependencies.executableExists(lightPath);
    this.activeProfile = this.requestedProfile === ASR_PROFILE.PRECISE && requestedAvailable ? ASR_PROFILE.PRECISE : ASR_PROFILE.LIGHT;
    this.activeModelPath = this.activeProfile === ASR_PROFILE.PRECISE ? requestedPath : lightPath;
    this.fallbackReason = this.requestedProfile === ASR_PROFILE.PRECISE && !requestedAvailable
      ? "El modelo preciso no está instalado; se usará Ligero."
      : null;
    this.languageMode = ASR_LANGUAGE_MODE.OPEN_ALTERNATIVES;
    const modelAvailable = this.activeProfile === ASR_PROFILE.PRECISE ? requestedAvailable : lightAvailable;
    const prerequisitesReady = Boolean(runtime.executable && runtime.voskAvailable && modelAvailable);
    const activeSession = this.lifecycle !== SIDECAR_LIFECYCLE.STOPPED;
    const processPresent = this.process !== null;
    const ready = prerequisitesReady && (!activeSession || (processPresent && this.lifecycle === SIDECAR_LIFECYCLE.RUNNING));
    const message = this.dependencies.isDemoPackage()
      ? "Edición demostrativa: no incluye reconocimiento de voz real."
      : !runtime.executable
        ? "No se encontró Python ni el sidecar empaquetado."
      : !runtime.voskAvailable
        ? "Python está disponible, pero falta instalar Vosk."
        : !modelAvailable
          ? "Falta el modelo español de Vosk."
          : this.fallbackReason
            ? this.fallbackReason
          : this.lifecycle === SIDECAR_LIFECYCLE.STARTING
            ? "Iniciando reconocimiento local..."
            : this.lifecycle === SIDECAR_LIFECYCLE.RUNNING
              ? "Reconocimiento local activo."
              : this.lifecycle === SIDECAR_LIFECYCLE.STOPPING
                ? "Deteniendo reconocimiento local..."
                : "Reconocimiento local preparado.";

    const status: SidecarStatus = {
      sessionId: this.activeSessionId,
      ownerSessionId: this.ownerSessionId,
      lifecycle: this.lifecycle,
      processRunning: processPresent,
      pythonAvailable: runtime.executable !== null,
      voskAvailable: runtime.voskAvailable,
      modelAvailable,
      ready,
      audioSaturated: this.backpressure.inspect().saturated,
      audioSentMs: this.backpressure.inspect().audioSentMs,
      audioPendingMs: this.backpressure.inspect().audioPendingMs,
      audioBlocksSent: this.backpressure.inspect().audioBlocksSent,
      maximumQueueMs: this.backpressure.inspect().maximumQueueMs,
      audioOverflows: this.backpressure.inspect().audioOverflows,
      firstPartialLatencyMs: this.firstPartialLatencyMs,
      lastFinalLatencyMs: this.lastFinalLatencyMs,
      endpointFinalLatencyMs: this.endpointFinalLatencyMs,
      cpuTimeMs: this.cpuTimeMs,
      modelPath: this.activeModelPath,
      requestedProfile: this.requestedProfile,
      activeProfile: this.activeProfile,
      modelName: MODEL_NAME[this.activeProfile],
      fallbackReason: this.fallbackReason,
      languageMode: this.languageMode,
      endpointingMode: this.endpointingMode,
      endpointingMessage: this.endpointingMessage,
      message,
    };
    if (generation !== undefined && !this.isCurrentGeneration(generation)) return null;
    return this.setStatus(status);
  }

  private async startInternal(sampleRate: number, generation: number): Promise<SidecarStartResult> {
    if (!this.isCurrentGeneration(generation)) return this.cancelledStartResult();
    if (this.lifecycle === SIDECAR_LIFECYCLE.RUNNING && this.process && this.activeSessionId !== null) {
      const status = await this.inspectInternal(generation);
      if (!this.isCurrentGeneration(generation) || !status) return this.cancelledStartResult();
      return { status, sessionId: this.activeSessionId };
    }

    if (this.process) {
      await this.stopInternal();
      if (!this.isCurrentGeneration(generation)) return this.cancelledStartResult();
    }
    if (this.lifecycle === SIDECAR_LIFECYCLE.ERROR) this.lifecycle = SIDECAR_LIFECYCLE.STOPPED;

    const available = await this.inspectInternal(generation);
    if (!this.isCurrentGeneration(generation) || !available) return this.cancelledStartResult();
    if (!available.ready || !this.pythonExecutable) return { status: available, sessionId: null };

    try {
      await this.selfTest(this.pythonExecutable);
    } catch (caught) {
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPED;
      const detail = caught instanceof Error ? caught.message : "respuesta desconocida";
      const status = this.setStatus({ ...available, ready: false, message: `El motor Vosk incluido no superó el self-check: ${detail}` });
      return { status, sessionId: null };
    }

    if (!this.isCurrentGeneration(generation)) return this.cancelledStartResult();
    this.lifecycle = SIDECAR_LIFECYCLE.STARTING;
    const sessionId = ++this.sessionSequence;
    if (!this.isCurrentGeneration(generation)) return this.cancelledStartResult();
    this.activeSessionId = sessionId;
    this.ownerSessionId = sessionId;
    this.processGeneration = generation;
    this.expectedExit = false;
    this.backpressure.reset();
    this.firstPartialLatencyMs = null;
    this.lastFinalLatencyMs = null;
    this.endpointFinalLatencyMs = null;
    this.cpuTimeMs = null;
    this.lastMetricsEmissionAt = 0;
    const bundled = this.pythonExecutable.endsWith("senalsc-asr.exe");
    const scriptPath = this.scriptPath();
    const lightPath = this.dependencies.modelPath(ASR_PROFILE.LIGHT);
    const commonArgs = [available.modelPath, String(sampleRate), this.requestedProfile, lightPath];
    const args = bundled ? commonArgs : [scriptPath, ...commonArgs];
    if (!this.isCurrentGeneration(generation)) return this.cancelledStartResult();
    const child = this.dependencies.spawnProcess(this.pythonExecutable, args);
    if (!this.isCurrentGeneration(generation)) {
      if (!child.killed) child.kill();
      this.activeSessionId = null;
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPED;
      return this.cancelledStartResult();
    }
    this.process = child;
    this.output = createInterface({ input: child.stdout });
    this.output.on("line", (line) => this.handleLine(child, sessionId, line));
    child.stdin.on("drain", () => {
      if (!this.acceptsProcessEvent(child, sessionId)) return;
      this.backpressure.onDrain(child.stdin);
      this.emitCurrentStatus(this.lifecycle === SIDECAR_LIFECYCLE.STOPPING ? "Finalizando la última frase..." : "Reconocimiento local activo.");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!this.acceptsProcessEvent(child, sessionId)) return;
      const message = chunk.toString("utf8").trim();
      if (/^(ERROR|FATAL|Traceback)/m.test(message)) this.emitFailure(`El reconocedor informó: ${message}`);
    });
    child.once("error", (error) => this.handleProcessError(child, sessionId, error));
    child.once("close", (code, signal) => this.handleClose(child, sessionId, code, signal));
    if (!this.isCurrentGeneration(generation)) {
      this.activeSessionId = null;
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPING;
      this.expectedExit = true;
      if (!child.killed) child.kill();
      return this.cancelledStartResult();
    }
    this.emitCurrentStatus("Iniciando reconocimiento local...");

    const result = await new Promise<SidecarStartResult>((resolve) => {
      const startupResolver = (status: SidecarStatus): void => {
        clearTimeout(timeout);
        resolve({ status, sessionId: status.ready && this.activeSessionId === sessionId ? sessionId : null });
      };
      const timeout = setTimeout(() => {
        if (this.startupResolver !== startupResolver) return;
        this.startupResolver = null;
        if (!this.isCurrentGeneration(generation)) {
          resolve(this.cancelledStartResult());
          return;
        }
        this.lifecycle = SIDECAR_LIFECYCLE.ERROR;
        this.activeSessionId = null;
        this.expectedExit = true;
        this.emitFailure("El reconocedor local no confirmó su inicio a tiempo.");
        if (!child.killed) child.kill();
        resolve({ status: this.lastStatus as SidecarStatus, sessionId: null });
      }, this.dependencies.startTimeoutMs);
      timeout.unref();
      this.startupResolver = startupResolver;
    });
    if (!this.isCurrentGeneration(generation)) return this.cancelledStartResult();
    return result;
  }

  private async stopInternal(): Promise<SidecarStatus> {
    const child = this.process;
    if (!child) {
      this.activeSessionId = null;
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPED;
      return this.inspectInternal();
    }

    this.lifecycle = SIDECAR_LIFECYCLE.STOPPING;
    this.expectedExit = true;
    this.emitCurrentStatus("Finalizando la última frase...");
    const drained = await this.backpressure.waitForIdle(this.dependencies.stopTimeoutMs);
    if (!drained) {
      this.emitFailure("No se pudo vaciar el audio pendiente antes del cierre.");
      child.kill();
      await this.waitForExit(this.dependencies.killTimeoutMs);
      return this.lastStatus as SidecarStatus;
    }
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ type: "stop" })}\n`);

    let exited = await this.waitForExit(this.dependencies.stopTimeoutMs);
    if (!exited) {
      child.kill();
      exited = await this.waitForExit(this.dependencies.killTimeoutMs);
    }
    if (!exited) {
      this.emitFailure("El reconocedor local no respondió al cierre forzado.");
      return this.lastStatus as SidecarStatus;
    }
    return this.inspectInternal();
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (!this.process) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.exitResolver === exitResolver) this.exitResolver = null;
        resolve(false);
      }, timeoutMs);
      timeout.unref();
      const exitResolver = (): void => {
        clearTimeout(timeout);
        resolve(true);
      };
      this.exitResolver = exitResolver;
    });
  }

  private handleLine(child: ChildProcessWithoutNullStreams, sessionId: number, line: string): void {
    if (!this.acceptsProcessEvent(child, sessionId)) return;
    try {
      const message = JSON.parse(line) as SidecarMessage;
      if ((message.type === "partial" || message.type === "final") && typeof message.text === "string" && (this.lifecycle === SIDECAR_LIFECYCLE.RUNNING || (this.lifecycle === SIDECAR_LIFECYCLE.STOPPING && message.type === "final"))) {
        const result: AsrResult = {
          kind: message.type,
          text: message.text,
          sessionId,
          firstAudioAtMs: typeof message.firstAudioAtMs === "number" ? message.firstAudioAtMs : null,
          resultAtMs: typeof message.resultAtMs === "number" ? message.resultAtMs : Date.now(),
          latencyMs: typeof message.latencyMs === "number" ? message.latencyMs : null,
          endpointLatencyMs: typeof message.endpointLatencyMs === "number" ? message.endpointLatencyMs : null,
          cpuTimeMs: typeof message.cpuTimeMs === "number" ? message.cpuTimeMs : null,
          segmentDurationMs: typeof message.segmentDurationMs === "number" ? message.segmentDurationMs : 0,
          confidence: typeof message.confidence === "number" ? message.confidence : null,
          cause: message.cause === "endpoint" || message.cause === "stop-flush" ? message.cause : "partial",
        };
        if (result.kind === "partial" && result.latencyMs !== null && this.firstPartialLatencyMs === null) this.firstPartialLatencyMs = result.latencyMs;
        if (result.kind === "final") {
          this.lastFinalLatencyMs = result.latencyMs;
          this.endpointFinalLatencyMs = result.endpointLatencyMs;
        }
        this.cpuTimeMs = result.cpuTimeMs;
        this.handlers.onResult(result);
      } else if (message.type === "ready" && this.lifecycle === SIDECAR_LIFECYCLE.STARTING) {
        if (!this.acceptsProcessEvent(child, sessionId)) return;
        if (message.activeProfile && Object.values(ASR_PROFILE).includes(message.activeProfile)) this.activeProfile = message.activeProfile;
        if (typeof message.modelName === "string") this.activeModelPath = this.dependencies.modelPath(this.activeProfile);
        if (message.fallbackReason === null || typeof message.fallbackReason === "string") this.fallbackReason = message.fallbackReason;
        if (message.languageMode && Object.values(ASR_LANGUAGE_MODE).includes(message.languageMode)) this.languageMode = message.languageMode;
        if (message.endpointingMode && Object.values(ASR_ENDPOINTING_MODE).includes(message.endpointingMode)) this.endpointingMode = message.endpointingMode;
        if (typeof message.endpointing === "string") this.endpointingMessage = message.endpointing;
        this.lifecycle = SIDECAR_LIFECYCLE.RUNNING;
        const status = this.emitCurrentStatus(this.fallbackReason ?? "Reconocimiento local activo.");
        this.resolveStartup(status);
      } else if (message.type === "error") {
        this.emitFailure(message.message ?? "Error desconocido del reconocedor local.");
      }
    } catch {
      this.emitFailure("El reconocedor local devolvió una respuesta no válida.");
    }
  }

  private handleProcessError(child: ChildProcessWithoutNullStreams, sessionId: number, error: Error): void {
    if (!this.acceptsProcessEvent(child, sessionId)) return;
    this.emitFailure(`No se pudo iniciar el reconocedor: ${error.message}`);
  }

  private handleClose(child: ChildProcessWithoutNullStreams, sessionId: number, code: number | null, signal: NodeJS.Signals | null): void {
    if (child !== this.process) return;
    const wasExpected = this.expectedExit;
    const wasActive = this.lifecycle === SIDECAR_LIFECYCLE.RUNNING || this.lifecycle === SIDECAR_LIFECYCLE.STARTING;
    this.output?.close();
    this.output = null;
    this.process = null;
    this.processGeneration = null;
    this.activeSessionId = null;
    this.ownerSessionId = sessionId;
    this.expectedExit = false;
    this.backpressure.reset();
    this.exitResolver?.({ code, signal });
    this.exitResolver = null;

    if (!wasExpected && wasActive) {
      this.lifecycle = SIDECAR_LIFECYCLE.ERROR;
      const detail = code === null ? `señal ${signal ?? "desconocida"}` : `código ${code}`;
      this.emitFailure(`El reconocedor local se cerró inesperadamente (${detail}). La escucha se detuvo.`);
    } else {
      this.lifecycle = SIDECAR_LIFECYCLE.STOPPED;
      this.emitCurrentStatus("Reconocimiento local detenido.");
    }
    this.resolveStartup(this.lastStatus as SidecarStatus);
  }

  private emitCurrentStatus(message: string): SidecarStatus {
    const audioState = this.backpressure.inspect();
    return this.setStatus({
      ...(this.lastStatus ?? {
        pythonAvailable: false,
        voskAvailable: false,
        modelAvailable: false,
        modelPath: this.activeModelPath,
        requestedProfile: this.requestedProfile,
        activeProfile: this.activeProfile,
        modelName: MODEL_NAME[this.activeProfile],
        fallbackReason: this.fallbackReason,
        languageMode: this.languageMode,
        endpointingMode: this.endpointingMode,
        endpointingMessage: this.endpointingMessage,
        endpointFinalLatencyMs: this.endpointFinalLatencyMs,
        cpuTimeMs: this.cpuTimeMs,
      }),
      sessionId: this.activeSessionId,
      ownerSessionId: this.ownerSessionId,
      lifecycle: this.lifecycle,
      processRunning: this.process !== null,
      ready: this.lifecycle === SIDECAR_LIFECYCLE.RUNNING && this.process !== null,
      audioSaturated: audioState.saturated,
      audioSentMs: audioState.audioSentMs,
      audioPendingMs: audioState.audioPendingMs,
      audioBlocksSent: audioState.audioBlocksSent,
      maximumQueueMs: audioState.maximumQueueMs,
      audioOverflows: audioState.audioOverflows,
      firstPartialLatencyMs: this.firstPartialLatencyMs,
      lastFinalLatencyMs: this.lastFinalLatencyMs,
      endpointFinalLatencyMs: this.endpointFinalLatencyMs,
      cpuTimeMs: this.cpuTimeMs,
      modelPath: this.activeModelPath,
      requestedProfile: this.requestedProfile,
      activeProfile: this.activeProfile,
      modelName: MODEL_NAME[this.activeProfile],
      fallbackReason: this.fallbackReason,
      languageMode: this.languageMode,
      endpointingMode: this.endpointingMode,
      endpointingMessage: this.endpointingMessage,
      message,
    });
  }

  private emitFailure(message: string): SidecarStatus {
    const audioState = this.backpressure.inspect();
    return this.setStatus({
      ...(this.lastStatus ?? {
        lifecycle: this.lifecycle,
        processRunning: false,
        pythonAvailable: false,
        voskAvailable: false,
        modelAvailable: false,
        audioSaturated: false,
        audioSentMs: 0,
        audioPendingMs: 0,
        audioBlocksSent: 0,
        maximumQueueMs: 0,
        audioOverflows: 0,
        firstPartialLatencyMs: null,
        lastFinalLatencyMs: null,
        endpointFinalLatencyMs: null,
        cpuTimeMs: null,
        modelPath: this.activeModelPath,
        requestedProfile: this.requestedProfile,
        activeProfile: this.activeProfile,
        modelName: MODEL_NAME[this.activeProfile],
        fallbackReason: this.fallbackReason,
        languageMode: this.languageMode,
        endpointingMode: this.endpointingMode,
        endpointingMessage: this.endpointingMessage,
      }),
      sessionId: this.activeSessionId,
      ownerSessionId: this.ownerSessionId,
      lifecycle: this.lifecycle,
      processRunning: this.process !== null,
      ready: false,
      audioSaturated: audioState.saturated,
      audioSentMs: audioState.audioSentMs,
      audioPendingMs: audioState.audioPendingMs,
      audioBlocksSent: audioState.audioBlocksSent,
      maximumQueueMs: audioState.maximumQueueMs,
      audioOverflows: audioState.audioOverflows,
      message,
    });
  }

  private setStatus(status: SidecarStatus): SidecarStatus {
    this.lastStatus = status;
    this.handlers.onStatus(status);
    return status;
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.operationGeneration;
  }

  private acceptsProcessEvent(child: ChildProcessWithoutNullStreams, sessionId: number): boolean {
    return (
      child === this.process
      && sessionId === this.activeSessionId
    );
  }

  private failAudioFlow(child: ChildProcessWithoutNullStreams, message: string): void {
    this.lifecycle = SIDECAR_LIFECYCLE.ERROR;
    this.expectedExit = true;
    this.emitFailure(message);
    if (!child.killed) child.kill();
  }

  private resolveStartup(status: SidecarStatus): void {
    const resolver = this.startupResolver;
    this.startupResolver = null;
    resolver?.(status);
  }

  private cancelledStartResult(): SidecarStartResult {
    const audioState = this.backpressure.inspect();
    return {
      sessionId: null,
      status: {
        ...(this.lastStatus ?? {
          pythonAvailable: false,
          voskAvailable: false,
          modelAvailable: false,
          modelPath: this.activeModelPath,
          requestedProfile: this.requestedProfile,
          activeProfile: this.activeProfile,
          modelName: MODEL_NAME[this.activeProfile],
          fallbackReason: this.fallbackReason,
        languageMode: this.languageMode,
        endpointingMode: this.endpointingMode,
        endpointingMessage: this.endpointingMessage,
      }),
        sessionId: null,
        ownerSessionId: this.ownerSessionId,
        lifecycle: this.lifecycle,
        processRunning: this.process !== null,
        ready: false,
        audioSaturated: audioState.saturated,
        audioSentMs: audioState.audioSentMs,
        audioPendingMs: audioState.audioPendingMs,
        audioBlocksSent: audioState.audioBlocksSent,
        maximumQueueMs: audioState.maximumQueueMs,
        audioOverflows: audioState.audioOverflows,
        firstPartialLatencyMs: this.firstPartialLatencyMs,
        lastFinalLatencyMs: this.lastFinalLatencyMs,
        endpointFinalLatencyMs: this.endpointFinalLatencyMs,
        cpuTimeMs: this.cpuTimeMs,
        message: "El inicio del reconocimiento local fue cancelado.",
      },
    };
  }
}
