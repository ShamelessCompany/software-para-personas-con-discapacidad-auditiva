import { useEffect, useRef, useState } from "react";
import { MEDIA_KIND, MEDIA_STATUS, type VisualLibraryEntry } from "../../shared/types";

interface VisualMediaProps {
  entry: VisualLibraryEntry;
  mediaUrl: string;
  playbackKey: number;
  playbackRate: number;
  compact?: boolean;
  passive?: boolean;
  onError?: (message: string | null) => void;
  onEnded?: () => void;
  badgeLabel?: string | null;
}

export function mediaErrorMessage(entry: VisualLibraryEntry): string {
  return entry.media.kind === MEDIA_KIND.VIDEO
    ? "El clip no pudo reproducirse. Puede faltar soporte para su códec."
    : "La imagen no pudo mostrarse.";
}

export function mediaStatusLabel(entry: VisualLibraryEntry): string {
  if (entry.status === MEDIA_STATUS.VALIDATED) return "LSC VALIDADO";
  if (entry.status === MEDIA_STATUS.ACADEMIC) return entry.id.startsWith("univalle-") ? "FUENTE ACADÉMICA · UNIVALLE" : "FUENTE ACADÉMICA · LSC50";
  if (entry.status === MEDIA_STATUS.COMMUNITY) return "LSC COMUNITARIA · EXPRESA";
  return "PENDIENTE";
}

export function VisualMedia({ entry, mediaUrl, playbackKey, playbackRate, compact = false, passive = false, onError, onEnded, badgeLabel = null }: VisualMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pausedState, setPausedState] = useState({ playbackKey, paused: false });
  const [errorState, setErrorState] = useState<{ playbackKey: number; message: string } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === "visible");
  const motionPaused = reducedMotion || !documentVisible;
  const paused = pausedState.playbackKey === playbackKey ? pausedState.paused : motionPaused;
  const error = errorState?.playbackKey === playbackKey ? errorState.message : null;
  const effectivePlaybackRate = entry.status === MEDIA_STATUS.COMMUNITY ? 1 : playbackRate;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const update = (): void => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = effectivePlaybackRate;
    video.currentTime = 0;
    if (motionPaused) {
      video.pause();
      return;
    }
    void video.play().catch(() => setPausedState({ playbackKey, paused: true }));
  }, [effectivePlaybackRate, mediaUrl, motionPaused, playbackKey]);

  const reportLoaded = (): void => {
    setErrorState(null);
    onError?.(null);
  };

  const reportError = (): void => {
    const message = mediaErrorMessage(entry);
    setErrorState({ playbackKey, message });
    onError?.(message);
  };

  const replay = (): void => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.playbackRate = effectivePlaybackRate;
    setPausedState({ playbackKey, paused: false });
    void video.play().catch(reportError);
  };

  const togglePause = (): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setPausedState({ playbackKey, paused: false });
      void video.play().catch(reportError);
    } else {
      video.pause();
      setPausedState({ playbackKey, paused: true });
    }
  };

  return (
    <figure className={`visual-media ${compact ? "visual-media-compact" : ""} ${passive ? "visual-media-passive" : ""}`} data-media-id={entry.id}>
      <div className="visual-media-frame">
        {entry.media.kind === MEDIA_KIND.IMAGE ? (
          <img src={mediaUrl} alt={entry.media.altText} onLoad={reportLoaded} onError={reportError} />
        ) : (
          <video
            ref={videoRef}
            key={`${entry.id}:${playbackKey}`}
            src={mediaUrl}
            aria-label={entry.media.altText}
            autoPlay={!motionPaused}
            muted
            playsInline
            preload="metadata"
            onLoadedData={reportLoaded}
            onError={reportError}
            onEnded={() => { setPausedState({ playbackKey, paused: true }); onEnded?.(); }}
          />
        )}
      </div>
      <figcaption>
        <span className={`status-tag status-${entry.status}`}>{badgeLabel ?? mediaStatusLabel(entry)}</span>
        {entry.status === MEDIA_STATUS.COMMUNITY && <span className="non-commercial-tag">NO COMERCIAL</span>}
        <strong>{entry.label}</strong>
        {entry.media.kind === MEDIA_KIND.VIDEO && !passive && (
          <span className="media-controls">
            <button type="button" className="media-control" onClick={togglePause}>{paused ? "Reproducir" : "Pausar"}</button>
            <button type="button" className="media-control" onClick={replay}>Repetir</button>
          </span>
        )}
        {error && <span className="media-error" role="alert">{error}</span>}
      </figcaption>
    </figure>
  );
}
