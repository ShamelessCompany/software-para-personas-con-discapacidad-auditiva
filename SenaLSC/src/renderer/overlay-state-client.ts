import type { OverlayState, SenaLscApi } from "../shared/types";

type OverlayStateApi = Pick<SenaLscApi, "getOverlayState" | "onOverlayState">;

export function connectOverlayState(api: OverlayStateApi, listener: (state: OverlayState) => void): () => void {
  let active = true;
  let receivedEvent = false;
  const unsubscribe = api.onOverlayState((state) => {
    receivedEvent = true;
    if (active) listener(state);
  });
  void api.getOverlayState().then((state) => {
    if (active && !receivedEvent && state) listener(state);
  }).catch(() => undefined);
  return () => {
    active = false;
    unsubscribe();
  };
}
