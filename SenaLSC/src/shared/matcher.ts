import { MEDIA_MATCH_KIND, MEDIA_STATUS, type MediaMatchKind, type MediaMatchReason, type VisualLibraryEntry } from "./types";
import { canonicalLscKey } from "./unified-lsc-catalog";

export interface MediaMatchOptions {
  unifiedLscLibrary?: boolean;
  includeCommunityContent?: boolean;
  isFinal: boolean;
}

export interface VisualMediaMatch {
  entry: VisualLibraryEntry;
  reason: MediaMatchReason;
  score: number;
}

export interface VisualMatchInput extends MediaMatchOptions {
  text: string;
  sessionKey: string;
  now: number;
}

interface PendingPartial {
  entryId: string;
  firstSeenAt: number;
}

const MATCH_SCORE: Record<MediaMatchKind, number> = {
  [MEDIA_MATCH_KIND.EXACT_PHRASE]: 30_000,
  [MEDIA_MATCH_KIND.PHRASE]: 20_000,
  [MEDIA_MATCH_KIND.KEYWORD]: 10_000,
  [MEDIA_MATCH_KIND.MANUAL]: 0,
  [MEDIA_MATCH_KIND.SPELLING]: 0,
};

const EXACT_ONLY_ACADEMIC_TERMS = new Set(["yo", "tu", "que", "como", "bien", "mal", "poco"]);

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isEntryEligible(entry: VisualLibraryEntry, options: MediaMatchOptions): boolean {
  if (!entry.enabled || entry.status === MEDIA_STATUS.PENDING) return false;
  if (entry.status === MEDIA_STATUS.ACADEMIC) {
    return Boolean(options.unifiedLscLibrary) && options.isFinal;
  }
  if (entry.status === MEDIA_STATUS.COMMUNITY) {
    return Boolean(options.unifiedLscLibrary && options.includeCommunityContent)
      && options.isFinal
      && entry.media.source === "bundled"
      && entry.authorization.license.trim().length > 0
      && entry.authorization.authorizationReference.trim().length > 0;
  }
  return options.isFinal
    && entry.authorization.license.trim().length > 0
    && entry.authorization.authorizationReference.trim().length > 0
    && entry.validation.validators.filter((validator) => validator.trim().length > 0).length >= 2;
}

function scoreTerm(text: string, term: string, phrase: boolean): { kind: MediaMatchKind; score: number } | null {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return null;
  if (phrase && text === normalizedTerm) {
    return { kind: MEDIA_MATCH_KIND.EXACT_PHRASE, score: MATCH_SCORE[MEDIA_MATCH_KIND.EXACT_PHRASE] + normalizedTerm.length };
  }
  if (` ${text} `.includes(` ${normalizedTerm} `)) {
    const kind = phrase ? MEDIA_MATCH_KIND.PHRASE : MEDIA_MATCH_KIND.KEYWORD;
    return { kind, score: MATCH_SCORE[kind] + normalizedTerm.length };
  }
  return null;
}

function isAcademicTermContained(text: string, term: string): boolean {
  if (text === term) return true;
  if (EXACT_ONLY_ACADEMIC_TERMS.has(term)) return false;
  const distinctive = term.includes(" ") || term.length >= 6;
  return distinctive && ` ${text} `.includes(` ${term} `);
}

