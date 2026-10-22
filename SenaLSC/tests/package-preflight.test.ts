import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseSelfTestOutput,
  validateManifest,
  validatePeX64,
} from "../scripts/preflight-win-lib.mjs";

const fixture = resolve(".tmp-preflight-test");

function peFixture(machine = 0x8664, magic = 0x20b): Buffer {
  const buffer = Buffer.alloc(64 * 1024);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\0\0", 0x80, "binary");
  buffer.writeUInt16LE(machine, 0x84);
  buffer.writeUInt16LE(0xf0, 0x94);
  buffer.writeUInt16LE(magic, 0x98);
  return buffer;
}

async function writeSyntheticSidecar(): Promise<void> {
  const buffer = peFixture();
  await mkdir(resolve(fixture, "sidecar-bin"), { recursive: true });
  await writeFile(resolve(fixture, "sidecar-bin/senalsc-asr.exe"), buffer);
  await writeFile(resolve(fixture, "sidecar-bin/senalsc-asr.manifest.json"), JSON.stringify({
    formatVersion: 2,
    file: "senalsc-asr.exe",
    platform: "win32",
    architecture: "x64",
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    selfTest: { status: "passed", protocolVersion: 1 },
  }));
}

afterEach(async () => rm(fixture, { recursive: true, force: true }));

