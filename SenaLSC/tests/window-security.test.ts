import { describe, expect, it } from "vitest";
import { isAllowedAudioPermission, isAllowedRendererUrl } from "../src/main/window-security";

describe("navegación y origen del renderer", () => {
  it("acepta solo el documento local exacto y sus overlays tipados", () => {
    const expected = "file:///opt/senalsc/dist/renderer/index.html";
    expect(isAllowedRendererUrl(expected, expected)).toBe(true);
    expect(isAllowedRendererUrl(`${expected}?captions=1`, expected)).toBe(true);
    expect(isAllowedRendererUrl(`${expected}?visual-support=1`, expected)).toBe(true);
    expect(isAllowedRendererUrl("file:///etc/passwd", expected)).toBe(false);
    expect(isAllowedRendererUrl(`${expected}?otro=1`, expected)).toBe(false);
  });

  it("compara origen y ruta de desarrollo sin startsWith", () => {
    const expected = "http://127.0.0.1:5173/";
    expect(isAllowedRendererUrl(expected, expected)).toBe(true);
    expect(isAllowedRendererUrl(`${expected}?captions=1`, expected)).toBe(true);
    expect(isAllowedRendererUrl("http://127.0.0.1:5173@evil.example/", expected)).toBe(false);
    expect(isAllowedRendererUrl("http://127.0.0.1:5173/otra", expected)).toBe(false);
    expect(isAllowedRendererUrl("https://127.0.0.1:5173/", expected)).toBe(false);
  });
});

describe("permisos de medios", () => {
  it("autoriza exclusivamente audio desde el origen interno exacto", () => {
    const packaged = "file:///opt/senalsc/dist/renderer/index.html";
    expect(isAllowedAudioPermission("media", "file://", packaged, ["audio"])).toBe(true);
    expect(isAllowedAudioPermission("media", "file://", packaged, ["audio", "video"])).toBe(false);
    expect(isAllowedAudioPermission("media", "file://", packaged, ["video"])).toBe(false);
    expect(isAllowedAudioPermission("display-capture", "file://", packaged, ["audio"])).toBe(false);
    expect(isAllowedAudioPermission("media", "https://evil.example", packaged, ["audio"])).toBe(false);
  });

  it("acepta audio del origen de desarrollo pero no de otro puerto", () => {
    const development = "http://127.0.0.1:5173/";
    expect(isAllowedAudioPermission("media", "http://127.0.0.1:5173", development, ["audio"])).toBe(true);
    expect(isAllowedAudioPermission("media", "http://127.0.0.1:5174", development, ["audio"])).toBe(false);
  });
});
