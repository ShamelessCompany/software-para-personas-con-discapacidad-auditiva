import type { SenaLscApi } from "../shared/types";

declare global {
  interface Window {
    senaLsc: SenaLscApi;
  }
}

export {};
