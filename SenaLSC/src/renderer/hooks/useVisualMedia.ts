import { useEffect, useRef, useState } from "react";
import { VisualMatchController, type VisualMediaMatch } from "../../shared/matcher";
import { MEDIA_MATCH_KIND, type ActiveVisualMedia, type MediaLibraryStatus, type VisualLibraryEntry } from "../../shared/types";
import { missingSpellingCharacters, TechnicalSpellingController, type TechnicalTermMatch } from "../../shared/technical-spelling";

interface UseVisualMediaOptions {
  unifiedLscLibrary: boolean;
  includeCommunityContent: boolean;
  technicalSpelling: boolean;
  showVisualSupport: boolean;
  durationMs: number;
}

interface VisualMediaState {
  entries: VisualLibraryEntry[];
  libraryStatus: MediaLibraryStatus | null;
  activeMedia: ActiveVisualMedia | null;
  mediaError: string | null;
  loading: boolean;
  diagnosis: string;
  beginSession: (sessionKey: string) => void;
  clearSession: () => void;
  processText: (text: string, isFinal: boolean, sessionKey: string, now: number) => void;
  showManual: (entry: VisualLibraryEntry) => void;
  repeatActive: () => void;
  toggleHold: () => void;
  clearActive: () => void;
  advancePlaylist: () => void;
  setMediaError: (message: string | null) => void;
  refreshLibrary: () => Promise<void>;
}

