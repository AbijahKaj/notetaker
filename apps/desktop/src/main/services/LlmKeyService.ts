import { join } from "node:path";
import { randomBytes } from "node:crypto";
import keytar from "keytar";
import type { LlmProvider } from "@notetaker/core";

const SERVICE = "com.notetaker.desktop";

export class LlmKeyService {
  async set(provider: LlmProvider, apiKey: string): Promise<void> {
    if (provider === "mlx-local") return;
    await keytar.setPassword(SERVICE, `llm:${provider}`, apiKey);
  }

  async get(provider: LlmProvider): Promise<string | null> {
    if (provider === "mlx-local") return null;
    return keytar.getPassword(SERVICE, `llm:${provider}`);
  }

  async has(provider: LlmProvider): Promise<boolean> {
    if (provider === "mlx-local") return true;
    const key = await this.get(provider);
    return !!key;
  }

  async delete(provider: LlmProvider): Promise<void> {
    await keytar.deletePassword(SERVICE, `llm:${provider}`);
  }

  async getOrCreateDbKey(): Promise<string> {
    const existing = await keytar.getPassword(SERVICE, "db:encryption");
    if (existing) return existing;
    const key = randomBytes(32).toString("hex");
    await keytar.setPassword(SERVICE, "db:encryption", key);
    return key;
  }
}
