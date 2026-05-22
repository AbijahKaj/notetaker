import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { MODEL_CATALOG, createLogger, verifyFileSha256 } from "@notetaker/core";
import { resolveModelsDir } from "@notetaker/core/models-dir";

const execFileAsync = promisify(execFile);
const log = createLogger("models");

export type ModelDownloadPhase = "downloading" | "extracting" | "finishing" | "done";

export interface ModelDownloadUpdate {
  id: string;
  phase: ModelDownloadPhase;
  receivedBytes?: number;
  totalBytes?: number;
}

export class ModelManager {
  private modelsDir: string;

  constructor(userDataDir: string) {
    this.modelsDir = resolveModelsDir(userDataDir);
    if (!existsSync(this.modelsDir)) mkdirSync(this.modelsDir, { recursive: true });
    if (this.modelsDir !== join(userDataDir, "models")) {
      log.info("using models directory", { modelsDir: this.modelsDir });
    }
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

  async download(id: string, onUpdate?: (ev: ModelDownloadUpdate) => void): Promise<void> {
    const spec = MODEL_CATALOG.find((m) => m.id === id);
    if (!spec) throw new Error(`Unknown model: ${id}`);

    const dest = this.installPathFor(id);
    if (existsSync(dest)) {
      log.info("model already installed", { id });
      onUpdate?.({ id, phase: "done" });
      return;
    }

    const emit = (update: ModelDownloadUpdate) => onUpdate?.(update);

    log.info("downloading model", { id, url: spec.url });
    const tmpPath = join(this.modelsDir, `.${id}.download`);

    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} for ${spec.url}`);
    const totalBytes = Number(res.headers.get("content-length") ?? spec.sizeBytes);
    let receivedBytes = 0;
    let lastLoggedPct = -1;
    emit({ id, phase: "downloading", receivedBytes: 0, totalBytes });

    const body = res.body;
    if (!body) throw new Error("No response body");

    const reader = body.getReader();
    const writeStream = createWriteStream(tmpPath);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(Buffer.from(value));
      receivedBytes += value.length;
      emit({ id, phase: "downloading", receivedBytes, totalBytes });
      const pct = totalBytes > 0 ? Math.floor((receivedBytes / totalBytes) * 100) : 0;
      if (pct >= lastLoggedPct + 10) {
        lastLoggedPct = pct;
        log.info("model download progress", { id, phase: "downloading", pct });
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    if (spec.downloadSha256) {
      await verifyFileSha256(tmpPath, spec.downloadSha256);
    }

    try {
      if (spec.archive) {
        emit({ id, phase: "extracting" });
        log.info("model extracting archive", { id });
        await execFileAsync("tar", ["-xjf", tmpPath, "-C", this.modelsDir]);
        await unlink(tmpPath);
        if (!existsSync(dest)) {
          throw new Error(`Archive extracted but ${spec.installPath} not found`);
        }
      } else {
        emit({ id, phase: "finishing" });
        mkdirSync(dirname(dest), { recursive: true });
        const { rename } = await import("node:fs/promises");
        await rename(tmpPath, dest);
      }
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }

    emit({ id, phase: "done", receivedBytes: totalBytes, totalBytes });
    log.info("model installed", { id, dest });
  }

  private installPathFor(id: string): string {
    const spec = MODEL_CATALOG.find((m) => m.id === id);
    if (!spec) return join(this.modelsDir, id);
    return join(this.modelsDir, spec.installPath);
  }
}
