export const ASR_SAMPLE_RATE = 16_000;
export const AUDIO_IPC_BATCH_MS = 40;
export const AUDIO_IPC_BATCH_SAMPLES = ASR_SAMPLE_RATE * AUDIO_IPC_BATCH_MS / 1_000;
export const MICROPHONE_STORAGE_KEY = "senalsc:microphone-device";

export interface AudioRateInfo {
  trackSampleRate: number | null;
  contextSampleRate: number | null;
  outputSampleRate: typeof ASR_SAMPLE_RATE;
  resampling: boolean;
}

export interface SelectableMicrophone {
  deviceId: string;
  label: string;
}

export interface MicrophoneDeviceSource {
  kind: MediaDeviceKind;
  deviceId: string;
  groupId: string;
  label: string;
}

export interface MicrophoneMediaDevices {
  enumerateDevices: () => Promise<readonly MicrophoneDeviceSource[]>;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export interface MicrophoneDeviceEvents {
  addEventListener: (type: "devicechange", listener: () => void) => void;
  removeEventListener: (type: "devicechange", listener: () => void) => void;
}

export interface OpenMicrophoneResult {
  stream: MediaStream;
  fallbackUsed: boolean;
}

export function isWoMicLabel(label: string): boolean {
  return /\bwo\s*mic\b/.test(normalizeDeviceLabel(label));
}

export function microphoneConstraints(label: string): MediaTrackConstraints {
  const processed = !isWoMicLabel(label);
  return {
    channelCount: 1,
    echoCancellation: processed,
    noiseSuppression: processed,
    autoGainControl: processed,
  };
}

export function labelDefaultWoMic(devices: readonly SelectableMicrophone[], isDefaultWoMic: boolean): SelectableMicrophone[] {
  if (!isDefaultWoMic) return [...devices];
  return devices.map((device, index) => (
    index === 0 && (!device.deviceId || device.deviceId === "default")
      ? { ...device, label: "WO Mic (predeterminado del sistema)" }
      : device
  ));
}

export function normalizeDeviceLabel(label: string): string {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CO").replace(/[^a-z0-9]+/g, " ").trim();
}

export function selectPreferredMicrophone(devices: readonly SelectableMicrophone[], savedDeviceId: string | null): string {
  if (savedDeviceId && devices.some((device) => device.deviceId === savedDeviceId)) return savedDeviceId;
  if (savedDeviceId) return devices.find((device) => device.deviceId === "default")?.deviceId ?? devices[0]?.deviceId ?? "default";
  const woMic = devices.find((device) => isWoMicLabel(device.label));
  if (woMic) return woMic.deviceId;
  return devices.find((device) => device.deviceId === "default")?.deviceId ?? devices[0]?.deviceId ?? "default";
}

export function microphoneLabel(device: Pick<MicrophoneDeviceSource, "deviceId" | "label">, fallbackIndex: number): string {
  if (device.label.trim()) return device.label.trim();
  if (device.deviceId === "default") return "Predeterminado del sistema";
  if (device.deviceId === "communications") return "Comunicaciones del sistema";
  return `Micrófono ${fallbackIndex}`;
}

export function mapMicrophoneDevices(devices: readonly MicrophoneDeviceSource[]): SelectableMicrophone[] {
  const seen = new Set<string>();
  let fallbackIndex = 0;
  return devices.flatMap((device) => {
    if (device.kind !== "audioinput" || seen.has(device.deviceId)) return [];
    seen.add(device.deviceId);
    fallbackIndex += 1;
    return [{ deviceId: device.deviceId, label: microphoneLabel(device, fallbackIndex) }];
  });
}

export async function enumerateMicrophones(
  mediaDevices: MicrophoneMediaDevices,
  requestPermission: boolean,
): Promise<SelectableMicrophone[]> {
  if (requestPermission) {
    const permissionStream = await mediaDevices.getUserMedia({ audio: true, video: false });
    permissionStream.getTracks().forEach((track) => track.stop());
  }
  return mapMicrophoneDevices(await mediaDevices.enumerateDevices());
}

export async function openSelectedMicrophone(
  mediaDevices: MicrophoneMediaDevices,
  selectedDeviceId: string,
  baseConstraints: MediaTrackConstraints,
): Promise<OpenMicrophoneResult> {
  if (!selectedDeviceId || selectedDeviceId === "default") {
    return { stream: await mediaDevices.getUserMedia({ audio: baseConstraints, video: false }), fallbackUsed: false };
  }
  try {
    return {
      stream: await mediaDevices.getUserMedia({
        audio: { ...baseConstraints, deviceId: { exact: selectedDeviceId } },
        video: false,
      }),
      fallbackUsed: false,
    };
  } catch (error) {
    if (!(error instanceof DOMException) || !["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(error.name)) throw error;
    return { stream: await mediaDevices.getUserMedia({ audio: baseConstraints, video: false }), fallbackUsed: true };
  }
}

export function subscribeToMicrophoneChanges(events: MicrophoneDeviceEvents, refresh: () => void): () => void {
  events.addEventListener("devicechange", refresh);
  return () => events.removeEventListener("devicechange", refresh);
}

/** Stateful box-filter resampler. It averages source intervals when reducing rate. */
export class StreamingPcm16Resampler {
  private sourcePosition = 0;
  private nextOutputBoundary: number;
  private area = 0;
  private width = 0;

  constructor(readonly inputRate: number, readonly outputRate = ASR_SAMPLE_RATE) {
    if (!Number.isFinite(inputRate) || inputRate <= 0 || outputRate <= 0 || outputRate > inputRate) throw new Error("Frecuencias de remuestreo no válidas.");
    this.nextOutputBoundary = inputRate / outputRate;
  }

  process(input: Float32Array): Int16Array {
    const output: number[] = [];
    const period = this.inputRate / this.outputRate;
    for (const rawSample of input) {
      const sample = Math.max(-1, Math.min(1, rawSample));
      let remaining = 1;
      while (remaining > 0) {
        const untilBoundary = this.nextOutputBoundary - this.sourcePosition;
        const consumed = Math.min(remaining, untilBoundary);
        this.area += sample * consumed;
        this.width += consumed;
        this.sourcePosition += consumed;
        remaining -= consumed;
        if (this.sourcePosition + 1e-9 >= this.nextOutputBoundary) {
          const averaged = this.width > 0 ? this.area / this.width : 0;
          output.push(averaged < 0 ? Math.round(averaged * 0x8000) : Math.round(averaged * 0x7fff));
          this.area = 0;
          this.width = 0;
          this.nextOutputBoundary += period;
        }
      }
    }
    return Int16Array.from(output);
  }
}

export class Pcm16ChunkAggregator {
  private pending = new Int16Array(0);

  constructor(readonly targetSamples = 960) {
    if (!Number.isSafeInteger(targetSamples) || targetSamples <= 0) throw new Error("Tamaño de bloque PCM no válido.");
  }

  push(input: Int16Array): Int16Array[] {
    const combined = new Int16Array(this.pending.length + input.length);
    combined.set(this.pending);
    combined.set(input, this.pending.length);
    const chunks: Int16Array[] = [];
    let offset = 0;
    while (combined.length - offset >= this.targetSamples) {
      chunks.push(combined.slice(offset, offset + this.targetSamples));
      offset += this.targetSamples;
    }
    this.pending = combined.slice(offset);
    return chunks;
  }

  flush(): Int16Array | null {
    if (this.pending.length === 0) return null;
    const remaining = this.pending;
    this.pending = new Int16Array(0);
    return remaining;
  }
}
