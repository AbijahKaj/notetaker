import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { MODEL_CATALOG, createLogger } from "@notetaker/core";

const execFileAsync = promisify(execFile);
const log = createLogger("models");

export interface DownloadProgress {
  id: string;
  receivedBytes: number;
  totalBytes: number;
}

export class ModelManager {
  private modelsDir: string;

  constructor(userDataDir: string) {
    this.modelsDir = join(userDataDir, "models");
    if (!existsSync(this.modelsDir)) mkdirSync(this.modelsDir, { recursive: true });
  }

  getModelsDir(): string {
    return this.modelsDir;
  }

  statusAll(): { id: string; required: boolean; installed: boolean; sizeBytes: number }[] {
    return MODEL_CATALOG.map((m) => ({
      id: m.id,
      required: m.required,
      installed: this.isInstalled(m.id),
      sizeBytes: m.sizeBytes,
    }));
  }

  isInstalled(id: string): boolean {
    return existsSync(this.installPathFor(id));
  }

  async download(
    id: string,
    onProgress?: (ev: DownloadProgress) => void,
  ): Promise<void> {
    const spec = MODEL_CATALOG.find((m) => m.id === id);
    if (!spec) throw new Error(`Unknown model: ${id}`);

    const dest = this.installPathFor(id);
    if (existsSync(dest)) {
      log.info("model already installed", { id });
      return;
    }

    log.info("downloading model", { id, url: spec.url });
    const tmpPath = join(this.modelsDir, `.${id}.download`);

    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} for ${spec.url}`);
    const totalBytes = Number(res.headers.get("content-length") ?? spec.sizeBytes);
    let receivedBytes = 0;
    onProgress?.({ id, receivedBytes: 0, totalBytes });

    const body = res.body;
    if (!body) throw new Error("No response body");

    const reader = body.getReader();
    const writeStream = createWriteStream(tmpPath);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(Buffer.from(value));
      receivedBytes += value.length;
      onProgress?.({ id, receivedBytes, totalBytes });
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    try {
      if (spec.archive) {
        await execFileAsync("tar", ["-xjf", tmpPath, "-C", this.modelsDir]);
        await unlink(tmpPath);
        if (!existsSync(dest)) {
          throw new Error(`Archive extracted but ${spec.installPath} not found`);
        }
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        const { rename } = await import("node:fs/promises");
        await rename(tmpPath, dest);
      }
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }

    onProgress?.({ id, receivedBytes: totalBytes, totalBytes });
    log.info("model installed", { id, dest });
  }

  private installPathFor(id: string): string {
    const spec = MODEL_CATALOG.find((m) => m.id === id);
    if (!spec) return join(this.modelsDir, id);
    return join(this.modelsDir, spec.installPath);
  }
}
