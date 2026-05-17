import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAC_SUPPORT = join(homedir(), "Library", "Application Support");

/** Known userData / download locations (electron dev uses package name `desktop`). */
export const LEGACY_MODEL_DIRS = [
  join(MAC_SUPPORT, "desktop", "models"),
  join(MAC_SUPPORT, "NoteTaker", "models"),
  join(MAC_SUPPORT, "notetaker-desktop", "models"),
] as const;

export function hasInstalledSpeechModels(modelsDir: string): boolean {
  return (
    existsSync(join(modelsDir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")) ||
    existsSync(join(modelsDir, "silero_vad", "silero_vad.onnx"))
  );
}

/** Prefer an existing models tree (dev vs packaged vs legacy download path). */
export function resolveModelsDir(userDataDir: string): string {
  const primary = join(userDataDir, "models");
  for (const dir of [primary, ...LEGACY_MODEL_DIRS]) {
    if (hasInstalledSpeechModels(dir)) return dir;
  }
  return primary;
}

export function defaultDownloadModelsDir(): string {
  if (process.env["NOTETAKER_MODELS_DIR"]) return process.env["NOTETAKER_MODELS_DIR"];
  for (const dir of LEGACY_MODEL_DIRS) {
    if (hasInstalledSpeechModels(dir)) return dir;
  }
  return join(MAC_SUPPORT, "NoteTaker", "models");
}
