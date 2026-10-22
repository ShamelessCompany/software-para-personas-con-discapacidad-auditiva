import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ASR_SAMPLE_RATE, AUDIO_IPC_BATCH_SAMPLES, MICROPHONE_STORAGE_KEY, Pcm16ChunkAggregator, StreamingPcm16Resampler, enumerateMicrophones, labelDefaultWoMic, microphoneConstraints, openSelectedMicrophone, selectPreferredMicrophone, subscribeToMicrophoneChanges, type AudioRateInfo, type SelectableMicrophone } from "../../shared/audio";

interface MicrophoneController {
  devices: SelectableMicrophone[];
  selectedDeviceId: string;
  setSelectedDeviceId: (value: string) => void;
  level: number;
  error: string;
  message: string;
  permissionGranted: boolean;
  testing: boolean;
  audioDetected: boolean;
  rateInfo: AudioRateInfo;
  refreshDevices: (requestPermission?: boolean) => Promise<void>;
  test: () => Promise<void>;
  start: () => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => void;
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "El permiso del micrófono fue denegado. Habilítelo en Windows y vuelva a intentar.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No se encontró el micrófono seleccionado. Puede haberse desconectado.";
  if (error instanceof DOMException && error.name === "NotReadableError") return "El micrófono está ocupado o no puede leerse.";
  return "No fue posible iniciar el micrófono. Revise la conexión y los permisos.";
}

