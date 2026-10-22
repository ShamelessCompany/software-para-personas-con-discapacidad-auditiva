import { useEffect, useState, type CSSProperties } from "react";
import { presentOverlay } from "../shared/overlay-presentation";
import { LISTENING_STATE, type OverlayState } from "../shared/types";
import { VisualMedia } from "./components/VisualMedia";
import { connectOverlayState } from "./overlay-state-client";

interface OverlayProps {
  kind: "captions" | "visual-support";
}

export function Overlay({ kind }: OverlayProps) {
  const [state, setState] = useState<OverlayState | null>(null);
  const [localMediaError, setLocalMediaError] = useState<string | null>(null);

  useEffect(() => connectOverlayState(window.senaLsc, setState), []);

  if (!state) return null;
  const presentation = presentOverlay(state, localMediaError);
  const captionStatus = state.activeMedia
    ? "Frase confirmada"
    : state.livePartial
    ? "Procesando"
    : presentation.finalText ? "Frase confirmada" : state.listeningState === LISTENING_STATE.PAUSED ? "Pausado" : "Escuchando";
  if (kind === "visual-support") {
    if (!state.activeMedia) return null;
    return (
      <main className="visual-overlay-shell">
        <VisualMedia
          entry={state.activeMedia.entry}
          mediaUrl={state.activeMedia.mediaUrl}
          playbackKey={state.activeMedia.playbackKey}
          playbackRate={state.settings.clipSpeed}
          compact
          passive
          onError={setLocalMediaError}
          onEnded={() => window.senaLsc.advanceOverlayPlaylist()}
          badgeLabel={state.activeMedia.badgeLabel}
        />
      </main>
    );
  }
  return (
    <main className={`caption-overlay-shell ${state.settings.highContrast ? "high-contrast" : ""}`} data-position={state.settings.captionPosition} style={{ "--caption-size": `${state.settings.fontSize}px` } as CSSProperties}>
      <div className="overlay-caption" aria-live="polite" aria-atomic="true" data-overlay-content="caption">
        <div className="overlay-caption-meta"><strong>{captionStatus}</strong><span>Local · {state.microphoneLabel}</span></div>
        <span className={!state.activeMedia && state.livePartial ? "caption-partial" : undefined}>{presentation.captionText || "Esperando voz..."}</span>
      </div>
    </main>
  );
}
