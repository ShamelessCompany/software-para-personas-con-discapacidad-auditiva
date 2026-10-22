import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoSession } from "../src/renderer/demo-session";

describe("DemoSession", () => {
  afterEach(() => vi.useRealTimers());

  it("cancela todos los finales pendientes y no emite frases tardías", () => {
    vi.useFakeTimers();
    const finals: string[] = [];
    const session = new DemoSession(["frase preparada"], { onPartial: () => undefined, onFinal: (text) => finals.push(text) });
    session.start();
    session.cancel();
    vi.advanceTimersByTime(10_000);
    expect(finals).toEqual([]);
  });

  it("invalida callbacks de una generación anterior al reiniciar", () => {
    vi.useFakeTimers();
    const finals: string[] = [];
    const session = new DemoSession(["primera", "segunda"], { onPartial: () => undefined, onFinal: (text) => finals.push(text) });
    session.start();
    session.start();
    vi.advanceTimersByTime(900);
    expect(finals).toEqual(["segunda"]);
  });
});