describe("preflight del paquete Windows real", () => {
  it.runIf(process.platform !== "win32")("rechaza Linux antes de leer cualquier sidecar", async () => {
    await writeSyntheticSidecar();
    const result = spawnSync(process.execPath, [resolve("scripts/preflight-win.mjs")], { cwd: fixture, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("solo puede construirse y validarse en Windows");
    expect(result.stderr).toContain("package:win:demo");
    expect(result.stdout).not.toContain("Preflight Windows correcto");
  });
});

describe("validación estructural adicional", () => {
  it.each([
    ["vacío", Buffer.alloc(0), "demasiado pequeño"],
    ["ELF", Buffer.concat([Buffer.from("\x7fELF"), Buffer.alloc(64 * 1024)]), "cabecera DOS MZ"],
    ["PE x86", peFixture(0x14c, 0x10b), "arquitectura no es AMD64/x64"],
    ["PE corrupto", (() => { const value = peFixture(); value.write("PX\0\0", 0x80, "binary"); return value; })(), "firma PE es inválida"],
  ])("rechaza el fixture estructural %s", (_name, buffer, expected) => {
    expect(validatePeX64(buffer)).toContain(expected);
  });

  it("acepta la estructura PE x64 sin afirmar que el fixture sea ejecutable", () => {
    expect(validatePeX64(peFixture())).toBeNull();
  });

  it("valida tamaño, hash, plataforma y evidencia versionada de self-test", () => {
    const buffer = peFixture();
    const hash = createHash("sha256").update(buffer).digest("hex");
    const manifest = {
      formatVersion: 2,
      file: "senalsc-asr.exe",
      platform: "win32",
      architecture: "x64",
      size: buffer.length,
      sha256: hash,
      selfTest: { status: "passed", protocolVersion: 1 },
    };
    expect(validateManifest(manifest, buffer.length, hash)).toBe(true);
    expect(validateManifest({ ...manifest, sha256: "0".repeat(64) }, buffer.length, hash)).toBe(false);
    expect(validateManifest({ ...manifest, selfTest: { status: "passed", protocolVersion: 2 } }, buffer.length, hash)).toBe(false);
  });
});

describe("parser del self-test ASR", () => {
  const valid = '{"type":"self-test","status":"ok","protocolVersion":1,"engine":"vosk"}';

  it("acepta únicamente el JSON exacto y versionado", () => {
    expect(parseSelfTestOutput(valid)).toEqual({
      type: "self-test",
      status: "ok",
      protocolVersion: 1,
      engine: "vosk",
    });
  });

  it.each([
    ["protocolo distinto", valid.replace('"protocolVersion":1', '"protocolVersion":2')],
    ["motor distinto", valid.replace('"vosk"', '"otro"')],
    ["campo adicional", valid.replace("}", ',"extra":true}')],
    ["salida multilínea", `${valid}\n${valid}`],
    ["JSON inválido", "no-json"],
  ])("rechaza %s", (_name, output) => {
    expect(parseSelfTestOutput(output)).toBeNull();
  });
});

describe("contenido de la edición demo", () => {
  it("incluye 52 MP4 académicos canónicos, 129 originales EXPRESA y excluye recursos ASR", async () => {
    const bundledEntries = await readdir(resolve("assets/lsc"));
    const catalogEntries = await readdir(resolve("assets/lsc/lsc50"));
    expect(bundledEntries.sort()).toEqual(["README.md", "expresa", "lsc50", "unified-lsc-catalog.json", "univalle"]);
    expect(catalogEntries.filter((name) => name.endsWith(".mp4"))).toHaveLength(50);
    expect(catalogEntries.filter((name) => name.endsWith(".svg"))).toEqual([]);
    await access(resolve("assets/lsc/lsc50/manifest.json"));
    const univalleEntries = await readdir(resolve("assets/lsc/univalle"));
    expect(univalleEntries.filter((name) => name.endsWith(".mp4"))).toHaveLength(2);
    expect(univalleEntries.filter((name) => name.endsWith(".svg"))).toEqual([]);
    await access(resolve("assets/lsc/univalle/manifest.json"));
    const expresaEntries = await readdir(resolve("assets/lsc/expresa"), { recursive: true });
    expect(expresaEntries.filter((name) => name.endsWith(".mp4"))).toHaveLength(129);
    expect(expresaEntries.filter((name) => name.endsWith(".svg"))).toEqual([]);
    await access(resolve("assets/lsc/expresa/manifest.json"));
    await access(resolve("THIRD_PARTY_NOTICES.md"));
    const config = await readFile(resolve("electron-builder.demo.yml"), "utf8");
    expect(config).toContain("dist/**/*");
    expect(config).toContain("assets/lsc");
    expect(config).toContain("THIRD_PARTY_NOTICES.md");
    expect(config).not.toContain("sidecar-bin");
    expect(config).not.toContain("models");
    expect(config).not.toContain("requirements.txt");
  });
});

describe("portable Windows completo autónomo", () => {
  it("declara una sola distribución portable no-demo con runtime, modelo, medios y avisos", async () => {
    const config = await readFile(resolve("electron-builder.complete.yml"), "utf8");
    expect(config).toContain("senalscDistribution: complete-windows");
    expect(config).not.toContain("senalscDistribution: demo");
    expect(config.match(/target: portable/g)).toHaveLength(1);
    expect(config).toContain("SenaLSC-Portable-Completo-${version}-${arch}.${ext}");
    expect(config).toContain("resources/embedded-asr");
    expect(config).toContain("models/vosk-model-small-es-0.42");
    expect(config).toContain("assets/lsc");
    expect(config).toContain("THIRD_PARTY_NOTICES.md");
    expect(config).not.toMatch(/\.venv|\.ps1|requirements-build/);
  });

  it("incluye pythonw PE x64, layout Vosk/DLLs, asr.py y modelo completo", async () => {
    const runtime = resolve("resources/embedded-asr");
    const pythonw = await readFile(resolve(runtime, "pythonw.exe"));
    expect(validatePeX64(pythonw)).toBeNull();
    await expect(access(resolve(runtime, "python.exe"))).rejects.toThrow();
    for (const file of [
      "python312.dll",
      "python3.dll",
      "python312.zip",
      "python312._pth",
      "site-packages/vosk/__init__.py",
      "site-packages/vosk/libvosk.dll",
      "site-packages/vosk/libgcc_s_seh-1.dll",
      "site-packages/vosk/libstdc++-6.dll",
      "site-packages/vosk/libwinpthread-1.dll",
      "embedded-asr.manifest.json",
    ]) await access(resolve(runtime, file));
    await access(resolve("sidecar/asr.py"));
    for (const file of ["am/final.mdl", "conf/mfcc.conf", "conf/model.conf", "graph/Gr.fst", "graph/HCLr.fst", "ivector/final.dubm"]) {
      await access(resolve("models/vosk-model-small-es-0.42", file));
    }
    const manifest = JSON.parse(await readFile(resolve(runtime, "embedded-asr.manifest.json"), "utf8")) as { python: { executable: string }; engine: { name: string; version: string }; model: { files: number } };
    expect(manifest.python.executable).toBe("pythonw.exe");
    expect(manifest.engine).toMatchObject({ name: "vosk", version: "0.3.45" });
    expect(manifest.model.files).toBe(14);
  });

  it("conserva 181 MP4 canónicos, tres manifiestos, atribución y cero SVG", async () => {
    const media = await readdir(resolve("assets/lsc"), { recursive: true });
    expect(media.filter((name) => name.endsWith(".mp4"))).toHaveLength(181);
    expect(media.filter((name) => name.endsWith("manifest.json"))).toHaveLength(3);
    expect(media.filter((name) => name.endsWith(".svg"))).toHaveLength(0);
    const notices = await readFile(resolve("THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toContain("LSC50");
    expect(notices).toContain("UniValle");
    expect(notices).toContain("EXPRESA");
    const unifiedCatalog = JSON.parse(await readFile(resolve("assets/lsc/unified-lsc-catalog.json"), "utf8")) as { after: { videos: number; concepts: number; duplicateCanonicalKeys: number; orphanVideos: string[]; missingVideos: string[] }; duplicates: unknown[] };
    expect(unifiedCatalog.after).toEqual({ videos: 181, concepts: 181, duplicateCanonicalKeys: 0, orphanVideos: [], missingVideos: [] });
    expect(unifiedCatalog.duplicates).toHaveLength(9);
  });

  it("incluye el logo preservado y los iconos derivados sin SVG visuales", async () => {
    const original = await readFile(resolve("assets/brand/sena-logo-original.png"));
    expect(createHash("sha256").update(original).digest("hex")).toBe("d5c537cae2b1a2e0943874c97bddcd72e2b04c7b8cde1fcdc7a080dcfcc9c6c9");
    for (const file of ["sena-logo-ui.png", "favicon.png"]) await access(resolve("assets/brand", file));
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) await access(resolve(`assets/icons/icon-${size}.png`));
    for (const file of ["icon.ico", "icon.png", "tray-on-light.png", "tray-on-dark.png"]) await access(resolve("assets/icons", file));
    const visualFiles = [...await readdir(resolve("assets/brand")), ...await readdir(resolve("assets/icons"))];
    expect(visualFiles.filter((name) => name.endsWith(".svg"))).toEqual([]);
    const app = await readFile(resolve("src/renderer/App.tsx"), "utf8");
    expect(app).toContain('alt="Logo del SENA"');
  });

  it("declara tokens medidos, estados con texto e icono y controles críticos identificables", async () => {
    const css = await readFile(resolve("src/renderer/styles.css"), "utf8");
    const app = await readFile(resolve("src/renderer/App.tsx"), "utf8");
    expect(css).toContain("--sena-green: oklch(54.37% 0.1349 151.45)");
    expect(css).toContain("--sena-green-dark: oklch(41.84% 0.1047 151.04)");
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(app).toContain('data-testid="primary-listening-cta"');
    expect(app).toContain('data-testid="microphone-selector"');
    for (const label of ["Listo", "Solicitando permiso", "Sin micrófono", "Audio detectado", "Motor cargando", "Escuchando", "Pausado", "Requiere atención"]) expect(app).toContain(label);
    expect(app).toContain('aria-hidden="true">{operational.icon}');
  });

  it("restringe permisos a audio interno y exige selector, actualización y prueba", async () => {
    const main = await readFile(resolve("src/main/index.ts"), "utf8");
    const hook = await readFile(resolve("src/renderer/hooks/useMicrophone.ts"), "utf8");
    const app = await readFile(resolve("src/renderer/App.tsx"), "utf8");
    expect(main).toContain("setPermissionCheckHandler");
    expect(main).toContain("setPermissionRequestHandler");
    expect(main).toContain("isAllowedAudioPermission");
    expect(hook).toContain("subscribeToMicrophoneChanges");
    expect(hook).toContain("openSelectedMicrophone");
    expect(app).toContain("Actualizar micrófonos");
    expect(app).toContain("Probar micrófono");
    expect(app).toContain("Audio detectado");
  });
});
