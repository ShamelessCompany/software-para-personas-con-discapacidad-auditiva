import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUNDLED_VISUAL_MEDIA } from "../shared/bundled-media";
import { MEDIA_KIND, MEDIA_SOURCE, MEDIA_STATUS, type MediaKind, type MediaLibraryListResult, type MediaLibraryStatus, type VisualLibraryEntry } from "../shared/types";
import { validateVisualLibraryEntry, validateVisualMediaDraft } from "../shared/validation";

export const IMAGE_LIMIT_BYTES = 15 * 1024 * 1024;
export const VIDEO_LIMIT_BYTES = 100 * 1024 * 1024;

interface DetectedMedia {
  extension: string;
  mimeType: string;
  kind: MediaKind;
}

interface MediaLibraryPaths {
  dataDirectory: string;
  bundledDirectory: string;
}

interface MediaLibraryDocument {
  version: 1;
  importedEntries: VisualLibraryEntry[];
  bundledEnabled: Record<string, boolean>;
}

function migratePersistedEntry(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("status" in value) || value.status !== "demo") return value;
  return { ...value, status: MEDIA_STATUS.PENDING };
}

export interface ResolvedMedia {
  path: string;
  mimeType: string;
  size: number;
}

const ALLOWED_MEDIA: Record<string, Omit<DetectedMedia, "extension">> = {
  ".png": { mimeType: "image/png", kind: MEDIA_KIND.IMAGE },
  ".jpg": { mimeType: "image/jpeg", kind: MEDIA_KIND.IMAGE },
  ".jpeg": { mimeType: "image/jpeg", kind: MEDIA_KIND.IMAGE },
  ".webp": { mimeType: "image/webp", kind: MEDIA_KIND.IMAGE },
  ".gif": { mimeType: "image/gif", kind: MEDIA_KIND.IMAGE },
  ".mp4": { mimeType: "video/mp4", kind: MEDIA_KIND.VIDEO },
  ".webm": { mimeType: "video/webm", kind: MEDIA_KIND.VIDEO },
};

function isWithin(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value.length > 0 && !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
}

