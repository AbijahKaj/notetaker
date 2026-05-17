import { join } from "node:path";
import { NoteTakerDatabase } from "@notetaker/storage";
import type { LlmKeyService } from "./LlmKeyService.js";
import type { PreferencesService } from "./PreferencesService.js";

export class StorageService {
  private db: NoteTakerDatabase | null = null;
  private userDataDir: string;
  private llmKeys: LlmKeyService | null = null;
  private prefs: PreferencesService | null = null;

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
  }

  setKeyService(llmKeys: LlmKeyService, prefs: PreferencesService): void {
    this.llmKeys = llmKeys;
    this.prefs = prefs;
  }

  async init(): Promise<void> {
    const dbPath = join(this.userDataDir, "notetaker.db");
    let encryptionKey: string | undefined;

    if (this.prefs?.get().encryptDb && this.llmKeys) {
      encryptionKey = await this.llmKeys.getOrCreateDbKey();
    }

    this.db = new NoteTakerDatabase({ dbPath, encryptionKey });
  }

  getDb(): NoteTakerDatabase {
    if (!this.db) throw new Error("Storage not initialized");
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
