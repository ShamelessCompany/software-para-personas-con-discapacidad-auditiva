import { useEffect, useEffectEvent, useReducer, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings } from "../shared/settings";
import { ASR_ENDPOINTING_MODE, ASR_LANGUAGE_MODE, ASR_PROFILE, CAPTION_POSITION, LISTENING_STATE, RESIDENT_COMMAND, SIDECAR_LIFECYCLE, type AppSettings, type AsrResult, type ExportFormat, type ListeningState, type ResidentPreferences, type SidecarStatus, type TranscriptEntry } from "../shared/types";
import { TRANSCRIPT_ACTION, transcriptReducer } from "../shared/transcript";
import { VisualLibrary } from "./components/VisualLibrary";
import { VisualMedia } from "./components/VisualMedia";
import { DEMO_PHRASES } from "./data";
import { DemoSession } from "./demo-session";
import { useMicrophone } from "./hooks/useMicrophone";
import { useVisualMedia } from "./hooks/useVisualMedia";
import { LISTENING_TRANSITION_RESULT, ListeningTransitionController, type ListeningTransitionResult } from "./listening-transition";

const TAB = {
  LIVE: "live",
  HISTORY: "history",
  LIBRARY: "library",
  SETTINGS: "settings",
} as const;

const DEMO_DISTRIBUTION = import.meta.env.VITE_SENALSC_DEMO === "1";
const DEFAULT_RESIDENT_PREFERENCES: ResidentPreferences = { captionsVisible: true, visualSupportVisible: true, launchAtLogin: false };

type Tab = (typeof TAB)[keyof typeof TAB];

const EMPTY_STATUS: SidecarStatus = {
  sessionId: null,
  ownerSessionId: null,
  lifecycle: SIDECAR_LIFECYCLE.STOPPED,
  processRunning: false,
  pythonAvailable: false,
  voskAvailable: false,
  modelAvailable: false,
  ready: false,
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
  modelPath: "",
  requestedProfile: ASR_PROFILE.PRECISE,
  activeProfile: ASR_PROFILE.PRECISE,
  modelName: "vosk-model-es-0.42",
  fallbackReason: null,
  languageMode: ASR_LANGUAGE_MODE.UNKNOWN,
  endpointingMode: ASR_ENDPOINTING_MODE.UNKNOWN,
  endpointingMessage: "Se confirmará al iniciar el motor.",
  message: "Comprobando reconocimiento local...",
};

function createEntry(text: string, source: TranscriptEntry["source"]): TranscriptEntry {
  return { id: crypto.randomUUID(), text, timestamp: new Date().toISOString(), source };
}

function StatusItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={ok ? "status-ok" : "status-warn"}>
      <span aria-hidden="true">{ok ? "✓" : "!"}</span>
      <div><strong>{label}</strong><small>{detail}</small></div>
    </li>
  );
}

interface OperationalStatus {
  key: string;
  icon: string;
  label: string;
  detail: string;
}

function operationalStatus(listeningState: ListeningState, sidecarStatus: SidecarStatus, microphone: Pick<ReturnType<typeof useMicrophone>, "devices" | "error" | "permissionGranted" | "testing" | "audioDetected">): OperationalStatus {
  if (listeningState === LISTENING_STATE.ERROR || microphone.error) return { key: "error", icon: "!", label: "Requiere atención", detail: microphone.error || sidecarStatus.message };
  if (listeningState === LISTENING_STATE.LISTENING) return { key: "listening", icon: "●", label: "Escuchando", detail: "El audio se procesa localmente y no se guarda" };
  if (listeningState === LISTENING_STATE.PAUSED) return { key: "paused", icon: "Ⅱ", label: "Pausado", detail: "El micrófono está suspendido; puede reanudar o detener" };
  if (listeningState === LISTENING_STATE.STARTING) return { key: "permission", icon: "…", label: "Solicitando permiso", detail: "Preparando micrófono y motor offline" };
  if (microphone.testing) return { key: "testing", icon: "~", label: "Probando micrófono", detail: "Hable con normalidad durante cuatro segundos" };
  if (microphone.devices.length === 0 && microphone.permissionGranted) return { key: "no-microphone", icon: "×", label: "Sin micrófono", detail: "Conecte un dispositivo y pulse Actualizar" };
  if (microphone.audioDetected) return { key: "audio", icon: "✓", label: "Audio detectado", detail: "El micrófono está listo para iniciar" };
  if (!sidecarStatus.ready) return { key: "loading", icon: "…", label: "Motor cargando", detail: sidecarStatus.message };
  return { key: "ready", icon: "✓", label: "Listo", detail: "Motor offline disponible; la escucha aún no ha iniciado" };
}

