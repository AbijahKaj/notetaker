import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createLogger } from "@notetaker/core";

const log = createLogger("models");

export interface ModelSpec {
  id: string;
  required: boolean;
  sizeBytes: number;
  sha256?: string;
  url: string;
  dest: string;
}

export interface DownloadProgress {
  id: string;
  receivedBytes: number;
  totalBytes: number;
}

const MODEL_CATALOG: Omit<ModelSpec, "dest">[] = [
  {
    id: "silero-vad",
    required: true,
    sizeBytes: 5_000_000,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/vad-models/silero_vad.onnx",
  },
  {
    id: "parakeet-tdt-v3",
    required: true,
    sizeBytes: 500_000_000,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3.tar.bz2",
  },
  {
    id: "sortformer-diarization",
    required: true,
    sizeBytes: 50_000_000,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-diarization-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
  },
  {
    id: "lang-id",
    required: true,
    sizeBytes: 10_000_000,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2",
  },
  {
    id: "whisper-large-v3-turbo",
    required: false,
    sizeBytes: 1_600_000_000,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-large-v3-turbo.tar.bz2",
  },
  {
    id: "llama-3.2-3b-mlx",
    required: false,
    sizeBytes: 2_000_000_000,
    url: "https://huggingface.co/mlx-community/Llama-3.2-3B-Instruct-4bit/resolve/main/model.safetensors",
  },
];

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
    const dest = this.destFor(id);
    return existsSync(dest);
  }

  async download(
    id: string,
    onProgress?: (ev: DownloadProgress) => void,
  ): Promise<void> {
    const spec = MODEL_CATALOG.find((m) => m.id === id);
    if (!spec) throw new Error(`Unknown model: ${id}`);

    const dest = this.destFor(id);
    if (existsSync(dest)) {
      log.info("model already installed", { id });
      return;
    }

    log.info("downloading model", { id, url: spec.url });
    const tmpPath = dest + ".download";

    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
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

    if (spec.sha256) {
      const hash = await sha256File(tmpPath);
      if (hash !== spec.sha256) {
        throw new Error(`SHA256 mismatch for ${id}: expected ${spec.sha256}, got ${hash}`);
      }
    }

    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, dest);
    onProgress?.({ id, receivedBytes: totalBytes, totalBytes });
    log.info("model installed", { id, dest });
  }

  private destFor(id: string): string {
    const map: Record<string, string> = {
      "silero-vad": join(this.modelsDir, "silero_vad", "silero_vad.onnx"),
      "parakeet-tdt-v3": join(this.modelsDir, "parakeet-tdt-0.6b-v3"),
      "sortformer-diarization": join(this.modelsDir, "sortformer-diarization"),
      "lang-id": join(this.modelsDir, "lang-id"),
      "whisper-large-v3-turbo": join(this.modelsDir, "whisper-large-v3-turbo"),
      "llama-3.2-3b-mlx": join(this.modelsDir, "llama-3.2-3b-mlx"),
    };
    return map[id] ?? join(this.modelsDir, id);
  }
}

async function sha256File(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}
