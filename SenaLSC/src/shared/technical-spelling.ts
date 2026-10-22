import { normalizeText } from "./matcher";

export interface TechnicalTerm {
  label: string;
  spelling: string;
  aliases: readonly string[];
}

export interface TechnicalTermMatch extends TechnicalTerm {
  matchedText: string;
}

function term(label: string, spelling = normalizeText(label).replaceAll(" ", ""), aliases: readonly string[] = []): TechnicalTerm {
  return { label, spelling, aliases: [label, ...aliases] };
}

export const TECHNICAL_TERMS: readonly TechnicalTerm[] = [
  term("Python"), term("JavaScript", "javascript", ["java script"]), term("TypeScript", "typescript", ["type script"]),
  term("Java"), term("HTML"), term("CSS"), term("SQL"), term("Git"), term("GitHub", "github", ["git hub"]),
  term("API"), term("JSON"), term("React"), term("Angular"), term("Node", "node", ["node js", "nodejs"]),
  term("Docker"), term("Linux"), term("Windows"), term("variable"), term("función"), term("clase"),
  term("objeto"), term("arreglo"), term("compilador"), term("servidor"), term("base de datos", "basededatos"),
  term("error"), term("prueba"), term("código"), term("programa"), term("algoritmo"),
  term("C Sharp", "csharp", ["c sharp", "csharp"]), term("C Plus Plus", "cplusplus", ["c plus plus", "cplusplus"]),
];

const MATCHERS = TECHNICAL_TERMS.flatMap((item) => item.aliases.map((alias) => ({ item, alias: normalizeText(alias) })))
  .sort((left, right) => right.alias.length - left.alias.length);

export function matchTechnicalTerm(text: string): TechnicalTermMatch | null {
  const normalized = normalizeText(text);
  const match = MATCHERS.find(({ alias }) => ` ${normalized} `.includes(` ${alias} `));
  if (!match || !/^[a-z0-9ñ]+$/u.test(match.item.spelling)) return null;
  return { ...match.item, matchedText: match.alias };
}

export function missingSpellingCharacters(spelling: string, available: ReadonlySet<string>): string[] {
  return [...new Set([...spelling.toLocaleLowerCase("es-CO")].filter((character) => !available.has(character)))];
}

export class TechnicalSpellingController {
  private sessionKey: string | null = null;
  private lastTerm = "";
  private lastTriggeredAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly cooldownMs = 5_000) {}

  setSession(sessionKey: string): void {
    this.sessionKey = sessionKey;
    this.lastTerm = "";
    this.lastTriggeredAt = Number.NEGATIVE_INFINITY;
  }

  clear(): void {
    this.sessionKey = null;
  }

  update(text: string, isFinal: boolean, sessionKey: string, now: number): TechnicalTermMatch | null {
    if (!isFinal || sessionKey !== this.sessionKey) return null;
    const match = matchTechnicalTerm(text);
    if (!match) return null;
    if (match.spelling === this.lastTerm && now - this.lastTriggeredAt < this.cooldownMs) return null;
    this.lastTerm = match.spelling;
    this.lastTriggeredAt = now;
    return match;
  }
}
