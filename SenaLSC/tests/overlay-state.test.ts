import { describe, expect, it, vi } from "vitest";
import { OverlayStateCache } from "../src/main/overlay-state";
import { connectOverlayState } from "../src/renderer/overlay-state-client";
import { IPC_CHANNEL } from "../src/shared/channels";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import type { OverlayState } from "../src/shared/types";

function state(partial: string, demoMode = false): OverlayState {
  return {
    livePartial: partial,
    confirmedPhrase: null,
    confirmedExpiresAt: null,
    demoMode,
    contentSource: demoMode ? "demo" : "asr",
    listeningState: "listening",
    microphoneLabel: "Micrófono de prueba",
    settings: DEFAULT_SETTINGS,
    activeMedia: null,
    mediaError: null,
  };
}

describe("contrato de estado del overlay", () => {
  it("expone el canal invoke para recuperar la última instantánea", () => {
    expect(IPC_CHANNEL.OVERLAY_GET_STATE).toBe("overlay:get-state");
  });

  it("entrega a una ventana recién abierta el estado que ya existía", () => {
    const snapshot = state("estado existente");
    const cache = new OverlayStateCache();
    cache.update(snapshot);
    expect(cache.current()).toBe(snapshot);
  });

  it("registra el listener antes de pedir el snapshot existente", async () => {
    const snapshot = state("estado existente", true);
    let subscribed = false;
    const received: OverlayState[] = [];
    connectOverlayState({
      onOverlayState: () => {
        subscribed = true;
        return () => undefined;
      },
      getOverlayState: () => {
        expect(subscribed).toBe(true);
        return Promise.resolve(snapshot);
      },
    }, (current) => received.push(current));

    await vi.waitFor(() => expect(received).toEqual([snapshot]));
  });

  it("conserva la instantánea completa con URL y playbackKey", () => {
    const entry = {
      id: "lsc50-0001",
      label: "Buenos días",
      phrases: ["Buenos días"],
      keywords: [],
      context: "Aula",
      region: "Sin variante",
      status: "academic" as const,
      validation: { validators: [], notes: "Fuente académica", validatedAt: null },
      authorization: { license: "CC BY 4.0", authorizationReference: "10.6084/m9.figshare.27383016.v1" },
      media: { kind: "video" as const, source: "bundled" as const, uri: "lsc50/0001-buenos-dias.mp4", mimeType: "video/mp4", altText: "Signo aislado Buenos días" },
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const mediaUrl = "senalsc-media://media/lsc50-0001";
    const snapshot: OverlayState = { ...state(""), activeMedia: { entry, mediaUrl, playlist: [{ entry, mediaUrl }], playlistIndex: 0, presentationText: "Buenos días", badgeLabel: null, match: { kind: "exact-phrase", term: "Buenos días", recognizedText: "Buenos días", isFinal: true }, playbackKey: 4, activatedAt: 100, expiresAt: 10_100, held: false } };
    const cache = new OverlayStateCache();
    cache.update(snapshot);
    expect(cache.current()?.activeMedia?.playbackKey).toBe(4);
    expect(cache.current()?.activeMedia?.mediaUrl).toBe("senalsc-media://media/lsc50-0001");
  });
});
