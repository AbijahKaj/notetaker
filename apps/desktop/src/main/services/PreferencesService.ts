import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  PreferencesSchema,
  DEFAULT_APP_WHITELIST,
  DEFAULT_SITE_WHITELIST,
  resolveLlmModel,
  type Preferences,
} from "@notetaker/core";

const PREFS_FILE = "preferences.json";

export class PreferencesService {
  private prefs: Preferences;
  private prefsPath: string;

  constructor(userDataDir: string) {
    this.prefsPath = join(userDataDir, PREFS_FILE);
    this.prefs = PreferencesSchema.parse({
      appWhitelist: DEFAULT_APP_WHITELIST,
      siteWhitelist: DEFAULT_SITE_WHITELIST,
    });
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.prefsPath, "utf8");
      this.prefs = PreferencesSchema.parse(JSON.parse(raw));
      const fixedModel = resolveLlmModel(this.prefs.llmProvider, this.prefs.llmModel);
      if (fixedModel !== this.prefs.llmModel) {
        this.prefs = { ...this.prefs, llmModel: fixedModel };
        await this.save();
      }
    } catch {
      await this.save();
    }
  }

  get(): Preferences {
    return { ...this.prefs };
  }

  async update(patch: Partial<Preferences>): Promise<Preferences> {
    this.prefs = PreferencesSchema.parse({ ...this.prefs, ...patch });
    await this.save();
    return this.get();
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.prefsPath), { recursive: true });
    await writeFile(this.prefsPath, JSON.stringify(this.prefs, null, 2), "utf8");
  }
}