export function matchVisualMedia(text: string, entries: readonly VisualLibraryEntry[], options: MediaMatchOptions): VisualMediaMatch | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const matches: VisualMediaMatch[] = [];
  const canonicalEntries = new Map<string, VisualLibraryEntry>();
  const eligibleEntries: VisualLibraryEntry[] = [];

  for (const entry of entries) {
    if (!isEntryEligible(entry, options)) continue;
    if (entry.status !== MEDIA_STATUS.ACADEMIC && entry.status !== MEDIA_STATUS.COMMUNITY) {
      eligibleEntries.push(entry);
      continue;
    }
    const key = canonicalLscKey(entry.label);
    const current = canonicalEntries.get(key);
    if (!current || canonicalPriority(entry) > canonicalPriority(current)) canonicalEntries.set(key, entry);
  }
  eligibleEntries.push(...canonicalEntries.values());

  for (const entry of eligibleEntries) {
    if (entry.id.startsWith("expresa-alfabeto-")) continue;
    if (entry.status === MEDIA_STATUS.ACADEMIC || entry.status === MEDIA_STATUS.COMMUNITY) {
      for (const phrase of entry.phrases) {
        const normalizedPhrase = normalizeText(phrase);
        if (!isAcademicTermContained(normalized, normalizedPhrase)) continue;
        const exact = normalized === normalizedPhrase;
        matches.push({
          entry,
          score: MATCH_SCORE[exact ? MEDIA_MATCH_KIND.EXACT_PHRASE : MEDIA_MATCH_KIND.PHRASE]
            + normalizedPhrase.length * 100
            + (entry.id.startsWith("lsc50-") ? 10 : 0),
          reason: { kind: exact ? MEDIA_MATCH_KIND.EXACT_PHRASE : MEDIA_MATCH_KIND.PHRASE, term: phrase, recognizedText: text.trim(), isFinal: true },
        });
      }
      for (const alias of entry.keywords) {
        const normalizedAlias = normalizeText(alias);
        if (!isAcademicTermContained(normalized, normalizedAlias)) continue;
        matches.push({
          entry,
          score: MATCH_SCORE[MEDIA_MATCH_KIND.KEYWORD] + normalizedAlias.length * 100 + (entry.id.startsWith("lsc50-") ? 10 : 0),
          reason: { kind: MEDIA_MATCH_KIND.KEYWORD, term: alias, recognizedText: text.trim(), isFinal: true },
        });
      }
      continue;
    }
    for (const [term, phrase] of [...entry.phrases.map((value) => [value, true] as const), ...entry.keywords.map((value) => [value, false] as const)]) {
      const candidate = scoreTerm(normalized, term, phrase);
      if (!candidate) continue;
      matches.push({
        entry,
        score: candidate.score + (entry.status === MEDIA_STATUS.VALIDATED ? 2_000 : 0),
        reason: { kind: candidate.kind, term, recognizedText: text.trim(), isFinal: options.isFinal },
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))[0] ?? null;
}

function canonicalPriority(entry: VisualLibraryEntry): number {
  if (entry.status === MEDIA_STATUS.VALIDATED) return 4;
  if (entry.id.startsWith("lsc50-")) return 3;
  if (entry.id.startsWith("univalle-")) return 2;
  if (entry.status === MEDIA_STATUS.COMMUNITY) return 1;
  return 0;
}

export class VisualMatchController {
  private sessionKey: string | null = null;
  private pendingPartial: PendingPartial | null = null;
  private lastTriggeredId: string | null = null;
  private lastTriggeredAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly entries: () => readonly VisualLibraryEntry[],
    private readonly partialDebounceMs = 650,
    private readonly retriggerCooldownMs = 5_000,
  ) {}

  setSession(sessionKey: string): void {
    this.sessionKey = sessionKey;
    this.pendingPartial = null;
    this.lastTriggeredId = null;
    this.lastTriggeredAt = Number.NEGATIVE_INFINITY;
  }

  clear(): void {
    this.sessionKey = null;
    this.pendingPartial = null;
  }

  update(input: VisualMatchInput): VisualMediaMatch | null {
    if (input.sessionKey !== this.sessionKey) return null;
    const match = matchVisualMedia(input.text, this.entries(), input);
    if (!match) {
      this.pendingPartial = null;
      return null;
    }

    if (!input.isFinal) {
      if (this.pendingPartial?.entryId !== match.entry.id) {
        this.pendingPartial = { entryId: match.entry.id, firstSeenAt: input.now };
        return null;
      }
      if (input.now - this.pendingPartial.firstSeenAt < this.partialDebounceMs) return null;
    }

    if (this.lastTriggeredId === match.entry.id && input.now - this.lastTriggeredAt < this.retriggerCooldownMs) return null;
    this.pendingPartial = null;
    this.lastTriggeredId = match.entry.id;
    this.lastTriggeredAt = input.now;
    return match;
  }
}
