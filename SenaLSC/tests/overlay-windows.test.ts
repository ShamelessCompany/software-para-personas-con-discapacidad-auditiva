import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("superficies residentes", () => {
  it("crea ambos overlays transparentes, sin marco, sombra, foco ni captura de clics", async () => {
    const source = await readFile("src/main/index.ts", "utf8");
    const overlaySection = source.slice(source.indexOf("async function createOverlayWindows"), source.indexOf("function positionOverlayWindows"));
    expect(overlaySection.match(/transparent: true/g)).toHaveLength(2);
    expect(overlaySection.match(/frame: false/g)).toHaveLength(2);
    expect(overlaySection.match(/focusable: false/g)).toHaveLength(2);
    expect(overlaySection.match(/skipTaskbar: true/g)).toHaveLength(2);
    expect(overlaySection.match(/hasShadow: false/g)).toHaveLength(2);
    expect(overlaySection.match(/alwaysOnTop: true/g)).toHaveLength(2);
    expect(source).toContain("setIgnoreMouseEvents(true, { forward: false })");
    expect(source).toContain("setFocusable(false)");
  });

  it("mantiene transparentes las raíces y limita el fondo discreto al medio", async () => {
    const css = await readFile("src/renderer/styles.css", "utf8");
    expect(css).toContain('html[data-surface="captions"] #root');
    expect(css).toContain('html[data-surface="visual-support"] #root');
    expect(css).toContain("background: transparent");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain(".visual-overlay-shell .visual-media-frame { width: 100%; height: 100%; min-height: 0; overflow: hidden; border: 1px solid");
    expect(css).toContain("background: oklch(12% 0.008 145 / .82)");
  });
});
