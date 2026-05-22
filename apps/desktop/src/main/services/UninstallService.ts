import { app } from "electron";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import keytar from "keytar";
import { createLogger, type LlmProvider } from "@notetaker/core";
import { LEGACY_MODEL_DIRS } from "@notetaker/core/models-dir";

const log = createLogger("uninstall");

const KEYTAR_SERVICE = "com.notetaker.desktop";
const LLM_PROVIDERS: LlmProvider[] = ["anthropic", "openai", "openrouter", "mlx-local"];

export interface UninstallResult {
  ok: boolean;
  removed: string[];
  errors: { path: string; error: string }[];
}

/**
 * Wipes every artifact NoteTaker writes to disk and to the macOS keychain.
 * Caller is responsible for stopping services and quitting the app afterwards.
 */
export async function performUninstall(opts: { removeApp?: boolean } = {}): Promise<UninstallResult> {
  const removed: string[] = [];
  const errors: { path: string; error: string }[] = [];

  const userData = app.getPath("userData");
  const support = join(homedir(), "Library", "Application Support");
  const caches = join(homedir(), "Library", "Caches");
  const logsDir = app.getPath("logs");
  const crashDumps = (() => {
    try {
      return app.getPath("crashDumps");
    } catch {
      return null;
    }
  })();

  const targets = new Set<string>([
    userData,
    ...LEGACY_MODEL_DIRS.map((p) => p.replace(/\/models$/, "")),
    join(support, "NoteTaker"),
    join(support, "notetaker-desktop"),
    join(support, "desktop"),
    join(support, "com.notetaker.desktop"),
    join(caches, "NoteTaker"),
    join(caches, "com.notetaker.desktop"),
    join(caches, "notetaker-desktop"),
    join(homedir(), "Library", "Preferences", "com.notetaker.desktop.plist"),
    join(homedir(), "Library", "Saved Application State", "com.notetaker.desktop.savedState"),
    join(homedir(), "Library", "Logs", "NoteTaker"),
    logsDir,
  ]);
  if (crashDumps) targets.add(crashDumps);

  for (const target of targets) {
    if (!target || !existsSync(target)) continue;
    try {
      await rm(target, { recursive: true, force: true });
      removed.push(target);
      log.info("removed", { target });
    } catch (err) {
      errors.push({ path: target, error: String(err) });
      log.warn("failed to remove", { target, err: String(err) });
    }
  }

  // Remove keychain entries (db key + every LLM provider key we may have stored).
  const keychainEntries = ["db:encryption", ...LLM_PROVIDERS.map((p) => `llm:${p}`)];
  for (const account of keychainEntries) {
    try {
      const ok = await keytar.deletePassword(KEYTAR_SERVICE, account);
      if (ok) removed.push(`keychain:${KEYTAR_SERVICE}/${account}`);
    } catch (err) {
      errors.push({ path: `keychain:${account}`, error: String(err) });
      log.warn("failed to remove keychain entry", { account, err: String(err) });
    }
  }

  // Disable login item.
  try {
    if (process.platform === "darwin") {
      app.setLoginItemSettings({ openAtLogin: false, openAsHidden: false, name: app.getName() });
      removed.push("loginItem");
    }
  } catch (err) {
    errors.push({ path: "loginItem", error: String(err) });
  }

  // Optionally remove the bundled .app itself (only meaningful for the packaged build).
  if (opts.removeApp && app.isPackaged) {
    const appPath = app.getPath("exe");
    // appPath = .../NoteTaker.app/Contents/MacOS/NoteTaker; walk back to the .app bundle root.
    const idx = appPath.indexOf(".app/");
    const bundle = idx >= 0 ? appPath.slice(0, idx + 4) : null;
    if (bundle && existsSync(bundle)) {
      try {
        await rm(bundle, { recursive: true, force: true });
        removed.push(bundle);
        log.info("removed app bundle", { bundle });
      } catch (err) {
        errors.push({ path: bundle, error: String(err) });
        log.warn("failed to remove app bundle (may require admin permission)", {
          bundle,
          err: String(err),
        });
      }
    }
  }

  return { ok: errors.length === 0, removed, errors };
}