export function App() {
  const [tab, setTab] = useState<Tab>(TAB.LIVE);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings(localStorage));
  const [entries, dispatch] = useReducer(transcriptReducer, []);
  const [livePartial, setLivePartial] = useState("");
  const [confirmedPhrase, setConfirmedPhrase] = useState<TranscriptEntry | null>(null);
  const [confirmedExpiresAt, setConfirmedExpiresAt] = useState<number | null>(null);
  const [listeningState, setListeningState] = useState<ListeningState>(LISTENING_STATE.IDLE);
  const [demoMode, setDemoMode] = useState(false);
  const [sidecarStatus, setSidecarStatus] = useState(EMPTY_STATUS);
  const [notice, setNotice] = useState("La transcripción se procesa localmente y no se guarda automáticamente.");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [residentPreferences, setResidentPreferences] = useState(DEFAULT_RESIDENT_PREFERENCES);
  const [launchAtLoginAvailable, setLaunchAtLoginAvailable] = useState(false);
  const [contentSource, setContentSource] = useState<TranscriptEntry["source"] | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const isActive = listeningState === LISTENING_STATE.LISTENING || listeningState === LISTENING_STATE.PAUSED;
  const microphone = useMicrophone();
  const microphoneRef = useRef(microphone);
  const settingsRef = useRef(settings);
  const visualMedia = useVisualMedia({ unifiedLscLibrary: settings.unifiedLscLibrary, includeCommunityContent: settings.includeCommunityContent, technicalSpelling: settings.technicalSpelling, showVisualSupport: settings.showVisualSupport, durationMs: settings.visualDurationMs });
  const visualMediaRef = useRef(visualMedia);
  const lastPartialRef = useRef("");
  const demoSessionKeyRef = useRef("demo:0");
  const demoSessionSequence = useRef(0);

  const demoSession = useRef<DemoSession | null>(null);
  const transitionController = useRef<ListeningTransitionController | null>(null);
  useEffect(() => {
    microphoneRef.current = microphone;
    settingsRef.current = settings;
    visualMediaRef.current = visualMedia;
  });
  useEffect(() => {
    demoSession.current = new DemoSession(DEMO_PHRASES, {
      onPartial: (text) => {
        setContentSource("demo");
        setLivePartial(text);
        visualMediaRef.current.processText(text, false, demoSessionKeyRef.current, Date.now());
      },
      onFinal: (text) => {
        const entry = createEntry(text, "demo");
        dispatch({ type: TRANSCRIPT_ACTION.ADD_FINAL, entry });
        setLivePartial("");
        setConfirmedPhrase(entry);
        setConfirmedExpiresAt(Date.now() + 3_500);
        setContentSource("demo");
        visualMediaRef.current.processText(text, true, demoSessionKeyRef.current, Date.now());
      },
    });
    const controller = new ListeningTransitionController({
      startMicrophone: () => microphoneRef.current.start(),
      pauseMicrophone: () => microphoneRef.current.pause(),
      resumeMicrophone: () => microphoneRef.current.resume(),
      stopMicrophone: () => microphoneRef.current.stop(),
      startAsr: () => window.senaLsc.startAsr({ sampleRate: 16_000, profile: settingsRef.current.asrProfile }),
      stopAsr: () => window.senaLsc.stopAsr(),
      startDemo: () => demoSession.current?.start(),
      pauseDemo: () => demoSession.current?.pause(),
      resumeDemo: () => demoSession.current?.resume(),
      cancelDemo: () => demoSession.current?.cancel(),
      onTransition: setTransitioning,
    });
    transitionController.current = controller;
    return () => {
      controller.dispose();
      transitionController.current = null;
      demoSession.current = null;
    };
  }, []);
  const handleAsrResult = useEffectEvent((result: AsrResult) => {
    if (!transitionController.current?.acceptsAsrResult(result)) return;
    const sessionKey = `asr:${result.sessionId}`;
    if (result.kind === "partial") {
      if (result.text === lastPartialRef.current) return;
      lastPartialRef.current = result.text;
      setContentSource("asr");
      setLivePartial(result.text);
      visualMediaRef.current.processText(result.text, false, sessionKey, Date.now());
    }
    else {
      lastPartialRef.current = "";
      const entry = createEntry(result.text, "asr");
      dispatch({ type: TRANSCRIPT_ACTION.ADD_FINAL, entry });
      setLivePartial("");
      setConfirmedPhrase(entry);
      setConfirmedExpiresAt(Date.now() + 3_500);
      setContentSource("asr");
      visualMediaRef.current.processText(result.text, true, sessionKey, Date.now());
    }
  });

  const handleSidecarStatus = useEffectEvent((status: SidecarStatus) => {
    const controller = transitionController.current;
    if (controller && !controller.acceptsSidecarStatus(status)) return;
    setSidecarStatus(status);
    const failedDuringStart = controller?.isStartingReal() && status.lifecycle === SIDECAR_LIFECYCLE.STOPPED && !status.ready;
    const failedWhileListening = controller?.isRealActive() && !status.ready;
    if (controller && (failedDuringStart || failedWhileListening)) {
      void controller.cancelReal();
      setListeningState(LISTENING_STATE.ERROR);
      setNotice(status.message);
      setNoticeIsError(true);
    }
  });

  useEffect(() => {
    void window.senaLsc.getSidecarStatus(settingsRef.current.asrProfile).then(handleSidecarStatus).catch(() => {
      setSidecarStatus({ ...EMPTY_STATUS, message: "No se pudo consultar el reconocedor local." });
      setNotice("No se pudo consultar el reconocedor local.");
      setNoticeIsError(true);
    });
    const unsubscribeResult = window.senaLsc.onAsrResult(handleAsrResult);
    const unsubscribeStatus = window.senaLsc.onSidecarStatus(handleSidecarStatus);
    void window.senaLsc.getResidentPreferences().then((result) => {
      setResidentPreferences(result.preferences);
      setLaunchAtLoginAvailable(result.launchAtLoginAvailable);
    });
    const unsubscribePreferences = window.senaLsc.onResidentPreferences((result) => {
      setResidentPreferences(result.preferences);
      setLaunchAtLoginAvailable(result.launchAtLoginAvailable);
    });
    const unsubscribePlaylist = window.senaLsc.onOverlayPlaylistAdvance(() => visualMediaRef.current.advancePlaylist());
    return () => {
      unsubscribeResult();
      unsubscribeStatus();
      unsubscribePreferences();
      unsubscribePlaylist();
    };
  }, []);

  useEffect(() => {
    if (isActive) return;
    void window.senaLsc.getSidecarStatus(settings.asrProfile).then(handleSidecarStatus);
  }, [settings.asrProfile, isActive]);

  useEffect(() => {
    localStorage.setItem("senalsc:settings", JSON.stringify(settings));
  }, [settings]);

  const refreshSettingsMicrophones = useEffectEvent(() => {
    void microphoneRef.current.refreshDevices(false);
  });

  useEffect(() => {
    if (tab !== TAB.SETTINGS) return;
    refreshSettingsMicrophones();
    window.addEventListener("focus", refreshSettingsMicrophones);
    return () => window.removeEventListener("focus", refreshSettingsMicrophones);
  }, [tab]);

  useEffect(() => {
    if (confirmedExpiresAt === null) return;
    const timeout = window.setTimeout(() => {
      setConfirmedPhrase(null);
      setConfirmedExpiresAt(null);
    }, Math.max(0, confirmedExpiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [confirmedExpiresAt]);

  useEffect(() => {
    window.senaLsc.updateOverlay({
      livePartial,
      confirmedPhrase,
      confirmedExpiresAt,
      demoMode,
      contentSource,
      listeningState,
      microphoneLabel: microphone.devices.find((device) => device.deviceId === microphone.selectedDeviceId)?.label ?? "Micrófono predeterminado",
      settings,
      activeMedia: visualMedia.activeMedia,
      mediaError: visualMedia.mediaError,
    });
  }, [confirmedExpiresAt, confirmedPhrase, contentSource, demoMode, listeningState, livePartial, microphone.devices, microphone.selectedDeviceId, settings, visualMedia.activeMedia, visualMedia.mediaError]);

  useEffect(() => {
    window.senaLsc.reportResidentState({ listeningState, demoMode, transitioning });
  }, [demoMode, listeningState, transitioning]);

  const applyStartFailure = (result: ListeningTransitionResult | null, fallback: string): boolean => {
    if (!result) return true;
    if (result.kind === LISTENING_TRANSITION_RESULT.OPERATION_FAILED) {
      setListeningState(LISTENING_STATE.ERROR);
      setNotice(result.operation?.message ?? fallback);
      setNoticeIsError(true);
      return true;
    }
    return false;
  };

  const startDemo = async (): Promise<void> => {
    const controller = transitionController.current;
    if (!controller) return;
    demoSessionSequence.current += 1;
    demoSessionKeyRef.current = `demo:${demoSessionSequence.current}`;
    visualMedia.beginSession(demoSessionKeyRef.current);
    setListeningState(LISTENING_STATE.STARTING);
    const result = await controller.startDemo();
    if (applyStartFailure(result, "No se pudo preparar el modo demostración porque falló el cierre del reconocimiento local.")) {
      visualMedia.clearSession();
      return;
    }
    setLivePartial("");
    setContentSource("demo");
    setDemoMode(true);
    setListeningState(LISTENING_STATE.LISTENING);
    setNotice("Modo demostración activo. Estas frases son preparadas y no provienen del micrófono.");
    setNoticeIsError(false);
    window.senaLsc.hideMainWindow();
  };

  const startReal = async (): Promise<void> => {
    const controller = transitionController.current;
    if (!controller) return;
    setDemoMode(false);
    setLivePartial("");
    lastPartialRef.current = "";
    visualMedia.clearSession();
    setContentSource("asr");
    setListeningState(LISTENING_STATE.STARTING);
    setNotice("Solicitando acceso al micrófono...");
    setNoticeIsError(false);
    const result = await controller.startReal();
    if (!result) return;
    if (result.kind === LISTENING_TRANSITION_RESULT.MICROPHONE_FAILED) {
      microphone.stop();
      setListeningState(LISTENING_STATE.ERROR);
      setNotice(microphone.error || "No fue posible iniciar el micrófono. Revise la conexión y los permisos.");
      setNoticeIsError(true);
      return;
    }
    if (applyStartFailure(result, "No se pudo iniciar la escucha real. Intente nuevamente.")) return;
    if (result.operation && "sessionId" in result.operation && result.operation.sessionId) visualMedia.beginSession(`asr:${result.operation.sessionId}`);
    setListeningState(LISTENING_STATE.LISTENING);
    setNotice("Escucha real activa. El audio se procesa localmente y no se guarda.");
    window.senaLsc.hideMainWindow();
  };

  const pause = async (): Promise<void> => {
    const controller = transitionController.current;
    if (!controller) return;
    const result = await controller.pause(demoMode);
    if (!result) return;
    setListeningState(LISTENING_STATE.PAUSED);
    setNotice(demoMode ? "Demostración pausada." : "Micrófono pausado. El sidecar sigue preparado localmente.");
  };

  const resume = async (): Promise<void> => {
    const controller = transitionController.current;
    if (!controller) return;
    const result = await controller.resume(demoMode);
    if (!result) return;
    setListeningState(LISTENING_STATE.LISTENING);
    setNotice(demoMode ? "Demostración reanudada." : "Escucha real reanudada.");
  };

  const stop = async (): Promise<void> => {
    const controller = transitionController.current;
    if (!controller) return;
    const wasDemo = demoMode;
    const result = await controller.stop();
    if (!result) return;
    if (result.kind === LISTENING_TRANSITION_RESULT.OPERATION_FAILED) {
      setListeningState(LISTENING_STATE.ERROR);
      setNotice(result.operation?.message ?? "No se pudo confirmar el cierre del reconocimiento local.");
      setNoticeIsError(true);
      return;
    }
    setListeningState(LISTENING_STATE.IDLE);
    setLivePartial("");
    lastPartialRef.current = "";
    setDemoMode(false);
    visualMedia.clearSession();
    setNotice(wasDemo ? "Demostración detenida." : (result.operation?.message ?? "Escucha detenida."));
    setNoticeIsError(false);
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setSettings((current) => normalizeSettings({ ...current, [key]: value }));
  };

  const activateUnifiedLibrary = async (): Promise<void> => {
    setSettings((current) => normalizeSettings({ ...current, unifiedLscLibrary: true, showVisualSupport: true }));
    if (!residentPreferences.visualSupportVisible) await updateResidentPreference("visualSupportVisible", true);
    setNotice("Biblioteca LSC básica activada. El apoyo visual residente también quedó visible.");
    setNoticeIsError(false);
  };

  const activateCommunityContent = async (): Promise<void> => {
    setSettings((current) => normalizeSettings({ ...current, unifiedLscLibrary: true, includeCommunityContent: true, showVisualSupport: true }));
    if (!residentPreferences.visualSupportVisible) await updateResidentPreference("visualSupportVisible", true);
    setNotice("EXPRESA comunitario activado para uso académico/no comercial. Los videos originales se reproducen sin modificaciones.");
    setNoticeIsError(false);
  };

  const updateResidentPreference = async <K extends keyof ResidentPreferences>(key: K, value: ResidentPreferences[K]): Promise<void> => {
    try {
      const result = await window.senaLsc.setResidentPreferences({ ...residentPreferences, [key]: value });
      setResidentPreferences(result.preferences);
      setLaunchAtLoginAvailable(result.launchAtLoginAvailable);
      setNotice("Preferencias residentes actualizadas.");
      setNoticeIsError(false);
    } catch {
      setNotice("No se pudieron guardar las preferencias residentes.");
      setNoticeIsError(true);
    }
  };

  const handleResidentCommand = useEffectEvent((command: typeof RESIDENT_COMMAND.TOGGLE_LISTENING) => {
    if (command !== RESIDENT_COMMAND.TOGGLE_LISTENING || transitioning) return;
    if (isActive) void stop();
    else if (DEMO_DISTRIBUTION) void startDemo();
    else void startReal();
  });

  useEffect(() => window.senaLsc.onResidentCommand(handleResidentCommand), []);

  const exportTranscript = async (format: ExportFormat): Promise<void> => {
    if (entries.length === 0) {
      setNotice("No hay transcripción para exportar.");
      return;
    }
    try {
      const result = await window.senaLsc.exportTranscript({ format, entries });
      setNotice(result.message);
      setNoticeIsError(!result.ok && result.message !== "Exportación cancelada.");
    } catch {
      setNotice("No se pudo exportar la transcripción.");
      setNoticeIsError(true);
    }
  };

  const displayText = livePartial || confirmedPhrase?.text || "";
  const operational = operationalStatus(listeningState, sidecarStatus, microphone);

  return (
    <div className={settings.highContrast ? "app high-contrast" : "app"} style={{ "--caption-size": `${settings.fontSize}px`, "--caption-lines": settings.maxLines } as CSSProperties}>
      {DEMO_DISTRIBUTION && <div className="demo-banner" role="status">EDICIÓN DEMOSTRATIVA · no incluye reconocimiento de voz real</div>}
      {!DEMO_DISTRIBUTION && contentSource === "demo" && <div className="demo-banner" role="status">MODO DEMOSTRACIÓN · frases preparadas, sin reconocimiento de micrófono</div>}
      <header className="topbar">
        <div className="brand"><img src="./sena-logo-ui.png" alt="Logo del SENA" width="48" height="48" /><div><strong>SenaLSC</strong><small>Subtítulos offline para el aula</small></div></div>
        <div className="resident-state" data-state={operational.key} role="status"><span aria-hidden="true">{operational.icon}</span><div><strong>{operational.label}</strong><small>Residente en la bandeja</small></div></div>
      </header>

      <nav className="tabs" aria-label="Secciones principales">
        {Object.entries({ [TAB.LIVE]: "Activación", [TAB.HISTORY]: "Historial", [TAB.LIBRARY]: "Biblioteca visual", [TAB.SETTINGS]: "Preferencias" }).map(([value, label]) => (
          <button key={value} className={tab === value ? "active" : ""} aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value as Tab)}>{label}</button>
        ))}
      </nav>

      <main>
        {tab === TAB.LIVE && (
          <section className="activation-console" aria-labelledby="live-title">
            <div className="activation-intro">
              <div><p className="eyebrow">CONSOLA DE ACTIVACIÓN</p><h1 id="live-title">Subtítulos listos para el aula</h1><p>Al iniciar, esta ventana se oculta y SenaLSC continúa en la bandeja. La barra aparece en la posición elegida y el apoyo visual, cuando corresponde, se ubica arriba a la derecha.</p></div>
              <div className="service-state" data-state={operational.key} role="status" aria-label={`Estado: ${operational.label}`}><span aria-hidden="true">{operational.icon}</span><div><strong>{operational.label}</strong><small>{operational.detail}</small></div></div>
            </div>

            <section className="start-panel" aria-labelledby="start-title">
              <div><p className="eyebrow">SERVICIO RESIDENTE</p><h2 id="start-title">Active los subtítulos cuando comience la clase</h2><p>El audio se procesa en este equipo, no se graba y no se envía a internet.</p></div>
              <div className="start-actions">
                {!isActive && !DEMO_DISTRIBUTION && <button data-testid="primary-listening-cta" className="primary primary-cta" onClick={() => void startReal()} disabled={!sidecarStatus.ready || transitioning}>{transitioning ? "Preparando..." : "Iniciar subtítulos"}</button>}
                {listeningState === LISTENING_STATE.LISTENING && <button className="secondary" onClick={() => void pause()} disabled={transitioning}>Pausar</button>}
                {listeningState === LISTENING_STATE.PAUSED && <button className="primary" onClick={() => void resume()} disabled={transitioning}>Reanudar</button>}
                {isActive && <button data-testid="primary-listening-cta" className="danger primary-cta" onClick={() => void stop()} disabled={transitioning}>Detener subtítulos</button>}
                {!isActive && <button className="secondary demo-action" onClick={() => void startDemo()} disabled={transitioning}>Probar demostración</button>}
              </div>
            </section>

            <div className="activation-grid">
              <section className="setup-section microphone-section" aria-labelledby="microphone-title">
                <div className="section-title"><div><p className="eyebrow">1 · ENTRADA DE AUDIO</p><h2 id="microphone-title">Micrófono</h2></div><span className="section-state">{microphone.audioDetected ? "✓ Audio detectado" : microphone.permissionGranted ? "○ Pendiente de prueba" : "○ Pendiente de permiso"}</span></div>
                <label htmlFor="microphone">Dispositivo de entrada</label>
                <select data-testid="microphone-selector" id="microphone" value={microphone.selectedDeviceId} onFocus={() => void microphone.refreshDevices(true)} onChange={(event) => microphone.setSelectedDeviceId(event.target.value)} disabled={isActive || microphone.testing}>
                  {microphone.devices.length === 0 && <option value="default">Sin micrófonos detectados</option>}
                  {microphone.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
                </select>
                <div className="microphone-tools"><button className="secondary" onClick={() => void microphone.refreshDevices(true)} disabled={microphone.testing}>Actualizar</button><button className="secondary" onClick={() => void microphone.test()} disabled={isActive || microphone.testing}>{microphone.testing ? "Probando..." : "Probar micrófono"}</button></div>
                <div className="level-block"><div><span>Nivel de entrada</span><output>{Math.round(microphone.level * 100)}%</output></div><meter min="0" max="1" value={microphone.level} aria-label={`Nivel ${Math.round(microphone.level * 100)} por ciento`} /></div>
                <p className={microphone.error ? "error-message" : "status-detail"} role={microphone.error ? "alert" : "status"}>{microphone.message}</p>
              </section>

              <section className="setup-section engine-section" aria-labelledby="engine-title">
                <div className="section-title"><div><p className="eyebrow">2 · MOTOR OFFLINE</p><h2 id="engine-title">Reconocimiento en español</h2></div><span className="section-state">{sidecarStatus.ready ? "✓ Listo" : "… Cargando"}</span></div>
                <p>Vosk convierte voz en texto sin conexión. El modelo se comprueba antes de abrir el micrófono.</p>
                <ul className="engine-checks">
                  <StatusItem ok={sidecarStatus.pythonAvailable && sidecarStatus.voskAvailable} label="Motor local" detail={sidecarStatus.voskAvailable ? "Python privado y Vosk disponibles" : "Recursos del motor incompletos"} />
                  <StatusItem ok={sidecarStatus.modelAvailable} label="Modelo de español" detail={sidecarStatus.modelAvailable ? sidecarStatus.modelName : "No se encontró el modelo"} />
                </ul>
                <label htmlFor="recognition-profile">Precisión del reconocimiento</label>
                <select id="recognition-profile" value={settings.asrProfile} onChange={(event) => updateSetting("asrProfile", event.target.value as AppSettings["asrProfile"])} disabled={isActive}>
                  <option value={ASR_PROFILE.LIGHT}>Rápido, incluido y recomendado</option>
                  <option value={ASR_PROFILE.PRECISE}>Preciso, requiere el modelo grande</option>
                </select>
                <p className="status-detail">Rápido inicia antes y reconoce conversación abierta. Preciso puede tardar varios segundos y solo se usa si el modelo grande está instalado.</p>
                <p className="status-detail">{sidecarStatus.message}</p>
              </section>

              <section className="setup-section support-section" aria-labelledby="support-title">
                <div className="section-title"><div><p className="eyebrow">3 · APOYO VISUAL</p><h2 id="support-title">181 videos · 181 conceptos</h2></div><span className="section-state">{settings.showVisualSupport ? "✓ Visible" : "○ Oculto"}</span></div>
                <p>Una sola biblioteca de signos aislados, sin conceptos repetidos. No constituye traducción gramatical ni reemplaza a un intérprete.</p>
                <div className="source-toggles">
                  <label className="switch-row"><span><strong>Biblioteca LSC</strong><small>52 conceptos académicos canónicos</small></span><input type="checkbox" checked={settings.unifiedLscLibrary} onChange={(event) => event.target.checked ? void activateUnifiedLibrary() : updateSetting("unifiedLscLibrary", false)} /></label>
                  <label className="switch-row"><span><strong>Incluir contenido comunitario no comercial</strong><small>129 originales intactos · CC BY-NC-ND 3.0</small></span><input type="checkbox" checked={settings.includeCommunityContent} disabled={!settings.unifiedLscLibrary} onChange={(event) => event.target.checked ? void activateCommunityContent() : updateSetting("includeCommunityContent", false)} /></label>
                  <label className="switch-row"><span><strong>Deletreo técnico</strong><small>Subopción de la biblioteca; una letra original por vez</small></span><input type="checkbox" checked={settings.technicalSpelling} disabled={!settings.includeCommunityContent} onChange={(event) => updateSetting("technicalSpelling", event.target.checked)} /></label>
                </div>
              </section>
            </div>

            <details className="live-preview" open>
              <summary>Vista previa y controles del overlay</summary>
              <div className="overlay-control-row">
                <label>Posición<select value={settings.captionPosition} onChange={(event) => updateSetting("captionPosition", event.target.value as AppSettings["captionPosition"])}><option value={CAPTION_POSITION.TOP}>Arriba</option><option value={CAPTION_POSITION.BOTTOM}>Abajo</option><option value={CAPTION_POSITION.FLOATING}>Flotante</option></select></label>
                <label>Tamaño <output>{settings.fontSize} px</output><input type="range" min="28" max="72" step="2" value={settings.fontSize} onChange={(event) => updateSetting("fontSize", Number(event.target.value))} /></label>
                <label>Ancho <output>{settings.captionWidth} px</output><input type="range" min="560" max="1200" step="20" value={settings.captionWidth} onChange={(event) => updateSetting("captionWidth", Number(event.target.value))} /></label>
                {settings.captionPosition === CAPTION_POSITION.FLOATING && <label>Altura flotante <output>{Math.round(settings.captionFloatingY * 100)}%</output><input type="range" min="0.15" max="0.85" step="0.05" value={settings.captionFloatingY} onChange={(event) => updateSetting("captionFloatingY", Number(event.target.value))} /></label>}
              </div>
              <div className={`caption-box caption-box-compact ${settings.showVisualSupport && visualMedia.activeMedia ? "caption-box-with-media" : ""}`} aria-live="polite" aria-atomic="true" data-active-media={visualMedia.activeMedia?.entry.id ?? ""}>
                <div className="caption-copy"><p className="caption-preview-meta"><span>{livePartial ? "Procesando" : confirmedPhrase ? "Frase confirmada" : "Escuchando"}</span><span>Local · {microphone.devices.find((device) => device.deviceId === microphone.selectedDeviceId)?.label ?? "Micrófono predeterminado"}</span></p><p className="final-caption">{displayText || "Los subtítulos aparecerán aquí cuando inicie la escucha."}</p></div>
                {settings.showVisualSupport && visualMedia.activeMedia && <div className="caption-media"><VisualMedia entry={visualMedia.activeMedia.entry} mediaUrl={visualMedia.activeMedia.mediaUrl} playbackKey={visualMedia.activeMedia.playbackKey} playbackRate={settings.clipSpeed} compact onError={visualMedia.setMediaError} badgeLabel={visualMedia.activeMedia.badgeLabel} /></div>}
              </div>
              {visualMedia.activeMedia && <div className="visual-support"><p>Apoyo activo por “{visualMedia.activeMedia.match.term}”.</p><div className="active-media-actions"><button className="secondary" onClick={visualMedia.repeatActive}>Repetir</button><button className="secondary" aria-pressed={visualMedia.activeMedia.held} onClick={visualMedia.toggleHold}>{visualMedia.activeMedia.held ? "Liberar" : "Mantener"}</button><button className="secondary" onClick={visualMedia.clearActive}>Ocultar</button></div></div>}
              <details className="session-diagnostics"><summary>Detalles de diagnóstico</summary><p>Audio enviado: {(sidecarStatus.audioSentMs / 1000).toFixed(1)} s · cola actual: {sidecarStatus.audioPendingMs} ms · cola máxima: {sidecarStatus.maximumQueueMs} ms · drops: {sidecarStatus.audioOverflows} · primer parcial: {sidecarStatus.firstPartialLatencyMs ?? "sin medir"} ms · endpoint a final: {sidecarStatus.endpointFinalLatencyMs ?? "sin medir"} ms · CPU sidecar: {sidecarStatus.cpuTimeMs ?? "sin medir"} ms · endpointing: {sidecarStatus.endpointingMessage}</p></details>
            </details>
            {(microphone.error || listeningState === LISTENING_STATE.ERROR) && <p className="error-message" role="alert">{microphone.error || notice}</p>}
            {sidecarStatus.audioOverflows > 0 && <p className="error-message" role="alert">El equipo no procesa el audio en tiempo real</p>}
            <p className="exact-notice">Proyecto académico SENA. Los subtítulos automáticos pueden contener errores; el apoyo visual no es una traducción completa a LSC.</p>
          </section>
        )}

        {tab === TAB.HISTORY && (
          <section className="page-section" aria-labelledby="history-title">
            <div className="section-heading"><div><p className="eyebrow">SESIÓN ACTUAL</p><h1 id="history-title">Historial de transcripción</h1><p>Solo existe en memoria hasta que usted decide exportarlo.</p></div><div className="button-row"><button className="secondary" onClick={() => void exportTranscript("txt")}>Exportar TXT</button><button className="secondary" onClick={() => void exportTranscript("json")}>Exportar JSON</button><button className="danger" onClick={() => { dispatch({ type: TRANSCRIPT_ACTION.CLEAR }); setNotice("Historial eliminado de la memoria de la aplicación."); }}>Limpiar</button></div></div>
            {entries.length === 0 ? <div className="empty-state"><strong>Aún no hay transcripción</strong><p>Inicie una escucha real o una demostración para ver entradas con hora.</p></div> : (
              <ol className="history-list">{entries.map((entry) => <li key={entry.id}><time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString("es-CO")}</time><p>{entry.text}</p><span>{entry.source === "demo" ? "DEMOSTRACIÓN" : "RECONOCIMIENTO LOCAL"}</span></li>)}</ol>
            )}
          </section>
        )}

        {tab === TAB.LIBRARY && (
          <section className="page-section" aria-labelledby="library-title">
              <div className="section-heading"><div><p className="eyebrow">BIBLIOTECA UNIFICADA</p><h1 id="library-title">Biblioteca LSC</h1><p>Un concepto, un video canónico. Cada detalle conserva fuente, licencia y procedencia.</p></div></div>
            <VisualLibrary entries={visualMedia.entries} status={visualMedia.libraryStatus} loading={visualMedia.loading} playbackRate={settings.clipSpeed} onChanged={visualMedia.refreshLibrary} onShow={(entry) => { visualMedia.showManual(entry); setTab(TAB.LIVE); setNotice(`Previsualización manual: ${entry.label}.`); setNoticeIsError(false); }} onNotice={(message, error) => { setNotice(message); setNoticeIsError(error); }} />
          </section>
        )}

        {tab === TAB.SETTINGS && (
          <section className="page-section settings-page" aria-labelledby="settings-title">
              <div className="section-heading"><div><p className="eyebrow">PREFERENCIAS LOCALES</p><h1 id="settings-title">Lectura y comportamiento</h1><p>Se guardan en este equipo. No contienen audio ni transcripciones.</p></div><button className="secondary" onClick={() => setSettings(DEFAULT_SETTINGS)}>Restablecer</button></div>
            <div className="settings-grid">
               <label>Tamaño del subtítulo <output>{settings.fontSize} px</output><input type="range" min="28" max="72" step="2" value={settings.fontSize} onChange={(event: ChangeEvent<HTMLInputElement>) => updateSetting("fontSize", Number(event.target.value))} /></label>
               <label>Posición de la barra<select value={settings.captionPosition} onChange={(event) => updateSetting("captionPosition", event.target.value as AppSettings["captionPosition"])}><option value={CAPTION_POSITION.TOP}>Arriba</option><option value={CAPTION_POSITION.BOTTOM}>Abajo</option><option value={CAPTION_POSITION.FLOATING}>Flotante</option></select></label>
               <label>Ancho compacto <output>{settings.captionWidth} px</output><input type="range" min="560" max="1200" step="20" value={settings.captionWidth} onChange={(event) => updateSetting("captionWidth", Number(event.target.value))} /></label>
               <label>Alto compacto <output>{settings.captionHeight} px</output><input type="range" min="104" max="180" step="4" value={settings.captionHeight} onChange={(event) => updateSetting("captionHeight", Number(event.target.value))} /></label>
               {settings.captionPosition === CAPTION_POSITION.FLOATING && <label>Altura flotante <output>{Math.round(settings.captionFloatingY * 100)}%</output><input type="range" min="0.15" max="0.85" step="0.05" value={settings.captionFloatingY} onChange={(event) => updateSetting("captionFloatingY", Number(event.target.value))} /></label>}
               <label>Velocidad de clips <output>{settings.clipSpeed.toFixed(2)}×</output><input type="range" min="0.5" max="1.5" step="0.25" value={settings.clipSpeed} onChange={(event) => updateSetting("clipSpeed", Number(event.target.value))} /></label>
               <label>Duración del apoyo visual <output>{settings.visualDurationMs / 1000} s</output><input type="range" min="8000" max="12000" step="1000" value={settings.visualDurationMs} onChange={(event) => updateSetting("visualDurationMs", Number(event.target.value))} /></label>
              <label className="check-row"><input type="checkbox" checked={settings.highContrast} onChange={(event) => updateSetting("highContrast", event.target.checked)} /> Alto contraste</label>
               <label className="check-row"><input type="checkbox" checked={settings.showVisualSupport} onChange={(event) => updateSetting("showVisualSupport", event.target.checked)} /> Mostrar apoyo visual</label>
                  <label>Perfil de reconocimiento<select value={settings.asrProfile} onChange={(event) => updateSetting("asrProfile", event.target.value as AppSettings["asrProfile"])}><option value={ASR_PROFILE.LIGHT}>Rápido, incluido y recomendado</option><option value={ASR_PROFILE.PRECISE}>Preciso, modelo grande opcional</option></select><span>Preciso puede cargar lentamente; si no está instalado, la app informa el fallback a Rápido</span></label>
              <label className="check-row"><input type="checkbox" checked={residentPreferences.captionsVisible} onChange={(event) => void updateResidentPreference("captionsVisible", event.target.checked)} /> Mostrar subtítulos residentes</label>
              <label className="check-row"><input type="checkbox" checked={residentPreferences.visualSupportVisible} onChange={(event) => void updateResidentPreference("visualSupportVisible", event.target.checked)} /> Mostrar apoyo visual residente</label>
              {launchAtLoginAvailable && <label className="check-row"><input type="checkbox" checked={residentPreferences.launchAtLogin} onChange={(event) => void updateResidentPreference("launchAtLogin", event.target.checked)} /> Iniciar con Windows <span>no inicia el micrófono</span></label>}
                <label className="check-row"><input type="checkbox" checked={settings.unifiedLscLibrary} onChange={(event) => event.target.checked ? void activateUnifiedLibrary() : updateSetting("unifiedLscLibrary", false)} /> Biblioteca LSC <span>52 conceptos académicos canónicos</span></label>
                <label className="check-row"><input type="checkbox" checked={settings.includeCommunityContent} disabled={!settings.unifiedLscLibrary} onChange={(event) => event.target.checked ? void activateCommunityContent() : updateSetting("includeCommunityContent", false)} /> Incluir contenido comunitario no comercial <span>129 originales intactos</span></label>
                <label className="check-row"><input type="checkbox" checked={settings.technicalSpelling} disabled={!settings.includeCommunityContent} onChange={(event) => updateSetting("technicalSpelling", event.target.checked)} /> Habilitar deletreo técnico <span>Reproduce una letra original a la vez</span></label>
             </div>
            <div className="microphone-settings">
              <div><p className="eyebrow">MICRÓFONO</p><h2>Elegir y probar entrada</h2><p>La prueba dura cuatro segundos, no guarda audio y no inicia Vosk.</p></div>
              <label htmlFor="settings-microphone">Dispositivo<select id="settings-microphone" value={microphone.selectedDeviceId} onFocus={() => void microphone.refreshDevices(true)} onChange={(event) => microphone.setSelectedDeviceId(event.target.value)} disabled={isActive || microphone.testing}>{microphone.devices.length === 0 && <option value="default">Elegir micrófono</option>}{microphone.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
              <div className="microphone-test"><meter min="0" max="1" value={microphone.level} aria-label={`Nivel ${Math.round(microphone.level * 100)} por ciento`} /><button className="secondary" onClick={() => void microphone.refreshDevices(true)} disabled={microphone.testing}>Actualizar micrófonos</button><button className="primary" onClick={() => void microphone.test()} disabled={isActive || microphone.testing}>{microphone.testing ? "Probando..." : "Probar micrófono"}</button></div>
              <p className={microphone.error ? "error-message" : "status-detail"} role={microphone.error ? "alert" : "status"}>{microphone.message}</p>
            </div>
            {!settings.unifiedLscLibrary && <div className="settings-alert" role="status"><strong>La Biblioteca LSC está desactivada.</strong><p>Se activa como una sola biblioteca y solo reacciona ante texto final.</p><button className="primary" onClick={() => void activateUnifiedLibrary()}>Activar Biblioteca LSC</button></div>}
            {!settings.includeCommunityContent && <div className="settings-alert" role="status"><strong>El contenido comunitario no comercial está excluido.</strong><p>Puede incluirlo aceptando que su licencia prohíbe uso comercial y obras derivadas.</p><button className="primary" onClick={() => void activateCommunityContent()}>Incluir contenido comunitario</button></div>}
            <p className="match-diagnostic">Biblioteca LSC: {settings.unifiedLscLibrary ? "activa" : "inactiva"} · Contenido comunitario: {settings.includeCommunityContent ? "incluido" : "excluido"} · Deletreo: {settings.technicalSpelling ? "activo" : "inactivo"} · Diagnóstico: {visualMedia.diagnosis}</p>
            <div className="caption-preview" style={{ fontSize: settings.fontSize }}>Vista previa de subtítulos legibles.</div>
          </section>
        )}
      </main>
      <footer className="app-footer" aria-live={noticeIsError ? "assertive" : "polite"} role={noticeIsError ? "alert" : "status"}><span>{notice}</span><button onClick={() => { setNotice("La transcripción se procesa localmente y no se guarda automáticamente."); setNoticeIsError(false); }} aria-label="Cerrar mensaje">×</button></footer>
    </div>
  );
}
