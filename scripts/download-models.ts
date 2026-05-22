#!/usr/bin/env tsx
/**
 * Model downloader for NoteTaker onboarding.
 *
 * Usage: pnpm models:download [--required-only] [--model <id>]
 */

import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { MODEL_CATALOG, verifyFileSha256 } from "@notetaker/core";
import { defaultDownloadModelsDir } from "@notetaker/core/models-dir";

const execFileAsync = promisify(execFile);

const MODELS_DIR = defaultDownloadModelsDir();

function installPath(id: string): string {
  const spec = MODEL_CATALOG.find((m) => m.id === id);
  if (!spec) throw new Error(`Unknown model: ${id}`);
  return join(MODELS_DIR, spec.installPath);
}

function checkDiskSpace(requiredBytes: number): void {
  const freeEstimate = 10_000_000_000;
  if (requiredBytes > freeEstimate) {
    console.warn(`Warning: need ~${Math.round(requiredBytes / 1e9)}GB disk space`);
  }
}

async function downloadModel(id: string): Promise<void> {
  const spec = MODEL_CATALOG.find((m) => m.id === id);
  if (!spec) throw new Error(`Unknown model: ${id}`);

  const dest = installPath(id);
  if (existsSync(dest)) {
    console.log(`✓ ${id} already installed`);
    return;
  }

  mkdirSync(MODELS_DIR, { recursive: true });
  const tmpPath = join(MODELS_DIR, `.${id}.download`);

  console.log(`↓ Downloading ${id} (${Math.round(spec.sizeBytes / 1e6)} MB)...`);
  const res = await fetch(spec.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${spec.url}`);

  const body = res.body;
  if (!body) throw new Error("No response body");

  const reader = body.getReader();
  const writeStream = createWriteStream(tmpPath);
  let received = 0;
  const total = Number(res.headers.get("content-length") ?? spec.sizeBytes);

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

  if (spec.downloadSha256) {
    await verifyFileSha256(tmpPath, spec.downloadSha256);
  }

  try {
    if (spec.archive) {
      console.log("  Extracting…");
      await execFileAsync("tar", ["-xjf", tmpPath, "-C", MODELS_DIR]);
      await unlink(tmpPath);
      if (!existsSync(dest)) {
        throw new Error(`Expected ${spec.installPath} after extract`);
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

  console.log(`✓ ${id} installed → ${dest}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requiredOnly = args.includes("--required-only");
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];

  let entries = [...MODEL_CATALOG];
  if (requiredOnly) entries = entries.filter((e) => e.required);
  if (modelArg) entries = entries.filter((e) => e.id === modelArg);

  const totalBytes = entries.reduce((n, e) => n + e.sizeBytes, 0);
  checkDiskSpace(totalBytes);

  mkdirSync(MODELS_DIR, { recursive: true });
  console.log(`Models directory: ${MODELS_DIR}`);
  console.log(`Downloading ${entries.length} model(s)...\n`);

  for (const entry of entries) {
    try {
      await downloadModel(entry.id);
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
