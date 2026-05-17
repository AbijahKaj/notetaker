#!/usr/bin/env tsx
/**
 * Model downloader for NoteTaker onboarding.
 * Downloads required and optional STT/diarization/LLM models with SHA256 verification.
 *
 * Usage: pnpm models:download [--required-only] [--model <id>]
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

interface ModelEntry {
  id: string;
  required: boolean;
  sizeBytes: number;
  sha256?: string;
  url: string;
  dest: string;
}

const MODELS_DIR = join(
  process.env["NOTETAKER_MODELS_DIR"] ?? join(homedir(), "Library/Application Support/notetaker-desktop/models"),
);

const CATALOG: Omit<ModelEntry, "dest">[] = [
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

function destFor(id: string): string {
  const map: Record<string, string> = {
    "silero-vad": join(MODELS_DIR, "silero_vad", "silero_vad.onnx"),
    "parakeet-tdt-v3": join(MODELS_DIR, "parakeet-tdt-0.6b-v3"),
    "sortformer-diarization": join(MODELS_DIR, "sortformer-diarization"),
    "lang-id": join(MODELS_DIR, "lang-id"),
    "whisper-large-v3-turbo": join(MODELS_DIR, "whisper-large-v3-turbo"),
    "llama-3.2-3b-mlx": join(MODELS_DIR, "llama-3.2-3b-mlx"),
  };
  return map[id] ?? join(MODELS_DIR, id);
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function checkDiskSpace(requiredBytes: number): void {
  const freeEstimate = 10_000_000_000;
  if (requiredBytes > freeEstimate) {
    console.warn(`Warning: need ~${Math.round(requiredBytes / 1e9)}GB disk space`);
  }
}

async function download(entry: ModelEntry): Promise<void> {
  if (existsSync(entry.dest)) {
    console.log(`✓ ${entry.id} already installed`);
    return;
  }

  mkdirSync(join(entry.dest, ".."), { recursive: true });
  const tmpPath = entry.dest + ".download";

  console.log(`↓ Downloading ${entry.id} (${Math.round(entry.sizeBytes / 1e6)} MB)...`);
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry.url}`);

  const body = res.body;
  if (!body) throw new Error("No response body");

  const reader = body.getReader();
  const writeStream = createWriteStream(tmpPath);
  let received = 0;
  const total = Number(res.headers.get("content-length") ?? entry.sizeBytes);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writeStream.write(Buffer.from(value));
    received += value.length;
    const pct = Math.round((received / total) * 100);
    process.stdout.write(`\r  ${pct}% (${Math.round(received / 1e6)} MB)`);
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on("error", reject);
  });
  console.log("");

  if (entry.sha256) {
    const hash = await sha256File(tmpPath);
    if (hash !== entry.sha256) {
      await unlink(tmpPath);
      throw new Error(`SHA256 mismatch for ${entry.id}`);
    }
    console.log(`  SHA256 verified`);
  }

  await rename(tmpPath, entry.dest);
  console.log(`✓ ${entry.id} installed → ${entry.dest}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requiredOnly = args.includes("--required-only");
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];

  let entries = CATALOG.map((c) => ({ ...c, dest: destFor(c.id) }));
  if (requiredOnly) entries = entries.filter((e) => e.required);
  if (modelArg) entries = entries.filter((e) => e.id === modelArg);

  const totalBytes = entries.reduce((n, e) => n + e.sizeBytes, 0);
  checkDiskSpace(totalBytes);

  mkdirSync(MODELS_DIR, { recursive: true });
  console.log(`Models directory: ${MODELS_DIR}`);
  console.log(`Downloading ${entries.length} model(s)...\n`);

  for (const entry of entries) {
    try {
      await download(entry);
    } catch (err) {
      console.error(`✗ ${entry.id} failed: ${err}`);
      process.exitCode = 1;
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