function hasMagic(buffer: Buffer, extension: string): boolean {
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === ".jpg" || extension === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (extension === ".gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  if (extension === ".mp4") return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  if (extension === ".webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

export async function inspectImportFile(sourcePath: string): Promise<DetectedMedia> {
  if (!isAbsolute(sourcePath) || sourcePath.includes("\0")) throw new Error("La ruta seleccionada no es válida.");
  const name = basename(sourcePath);
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new Error("El nombre del archivo no es seguro.");
  const extension = extname(name).toLocaleLowerCase("en-US");
  const allowed = ALLOWED_MEDIA[extension];
  if (!allowed) throw new Error("Formato no permitido. Use PNG, JPG, JPEG, WebP, GIF, MP4 o WebM.");
  const sourceStats = await lstat(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error("Solo se permiten archivos regulares, no enlaces simbólicos.");
  const limit = allowed.kind === MEDIA_KIND.IMAGE ? IMAGE_LIMIT_BYTES : VIDEO_LIMIT_BYTES;
  if (sourceStats.size <= 0 || sourceStats.size > limit) {
    throw new Error(allowed.kind === MEDIA_KIND.IMAGE ? "La imagen supera el límite de 15 MB." : "El video supera el límite de 100 MB.");
  }
  const header = Buffer.alloc(16);
  const handle = await open(sourcePath, "r");
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (!hasMagic(header, extension)) throw new Error("La firma del archivo no coincide con su extensión permitida.");
  return { extension, ...allowed };
}

function mediaStatus(demoDistribution: boolean): MediaLibraryStatus {
  return {
    importAvailable: true,
    demoDistribution,
    imageLimitBytes: IMAGE_LIMIT_BYTES,
    videoLimitBytes: VIDEO_LIMIT_BYTES,
    message: demoDistribution
      ? "La edición demo permite importar ayudas privadas, pero no habilita escucha real."
      : "Los medios se guardan localmente; no se almacena audio ni transcripción adicional.",
  };
}

export class MediaLibrary {
  private readonly mediaDirectory: string;
  private readonly metadataPath: string;
  private importedEntries: VisualLibraryEntry[] = [];
  private bundledEnabled: Record<string, boolean> = {};
  private initialized = false;

  constructor(
    private readonly paths: MediaLibraryPaths,
    private readonly demoDistribution: boolean,
  ) {
    this.mediaDirectory = join(paths.dataDirectory, "media");
    this.metadataPath = join(paths.dataDirectory, "media-library.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.mediaDirectory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.metadataPath, "utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== 1) throw new Error("La biblioteca persistida no tiene un formato válido.");
      const document = parsed as Partial<MediaLibraryDocument>;
      if (!Array.isArray(document.importedEntries) || typeof document.bundledEnabled !== "object" || document.bundledEnabled === null) {
        throw new Error("La biblioteca persistida está incompleta.");
      }
      this.importedEntries = document.importedEntries.map(migratePersistedEntry).map(validateVisualLibraryEntry).filter((entry): entry is VisualLibraryEntry => Boolean(entry && entry.media.source === MEDIA_SOURCE.IMPORTED));
      this.bundledEnabled = Object.fromEntries(Object.entries(document.bundledEnabled).filter(([id, enabled]) => BUNDLED_VISUAL_MEDIA.some((entry) => entry.id === id) && typeof enabled === "boolean"));
    } catch (caught) {
      const code = caught instanceof Error && "code" in caught ? String(caught.code) : "";
      if (code !== "ENOENT") throw caught;
      await this.persist([], {});
    }
    this.initialized = true;
  }

  async list(): Promise<MediaLibraryListResult> {
    await this.initialize();
    const bundled = BUNDLED_VISUAL_MEDIA.map((entry) => ({ ...entry, enabled: this.bundledEnabled[entry.id] ?? entry.enabled }));
    return { entries: [...bundled, ...this.importedEntries], status: mediaStatus(this.demoDistribution) };
  }

  status(): MediaLibraryStatus {
    return mediaStatus(this.demoDistribution);
  }

  async import(sourcePath: string, rawDraft: unknown): Promise<VisualLibraryEntry> {
    await this.initialize();
    const draft = validateVisualMediaDraft(rawDraft);
    if (!draft) throw new Error("Los metadatos no son válidos o falta autorización para el estado validado.");
    const detected = await inspectImportFile(sourcePath);
    const id = `imported-${randomUUID()}`;
    const uri = `${randomUUID()}${detected.extension === ".jpeg" ? ".jpg" : detected.extension}`;
    const destination = join(this.mediaDirectory, uri);
    if (!isWithin(this.mediaDirectory, destination)) throw new Error("La ruta administrada no es segura.");
    try {
      await copyFile(sourcePath, destination);
      await inspectImportFile(destination);
    } catch (caught) {
      await rm(destination, { force: true });
      throw caught;
    }
    const timestamp = new Date().toISOString();
    const entry: VisualLibraryEntry = {
      id,
      label: draft.label.trim(),
      phrases: draft.phrases.map((value) => value.trim()),
      keywords: draft.keywords.map((value) => value.trim()).filter(Boolean),
      context: draft.context.trim(),
      region: draft.region.trim(),
      status: draft.status,
      validation: {
        validators: draft.validators.map((value) => value.trim()).filter(Boolean),
        notes: draft.validationNotes.trim(),
        validatedAt: draft.status === MEDIA_STATUS.VALIDATED ? timestamp : null,
      },
      authorization: { license: draft.license.trim(), authorizationReference: draft.authorizationReference.trim() },
      media: { kind: detected.kind, source: MEDIA_SOURCE.IMPORTED, uri, mimeType: detected.mimeType, altText: draft.altText.trim() },
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await this.persist([...this.importedEntries, entry], this.bundledEnabled);
      this.importedEntries = [...this.importedEntries, entry];
      return entry;
    } catch (caught) {
      await rm(destination, { force: true });
      throw caught;
    }
  }

  async save(rawEntry: unknown): Promise<VisualLibraryEntry> {
    await this.initialize();
    const entry = validateVisualLibraryEntry(rawEntry);
    if (!entry) throw new Error("La entrada no es válida o no cumple la política de validación.");
    if (entry.media.source === MEDIA_SOURCE.BUNDLED) {
      const original = BUNDLED_VISUAL_MEDIA.find((item) => item.id === entry.id);
      if (!original) throw new Error("No se encontró el recurso incorporado.");
      const comparable = { ...entry, enabled: original.enabled, updatedAt: original.updatedAt };
      if (JSON.stringify(comparable) !== JSON.stringify(original)) throw new Error("Los recursos incorporados solo permiten cambiar el estado habilitado.");
      const nextEnabled = { ...this.bundledEnabled, [entry.id]: entry.enabled };
      await this.persist(this.importedEntries, nextEnabled);
      this.bundledEnabled = nextEnabled;
      return { ...original, enabled: entry.enabled, updatedAt: new Date().toISOString() };
    }
    const index = this.importedEntries.findIndex((item) => item.id === entry.id);
    if (index < 0) throw new Error("No se encontró el medio importado.");
    const current = this.importedEntries[index];
    if (!current || current.media.uri !== entry.media.uri || current.media.mimeType !== entry.media.mimeType || current.createdAt !== entry.createdAt) {
      throw new Error("No se pueden cambiar los datos administrados del archivo.");
    }
    const updated = { ...entry, updatedAt: new Date().toISOString() };
    const next = this.importedEntries.map((item) => item.id === updated.id ? updated : item);
    await this.persist(next, this.bundledEnabled);
    this.importedEntries = next;
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.initialize();
    const entry = this.importedEntries.find((item) => item.id === id);
    if (!entry) throw new Error("Solo se pueden eliminar medios importados existentes.");
    const target = join(this.mediaDirectory, entry.media.uri);
    const tombstone = `${target}.deleting`;
    if (!isWithin(this.mediaDirectory, target)) throw new Error("La ruta administrada no es segura.");
    await rename(target, tombstone);
    const next = this.importedEntries.filter((item) => item.id !== id);
    try {
      await this.persist(next, this.bundledEnabled);
      this.importedEntries = next;
      await unlink(tombstone);
    } catch (caught) {
      await rename(tombstone, target).catch(() => undefined);
      throw caught;
    }
  }

  async resolve(id: string): Promise<ResolvedMedia | null> {
    await this.initialize();
    const entry = [...BUNDLED_VISUAL_MEDIA, ...this.importedEntries].find((item) => item.id === id);
    if (!entry) return null;
    const root = entry.media.source === MEDIA_SOURCE.BUNDLED ? this.paths.bundledDirectory : this.mediaDirectory;
    const candidate = join(root, entry.media.uri);
    if (!isWithin(root, candidate)) return null;
    try {
      const rootReal = await realpath(root);
      const fileReal = await realpath(candidate);
      if (!isWithin(rootReal, fileReal)) return null;
      const fileStats = await stat(fileReal);
      if (!fileStats.isFile()) return null;
      return { path: fileReal, mimeType: entry.media.mimeType, size: fileStats.size };
    } catch {
      return null;
    }
  }

  private async persist(entries: readonly VisualLibraryEntry[], bundledEnabled: Readonly<Record<string, boolean>>): Promise<void> {
    await mkdir(this.paths.dataDirectory, { recursive: true });
    const temporary = `${this.metadataPath}.${randomUUID()}.tmp`;
    try {
      const document: MediaLibraryDocument = { version: 1, importedEntries: [...entries], bundledEnabled: { ...bundledEnabled } };
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.metadataPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
