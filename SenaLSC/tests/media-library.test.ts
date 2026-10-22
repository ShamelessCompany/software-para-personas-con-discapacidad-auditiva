import { mkdtemp, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IMAGE_LIMIT_BYTES, MediaLibrary, inspectImportFile } from "../src/main/media-library";
import { MEDIA_STATUS, type VisualMediaDraft } from "../src/shared/types";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "senalsc-media-"));
  roots.push(value);
  await mkdir(join(value, "bundled"), { recursive: true });
  return value;
}

function draft(): VisualMediaDraft {
  return {
    label: "Imagen propia",
    phrases: ["frase propia"],
    keywords: ["propia"],
    context: "Aula",
    region: "Bogotá",
    status: MEDIA_STATUS.PENDING,
    validators: [],
    validationNotes: "",
    license: "",
    authorizationReference: "",
    altText: "Cuadro de color usado como prueba",
  };
}

function png(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("inspección segura de medios", () => {
  it("acepta extensión y firma permitidas", async () => {
    const directory = await root();
    const file = join(directory, "imagen.png");
    await writeFile(file, png());
    expect(await inspectImportFile(file)).toMatchObject({ mimeType: "image/png", kind: "image" });
  });

  it("rechaza extensión, firma MIME y tamaño", async () => {
    const directory = await root();
    const executable = join(directory, "archivo.exe");
    const fakePng = join(directory, "falso.png");
    const largePng = join(directory, "grande.png");
    await writeFile(executable, png());
    await writeFile(fakePng, Buffer.from("no es png"));
    await writeFile(largePng, png());
    await truncate(largePng, IMAGE_LIMIT_BYTES + 1);
    await expect(inspectImportFile(executable)).rejects.toThrow("Formato no permitido");
    await expect(inspectImportFile(fakePng)).rejects.toThrow("firma");
    await expect(inspectImportFile(largePng)).rejects.toThrow("15 MB");
  });

  it.runIf(process.platform !== "win32")("rechaza enlaces simbólicos", async () => {
    const directory = await root();
    const target = join(directory, "real.png");
    const link = join(directory, "enlace.png");
    await writeFile(target, png());
    await symlink(target, link);
    await expect(inspectImportFile(link)).rejects.toThrow("enlaces simbólicos");
  });
});

describe("persistencia y borrado", () => {
  it("persiste atómicamente y recarga los metadatos", async () => {
    const directory = await root();
    const source = join(directory, "imagen.png");
    await writeFile(source, png());
    const paths = { dataDirectory: join(directory, "data"), bundledDirectory: join(directory, "bundled") };
    const library = new MediaLibrary(paths, false);
    const imported = await library.import(source, draft());
    const files = await readdir(paths.dataDirectory);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    const document = JSON.parse(await readFile(join(paths.dataDirectory, "media-library.json"), "utf8")) as { version: number; importedEntries: unknown[] };
    expect(document.version).toBe(1);
    expect(document.importedEntries).toHaveLength(1);
    const reloaded = new MediaLibrary(paths, false);
    expect((await reloaded.list()).entries.some((entry) => entry.id === imported.id)).toBe(true);
  });

  it("elimina solo el archivo administrado de una entrada imported", async () => {
    const directory = await root();
    const source = join(directory, "imagen.png");
    await writeFile(source, png());
    const paths = { dataDirectory: join(directory, "data"), bundledDirectory: join(directory, "bundled") };
    const library = new MediaLibrary(paths, false);
    const imported = await library.import(source, draft());
    expect(await library.resolve(imported.id)).not.toBeNull();
    await library.delete(imported.id);
    expect(await library.resolve(imported.id)).toBeNull();
    expect(await readFile(source)).toEqual(png());
    await expect(library.delete("lsc50-0001")).rejects.toThrow("Solo se pueden eliminar");
  });

  it("resuelve únicamente IDs registrados y bloquea un symlink sustituido", async () => {
    const directory = await root();
    const source = join(directory, "imagen.png");
    await writeFile(source, png());
    const paths = { dataDirectory: join(directory, "data"), bundledDirectory: join(directory, "bundled") };
    const library = new MediaLibrary(paths, false);
    const imported = await library.import(source, draft());
    expect(await library.resolve("../secreto")).toBeNull();
    if (process.platform !== "win32") {
      const resolved = await library.resolve(imported.id);
      expect(resolved).not.toBeNull();
      if (resolved) {
        await rm(resolved.path);
        await symlink(source, resolved.path);
        expect(await library.resolve(imported.id)).toBeNull();
      }
    }
  });

  it("conserva importaciones antiguas como pendientes al retirar el estado visual obsoleto", async () => {
    const directory = await root();
    const dataDirectory = join(directory, "data");
    await mkdir(join(dataDirectory, "media"), { recursive: true });
    const legacyEntry = {
      id: "imported-antigua",
      label: "Medio importado",
      phrases: ["frase propia"],
      keywords: [],
      context: "Aula",
      region: "Bogotá",
      status: "demo",
      validation: { validators: [], notes: "", validatedAt: null },
      authorization: { license: "", authorizationReference: "" },
      media: { kind: "image", source: "imported", uri: "antigua.png", mimeType: "image/png", altText: "Medio importado" },
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await writeFile(join(dataDirectory, "media-library.json"), JSON.stringify({ version: 1, importedEntries: [legacyEntry], bundledEnabled: {} }));
    const library = new MediaLibrary({ dataDirectory, bundledDirectory: join(directory, "bundled") }, false);
    expect((await library.list()).entries.find((entry) => entry.id === legacyEntry.id)?.status).toBe(MEDIA_STATUS.PENDING);
  });
});
