import { join } from "node:path";
import { NoteTakerDatabase, reconfigureDatabaseEncryption } from "@notetaker/storage";
import type { LlmKeyService } from "./LlmKeyService.js";
import type { PreferencesService } from "./PreferencesService.js";

export class StorageService {
  private db: NoteTakerDatabase | null = null;
  private userDataDir: string;
  private dbPath: string;
  private llmKeys: LlmKeyService | null = null;
  private prefs: PreferencesService | null = null;

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
    this.dbPath = join(userDataDir, "notetaker.db");
  }

  setKeyService(llmKeys: LlmKeyService, prefs: PreferencesService): void {
    this.llmKeys = llmKeys;
    this.prefs = prefs;
  }

  async init(): Promise<void> {
    await this.open();
  }

  private async resolveEncryptionKey(): Promise<string | undefined> {
    if (!this.prefs?.get().encryptDb) return undefined;
    if (!this.llmKeys) {
      throw new Error("Database encryption requires the key service");
    }
    return this.llmKeys.getOrCreateDbKey();
  }

  private async open(): Promise<void> {
    const encryptionKey = await this.resolveEncryptionKey();
    this.db = new NoteTakerDatabase({ dbPath: this.dbPath, encryptionKey });
  }

  async reconfigureEncryption(): Promise<void> {
    if (!this.prefs || !this.llmKeys) {
      throw new Error("Storage not configured");
    }

    const enable = this.prefs.get().encryptDb;
    const key = await this.llmKeys.getOrCreateDbKey();

    this.db?.close();
    this.db = null;

    reconfigureDatabaseEncryption(this.dbPath, key, enable);
    await this.open();
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
