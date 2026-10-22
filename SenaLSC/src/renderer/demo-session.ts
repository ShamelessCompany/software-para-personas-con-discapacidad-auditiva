interface DemoTimerApi {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void;
  setInterval: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearInterval: (interval: ReturnType<typeof setInterval>) => void;
}

interface DemoSessionHandlers {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
}

const DEFAULT_TIMERS: DemoTimerApi = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timeout) => globalThis.clearTimeout(timeout),
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (interval) => globalThis.clearInterval(interval),
};

export class DemoSession {
  private generation = 0;
  private index = 0;
  private active = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly phrases: readonly string[],
    private readonly handlers: DemoSessionHandlers,
    private readonly timers: DemoTimerApi = DEFAULT_TIMERS,
    private readonly intervalMs = 5_000,
    private readonly finalDelayMs = 900,
  ) {}

  start(): void {
    this.cancel();
    this.active = true;
    const generation = this.generation;
    this.runPhrase(generation);
    this.interval = this.timers.setInterval(() => this.runPhrase(generation), this.intervalMs);
  }

  pause(): void {
    this.clearTimers();
  }

  resume(): void {
    if (!this.active || this.interval) return;
    const generation = this.generation;
    this.runPhrase(generation);
    this.interval = this.timers.setInterval(() => this.runPhrase(generation), this.intervalMs);
  }

  cancel(): void {
    this.generation += 1;
    this.active = false;
    this.clearTimers();
  }

  private runPhrase(generation: number): void {
    if (!this.active || generation !== this.generation || this.phrases.length === 0) return;
    const phrase = this.phrases[this.index % this.phrases.length] ?? "";
    this.index += 1;
    this.handlers.onPartial(phrase.slice(0, Math.max(10, Math.floor(phrase.length * 0.55))));
    const timeout = this.timers.setTimeout(() => {
      this.pending.delete(timeout);
      if (this.active && generation === this.generation) this.handlers.onFinal(phrase);
    }, this.finalDelayMs);
    this.pending.add(timeout);
  }

  private clearTimers(): void {
    if (this.interval) this.timers.clearInterval(this.interval);
    this.interval = null;
    for (const timeout of this.pending) this.timers.clearTimeout(timeout);
    this.pending.clear();
  }
}
