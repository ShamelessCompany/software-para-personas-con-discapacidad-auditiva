import type { OverlayState } from "../shared/types";

export class OverlayStateCache {
  private state: OverlayState | null = null;

  update(state: OverlayState): void {
    this.state = state;
  }

  current(): OverlayState | null {
    return this.state;
  }
}