export function useMicrophone(): MicrophoneController {
  const [devices, setDevices] = useState<SelectableMicrophone[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("default");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Pendiente de permiso");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [testing, setTesting] = useState(false);
  const [audioDetected, setAudioDetected] = useState(false);
  const [rateInfo, setRateInfo] = useState<AudioRateInfo>({ trackSampleRate: null, contextSampleRate: null, outputSampleRate: ASR_SAMPLE_RATE, resampling: false });
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const aggregatorRef = useRef<Pcm16ChunkAggregator | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const testContextRef = useRef<AudioContext | null>(null);
  const testAnimationRef = useRef<number | null>(null);

  const chooseDevice = (available: SelectableMicrophone[], current: string): string => {
    const saved = localStorage.getItem(MICROPHONE_STORAGE_KEY);
    const persisted = saved ?? (current !== "default" && available.some((device) => device.deviceId === current) ? current : null);
    const selected = selectPreferredMicrophone(available, persisted);
    if (persisted && selected !== persisted) setMessage("El micrófono guardado ya no está disponible. Se seleccionó el dispositivo predeterminado.");
    if (selected === "default") localStorage.removeItem(MICROPHONE_STORAGE_KEY);
    else localStorage.setItem(MICROPHONE_STORAGE_KEY, selected);
    return selected;
  };

  const selectDevice = (value: string): void => {
    setSelectedDeviceId(value);
    if (value === "default") localStorage.removeItem(MICROPHONE_STORAGE_KEY);
    else localStorage.setItem(MICROPHONE_STORAGE_KEY, value);
  };

  const refreshDevices = async (requestPermission = true): Promise<void> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) throw new Error("Este entorno no permite consultar micrófonos.");
      const [enumerated, defaultSource] = await Promise.all([
        enumerateMicrophones(navigator.mediaDevices, requestPermission),
        window.senaLsc.getDefaultAudioSource(),
      ]);
      const available = labelDefaultWoMic(enumerated, defaultSource.isWoMic);
      if (requestPermission) {
        setPermissionGranted(true);
        setMessage("Permiso concedido. Elija un micrófono y pruebe el audio.");
      }
      setDevices(available);
      setSelectedDeviceId((current) => chooseDevice(available, current));
      setError("");
    } catch (caught) {
      const detail = microphoneErrorMessage(caught);
      setError(detail);
      setMessage(detail);
    }
  };

  const applyDeviceList = useEffectEvent((available: SelectableMicrophone[]) => {
    setDevices(available);
    setSelectedDeviceId((current) => chooseDevice(available, current));
  });

  const reportDeviceError = useEffectEvent(() => {
    setError("No se pudieron consultar los micrófonos.");
  });

  const stop = (): void => {
    const remaining = aggregatorRef.current?.flush();
    if (remaining && remaining.byteLength > 0) window.senaLsc.sendAudio(remaining.buffer.slice(remaining.byteOffset, remaining.byteOffset + remaining.byteLength) as ArrayBuffer);
    aggregatorRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (contextRef.current) void contextRef.current.close();
    contextRef.current = null;
    setLevel(0);
    setRateInfo({ trackSampleRate: null, contextSampleRate: null, outputSampleRate: ASR_SAMPLE_RATE, resampling: false });
  };

  const stopTest = (): void => {
    if (testAnimationRef.current !== null) cancelAnimationFrame(testAnimationRef.current);
    testAnimationRef.current = null;
    testStreamRef.current?.getTracks().forEach((track) => track.stop());
    testStreamRef.current = null;
    if (testContextRef.current) void testContextRef.current.close();
    testContextRef.current = null;
    setTesting(false);
  };

  const test = async (): Promise<void> => {
    stopTest();
    setError("");
    setLevel(0);
    setAudioDetected(false);
    setTesting(true);
    setMessage("Probando micrófono durante 4 segundos...");
    try {
      const selectedLabel = devices.find((device) => device.deviceId === selectedDeviceId)?.label ?? "";
      const result = await openSelectedMicrophone(navigator.mediaDevices, selectedDeviceId, microphoneConstraints(selectedLabel));
      if (result.fallbackUsed) {
        selectDevice("default");
        setMessage("El dispositivo elegido falló. Probando el micrófono predeterminado.");
      }
      setPermissionGranted(true);
      testStreamRef.current = result.stream;
      const context = new AudioContext();
      testContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(result.stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let detected = false;
      const update = (): void => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        const nextLevel = Math.min(1, rms * 6);
        if (nextLevel > 0.03) detected = true;
        setLevel(nextLevel);
        testAnimationRef.current = requestAnimationFrame(update);
      };
      update();
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      setAudioDetected(detected);
      const woMicSelected = /\bwo[\s-]*mic\b/i.test(selectedLabel);
      setMessage(detected ? "Recibiendo audio" : woMicSelected
        ? "Reconecta USB, activa Anclaje USB y Start en WO Mic"
        : "No se detectó audio. Hable cerca del micrófono o revise el nivel de entrada de Windows.");
      await refreshDevices(false);
    } catch (caught) {
      const detail = microphoneErrorMessage(caught);
      setError(detail);
      setMessage(detail);
    } finally {
      stopTest();
    }
  };

  const start = async (): Promise<boolean> => {
    stop();
    setError("");
    try {
      const selectedLabel = devices.find((device) => device.deviceId === selectedDeviceId)?.label ?? "";
      const audioConstraints: MediaTrackConstraints = microphoneConstraints(selectedLabel);
      const opened = await openSelectedMicrophone(navigator.mediaDevices, selectedDeviceId, audioConstraints);
      const stream = opened.stream;
      if (opened.fallbackUsed) {
        selectDevice("default");
        setMessage("El micrófono seleccionado falló. La escucha continúa con el dispositivo predeterminado.");
      }
      setPermissionGranted(true);
      const context = new AudioContext({ sampleRate: ASR_SAMPLE_RATE });
      const trackSampleRate = stream.getAudioTracks()[0]?.getSettings().sampleRate ?? null;
      const contextSampleRate = context.sampleRate;
      const resampler = new StreamingPcm16Resampler(contextSampleRate);
       const aggregator = new Pcm16ChunkAggregator(AUDIO_IPC_BATCH_SAMPLES);
      aggregatorRef.current = aggregator;
      setRateInfo({ trackSampleRate, contextSampleRate, outputSampleRate: ASR_SAMPLE_RATE, resampling: contextSampleRate !== ASR_SAMPLE_RATE });
      const source = context.createMediaStreamSource(stream);
      await context.audioWorklet.addModule(new URL("./pcm-capture-worklet.js", window.location.href).href);
      const processor = new AudioWorkletNode(context, "senalsc-pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const silence = context.createGain();
      silence.gain.value = 0;
      processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const channel = event.data;
        const rms = Math.sqrt(channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length);
        setLevel(Math.min(1, rms * 5));
        const pcm = resampler.process(channel);
        for (const chunk of aggregator.push(pcm)) {
          window.senaLsc.sendAudio(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
        }
      };
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
      stream.getAudioTracks()[0]?.addEventListener("ended", () => setError("El micrófono se desconectó durante la escucha."));
      streamRef.current = stream;
      contextRef.current = context;
      processorRef.current = processor;
      await refreshDevices(false);
      return true;
    } catch (caught) {
      setError(microphoneErrorMessage(caught));
      stop();
      return false;
    }
  };

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    const updateDevices = (): void => {
      if (!mediaDevices?.enumerateDevices) return;
      void Promise.all([enumerateMicrophones(mediaDevices, false), window.senaLsc.getDefaultAudioSource()])
        .then(([available, defaultSource]) => applyDeviceList(labelDefaultWoMic(available, defaultSource.isWoMic)))
        .catch(reportDeviceError);
    };
    const handleChange = (): void => updateDevices();
    updateDevices();
    const unsubscribe = mediaDevices ? subscribeToMicrophoneChanges(mediaDevices, handleChange) : () => undefined;
    return () => {
      unsubscribe();
      stop();
      stopTest();
    };
  }, []);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId: selectDevice,
    level,
    error,
    message,
    permissionGranted,
    testing,
    audioDetected,
    rateInfo,
    refreshDevices,
    test,
    start,
    pause: async () => { await contextRef.current?.suspend(); },
    resume: async () => { await contextRef.current?.resume(); },
    stop,
  };
}
