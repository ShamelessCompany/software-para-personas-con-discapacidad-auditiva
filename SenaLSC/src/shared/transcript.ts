import type { TranscriptEntry } from "./types";

export const TRANSCRIPT_ACTION = {
  ADD_FINAL: "add-final",
  CLEAR: "clear",
} as const;

interface AddFinalAction {
  type: typeof TRANSCRIPT_ACTION.ADD_FINAL;
  entry: TranscriptEntry;
}

interface ClearAction {
  type: typeof TRANSCRIPT_ACTION.CLEAR;
}

export type TranscriptAction = AddFinalAction | ClearAction;

export function transcriptReducer(state: TranscriptEntry[], action: TranscriptAction): TranscriptEntry[] {
  if (action.type === TRANSCRIPT_ACTION.CLEAR) return [];
  const text = action.entry.text.trim();
  if (!text) return state;
  return [...state, { ...action.entry, text }];
}

export function formatTranscriptText(entries: TranscriptEntry[]): string {
  return entries.map((entry) => {
    const source = entry.source === "demo" ? "DEMOSTRACIÓN" : "RECONOCIMIENTO LOCAL";
    return `[${new Date(entry.timestamp).toLocaleTimeString("es-CO")}] [${source}] ${entry.text}`;
  }).join("\n");
}
