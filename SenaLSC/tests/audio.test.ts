import { describe, expect, it, vi } from "vitest";
import { AUDIO_IPC_BATCH_SAMPLES, Pcm16ChunkAggregator, StreamingPcm16Resampler, enumerateMicrophones, labelDefaultWoMic, mapMicrophoneDevices, microphoneConstraints, normalizeDeviceLabel, openSelectedMicrophone, selectPreferredMicrophone, subscribeToMicrophoneChanges, type MicrophoneDeviceSource } from "../src/shared/audio";

describe("audio de entrada", () => {
  it("prefiere WO-Mic, conserva selección válida y descarta IDs ausentes", () => {
    const devices = [{ deviceId: "default", label: "Predeterminado" }, { deviceId: "wo", label: "WO Mic Device" }, { deviceId: "usb", label: "USB" }];
    expect(normalizeDeviceLabel("WO-Mic (Audio) ")).toContain("wo mic");
    expect(selectPreferredMicrophone(devices, null)).toBe("wo");
    expect(selectPreferredMicrophone(devices, "usb")).toBe("usb");
    expect(selectPreferredMicrophone(devices, "ausente")).toBe("default");
  });

  it("conserva default, communications y todos los dispositivos físicos sin deduplicar por etiqueta", () => {
    const sources: MicrophoneDeviceSource[] = [
      { kind: "audioinput", deviceId: "default", groupId: "g1", label: "" },
      { kind: "audioinput", deviceId: "communications", groupId: "g1", label: "" },
      { kind: "audioinput", deviceId: "usb-1", groupId: "g2", label: "USB" },
      { kind: "audioinput", deviceId: "usb-2", groupId: "g3", label: "USB" },
      { kind: "audioinput", deviceId: "usb-2", groupId: "g3", label: "USB duplicado" },
      { kind: "videoinput", deviceId: "camera", groupId: "g4", label: "Cámara" },
    ];
    expect(mapMicrophoneDevices(sources)).toEqual([
      { deviceId: "default", label: "Predeterminado del sistema" },
      { deviceId: "communications", label: "Comunicaciones del sistema" },
      { deviceId: "usb-1", label: "USB" },
      { deviceId: "usb-2", label: "USB" },
    ]);
  });

  it("solicita audio para revelar etiquetas, detiene la solicitud inicial y luego enumera", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    const enumerateDevices = vi.fn(() => Promise.resolve([
      { kind: "audioinput", deviceId: "default", groupId: "", label: "Micrófono principal" },
    ] as MicrophoneDeviceSource[]));
    const devices = await enumerateMicrophones({ getUserMedia, enumerateDevices }, true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
    expect(devices[0]?.label).toBe("Micrófono principal");
  });

  it("intenta una sola vez el dispositivo elegido y cae al predeterminado", async () => {
    const fallbackStream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("desconectado", "NotFoundError"))
      .mockResolvedValueOnce(fallbackStream);
    const result = await openSelectedMicrophone({ getUserMedia, enumerateDevices: vi.fn() }, "usb-ausente", { channelCount: 1 });
    expect(result).toEqual({ stream: fallbackStream, fallbackUsed: true });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({ audio: { deviceId: { exact: "usb-ausente" } }, video: false });
    expect(getUserMedia.mock.calls[1]?.[0]).toEqual({ audio: { channelCount: 1 }, video: false });
  });

  it("registra y limpia devicechange", () => {
    const listeners = new Set<() => void>();
    const refresh = vi.fn();
    const unsubscribe = subscribeToMicrophoneChanges({
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    }, refresh);
    for (const listener of listeners) listener();
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it("remuestrea 48 kHz a 16 kHz de forma stateful y acotada", () => {
    const resampler = new StreamingPcm16Resampler(48_000);
    const first = resampler.process(Float32Array.from([1, 1, 1, -1]));
    const second = resampler.process(Float32Array.from([-1, -1]));
    expect([...first, ...second]).toEqual([32767, -32768]);
    expect(new StreamingPcm16Resampler(16_000).process(Float32Array.from([2, -2]))).toEqual(Int16Array.from([32767, -32768]));
  });

  it("desactiva todo procesamiento del navegador solo para WO Mic", () => {
    expect(microphoneConstraints("WO Mic Device")).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
    expect(microphoneConstraints("Micrófono USB")).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
  });

  it("rotula el default oculto por Wayland cuando PipeWire confirma WO Mic", () => {
    const hidden = [{ deviceId: "", label: "Micrófono 1" }];
    const labeled = labelDefaultWoMic(hidden, true);
    expect(labeled).toEqual([{ deviceId: "", label: "WO Mic (predeterminado del sistema)" }]);
    expect(microphoneConstraints(labeled[0]?.label ?? "")).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(labelDefaultWoMic(hidden, false)).toEqual(hidden);
  });

  it("agrega exactamente 40 ms y conserva el remanente para stop-flush", () => {
    const aggregator = new Pcm16ChunkAggregator(AUDIO_IPC_BATCH_SAMPLES);
    expect(aggregator.push(new Int16Array(320))).toEqual([]);
    const chunks = aggregator.push(Int16Array.from({ length: 640 }, (_value, index) => index));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(640);
    expect(aggregator.flush()).toHaveLength(320);
    expect(aggregator.flush()).toBeNull();
  });
});
