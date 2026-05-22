import { app } from "electron";
import { EventEmitter } from "node:events";
import pkg from "electron-updater";
import { createLogger } from "@notetaker/core";

const { autoUpdater } = pkg;
const log = createLogger("auto-update");

type Events = {
  "update:available": [{ version: string; releaseNotes?: string }];
  "update:progress": [{ percent: number; bytesPerSecond: number }];
  "update:downloaded": [{ version: string }];
  "update:error": [{ message: string }];
};

export class AutoUpdateService extends EventEmitter {
  override on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    return super.emit(event, ...args);
  }

  private started = false;
  private checking = false;

  start(): void {
    if (this.started) return;
    if (!app.isPackaged) {
      log.info("auto-update disabled in development");
      return;
    }
    this.started = true;

    autoUpdater.logger = {
      info: (msg: unknown) => log.info(String(msg)),
      warn: (msg: unknown) => log.warn(String(msg)),
      error: (msg: unknown) => log.error(String(msg)),
      debug: () => {},
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
      const notes = typeof info.releaseNotes === "string" ? info.releaseNotes : undefined;
      this.emit("update:available", { version: info.version, releaseNotes: notes });
    });
    autoUpdater.on("download-progress", (p) => {
      this.emit("update:progress", { percent: p.percent, bytesPerSecond: p.bytesPerSecond });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.emit("update:downloaded", { version: info.version });
    });
    autoUpdater.on("error", (err) => {
      this.emit("update:error", { message: String(err?.message ?? err) });
    });

    // Check once on app launch. No recurring poll — users can manually
    // re-check from Settings or restart the app to pick up new releases.
    void this.check();
  }

  async check(): Promise<{ ok: boolean; version?: string; alreadyLatest?: boolean; error?: string }> {
    if (!app.isPackaged) {
      return { ok: false, error: "Auto-update is disabled in development" };
    }
    if (this.checking) return { ok: true };
    this.checking = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      const current = app.getVersion();
      const remote = result?.updateInfo?.version;
      if (remote && remote !== current) {
        return { ok: true, version: remote };
      }
      return { ok: true, alreadyLatest: true };
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      return { ok: false, error: message };
    } finally {
      this.checking = false;
    }
  }

  install(): void {
    if (!app.isPackaged) return;
    autoUpdater.quitAndInstall();
  }

  stop(): void {
    // no-op: nothing to clean up now that we don't run a recurring timer
  }
}