export function useVisualMedia(options: UseVisualMediaOptions): VisualMediaState {
  const [entries, setEntries] = useState<VisualLibraryEntry[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<MediaLibraryStatus | null>(null);
  const [activeMedia, setActiveMedia] = useState<ActiveVisualMedia | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnosis, setDiagnosis] = useState("esperando frase final");
  const entriesRef = useRef<VisualLibraryEntry[]>([]);
  const sessionKeyRef = useRef<string | null>(null);
  const activationGeneration = useRef(0);
  const playbackSequence = useRef(0);
  const optionsRef = useRef(options);
  const matcherRef = useRef<VisualMatchController | null>(null);
  const spellingRef = useRef(new TechnicalSpellingController());

  useEffect(() => {
    entriesRef.current = entries;
    optionsRef.current = options;
  }, [entries, options]);

  const refreshLibrary = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await window.senaLsc.listVisualMedia();
      entriesRef.current = result.entries;
      setEntries(result.entries);
      setLibraryStatus(result.status);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    matcherRef.current = new VisualMatchController(() => entriesRef.current);
    void window.senaLsc.listVisualMedia().then((result) => {
      if (!active) return;
      entriesRef.current = result.entries;
      setEntries(result.entries);
      setLibraryStatus(result.status);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      matcherRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeMedia || activeMedia.held) return;
    const remaining = Math.max(0, activeMedia.expiresAt - Date.now());
    const timeout = window.setTimeout(() => {
      setActiveMedia((current) => current?.playbackKey === activeMedia.playbackKey ? null : current);
      setMediaError(null);
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [activeMedia]);

  const beginSession = (sessionKey: string): void => {
    activationGeneration.current += 1;
    sessionKeyRef.current = sessionKey;
    matcherRef.current?.setSession(sessionKey);
    spellingRef.current.setSession(sessionKey);
    setActiveMedia(null);
    setMediaError(null);
    setDiagnosis(optionsRef.current.unifiedLscLibrary ? "esperando frase final" : "biblioteca desactivada");
  };

  const clearSession = (): void => {
    activationGeneration.current += 1;
    sessionKeyRef.current = null;
    matcherRef.current?.clear();
    spellingRef.current.clear();
    setActiveMedia(null);
    setMediaError(null);
  };

  const activate = async (match: VisualMediaMatch, expectedSession: string | null): Promise<void> => {
    const generation = ++activationGeneration.current;
    const result = await window.senaLsc.getVisualMediaUrl({ id: match.entry.id });
    if (!result.ok || !result.url || generation !== activationGeneration.current || sessionKeyRef.current !== expectedSession) return;
    const now = Date.now();
    playbackSequence.current += 1;
    setMediaError(null);
    setActiveMedia({
      entry: match.entry,
      mediaUrl: result.url,
      playlist: [{ entry: match.entry, mediaUrl: result.url }],
      playlistIndex: 0,
      presentationText: match.reason.recognizedText,
      badgeLabel: null,
      match: match.reason,
      playbackKey: playbackSequence.current,
      activatedAt: now,
      expiresAt: now + optionsRef.current.durationMs,
      held: false,
    });
  };

  const processText = (text: string, isFinal: boolean, sessionKey: string, now: number): void => {
    if (!optionsRef.current.showVisualSupport) {
      setDiagnosis("apoyo oculto");
      return;
    }
    if (!optionsRef.current.unifiedLscLibrary) {
      setDiagnosis("biblioteca desactivada");
      return;
    }
    if (!isFinal) setDiagnosis("esperando frase final");
    const match = matcherRef.current?.update({
      text,
      isFinal,
      sessionKey,
      unifiedLscLibrary: optionsRef.current.unifiedLscLibrary,
      includeCommunityContent: optionsRef.current.includeCommunityContent,
      now,
    });
    if (match) {
      setDiagnosis(`última coincidencia: ${match.entry.label}`);
      void activate(match, sessionKey);
      return;
    }
    if (isFinal && optionsRef.current.includeCommunityContent && optionsRef.current.technicalSpelling) {
      const technical = spellingRef.current.update(text, true, sessionKey, now);
      if (technical) {
        void activateSpelling(technical, text, sessionKey);
        return;
      }
    }
    if (isFinal) setDiagnosis("sin coincidencia");
  };

  const activateSpelling = async (technical: TechnicalTermMatch, recognizedText: string, expectedSession: string): Promise<void> => {
    const alphabet = new Map(entriesRef.current.filter((entry) => entry.id.startsWith("expresa-alfabeto-")).map((entry) => [entry.label.toLocaleLowerCase("es-CO"), entry]));
    const missing = missingSpellingCharacters(technical.spelling, new Set(alphabet.keys()));
    if (missing.length > 0) {
      setDiagnosis(`deletreo no disponible; faltan: ${missing.join(", ").toLocaleUpperCase("es-CO")}`);
      return;
    }
    const generation = ++activationGeneration.current;
    const sequence = [...technical.spelling.toLocaleLowerCase("es-CO")].map((character) => alphabet.get(character)).filter((entry): entry is VisualLibraryEntry => Boolean(entry));
    const results = await Promise.all(sequence.map((entry) => window.senaLsc.getVisualMediaUrl({ id: entry.id })));
    if (generation !== activationGeneration.current || sessionKeyRef.current !== expectedSession || results.some((result) => !result.ok || !result.url)) return;
    const playlist = sequence.map((entry, index) => ({ entry, mediaUrl: results[index]?.url ?? "" }));
    const first = playlist[0];
    if (!first) return;
    const now = Date.now();
    playbackSequence.current += 1;
    setMediaError(null);
    setDiagnosis(`deletreo técnico: ${technical.label}`);
    setActiveMedia({
      entry: first.entry,
      mediaUrl: first.mediaUrl,
      playlist,
      playlistIndex: 0,
      presentationText: technical.label,
      badgeLabel: "DELETREO LSC · TÉRMINO TÉCNICO",
      match: { kind: MEDIA_MATCH_KIND.SPELLING, term: technical.label, recognizedText, isFinal: true },
      playbackKey: playbackSequence.current,
      activatedAt: now,
      expiresAt: now + Math.max(optionsRef.current.durationMs, sequence.length * 17_000),
      held: false,
    });
  };

  const showManual = (entry: VisualLibraryEntry): void => {
    void activate({
      entry,
      score: 0,
      reason: { kind: MEDIA_MATCH_KIND.MANUAL, term: "Selección manual", recognizedText: "Selección manual", isFinal: true },
    }, sessionKeyRef.current);
  };

  const repeatActive = (): void => {
    const now = Date.now();
    playbackSequence.current += 1;
    const playbackKey = playbackSequence.current;
    setActiveMedia((current) => current ? { ...current, playbackKey, activatedAt: now, expiresAt: now + optionsRef.current.durationMs } : null);
    setMediaError(null);
  };

  const toggleHold = (): void => {
    setActiveMedia((current) => current ? { ...current, held: !current.held, expiresAt: Date.now() + optionsRef.current.durationMs } : null);
  };

  const clearActive = (): void => {
    activationGeneration.current += 1;
    setActiveMedia(null);
    setMediaError(null);
  };

  const advancePlaylist = (): void => {
    setActiveMedia((current) => {
      if (!current || current.playlist.length <= 1) return current;
      const index = current.playlistIndex + 1;
      const next = current.playlist[index];
      if (!next) return null;
      playbackSequence.current += 1;
      return { ...current, entry: next.entry, mediaUrl: next.mediaUrl, playlistIndex: index, playbackKey: playbackSequence.current };
    });
  };

  return {
    entries,
    libraryStatus,
    activeMedia,
    mediaError,
    loading,
    diagnosis,
    beginSession,
    clearSession,
    processText,
    showManual,
    repeatActive,
    toggleHold,
    clearActive,
    advancePlaylist,
    setMediaError,
    refreshLibrary,
  };
}
