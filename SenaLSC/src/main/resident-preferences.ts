import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ResidentPreferences } from "../shared/types";
import { validateResidentPreferences } from "../shared/validation";
import { DEFAULT_RESIDENT_PREFERENCES } from "./resident-shell";

export class ResidentPreferencesStore {
  private preferences: ResidentPreferences = DEFAULT_RESIDENT_PREFERENCES;

  constructor(private readonly filePath: string) {}

  async load(): Promise<ResidentPreferences> {
    try {
      const parsed = validateResidentPreferences(JSON.parse(await readFile(this.filePath, "utf8")));
      this.preferences = parsed ?? DEFAULT_RESIDENT_PREFERENCES;
    } catch (caught) {
      const code = caught instanceof Error && "code" in caught ? String(caught.code) : "";
      if (code !== "ENOENT" && !(caught instanceof SyntaxError)) throw caught;
      this.preferences = DEFAULT_RESIDENT_PREFERENCES;
    }
    return this.current();
  }

  current(): ResidentPreferences {
    return { ...this.preferences };
  }

  async save(preferences: ResidentPreferences): Promise<ResidentPreferences> {
    const validated = validateResidentPreferences(preferences);
    if (!validated) throw new Error("Las preferencias residentes no son válidas.");
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(validated, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
    this.preferences = validated;
    return this.current();
  }
}
