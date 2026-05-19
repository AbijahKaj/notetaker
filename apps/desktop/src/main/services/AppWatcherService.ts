import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import {
  APP_NAMES,
  APP_PATHS,
  BROWSER_BUNDLE_IDS,
  BROWSER_URL_SCRIPTS,
  TypedEmitter,
  createLogger,
  matchSiteWhitelist,
} from "@notetaker/core";
import type { PreferencesService } from "./PreferencesService.js";

const execFileAsync = promisify(execFile);
const log = createLogger("app-watcher");

type AppWatcherEvents = {
  activate: [bundleId: string, name: string];
  deactivate: [bundleId: string];
  browserActivate: [bundleId: string, matchedSite: string, name: string];
  browserDeactivate: [bundleId: string];
};

export class AppWatcherService extends TypedEmitter<AppWatcherEvents> {
  private prefs: PreferencesService;
  private interval: ReturnType<typeof setInterval> | null = null;
  private activeApps = new Set<string>();
  private activeBrowsers = new Map<string, string>();

  constructor(prefs: PreferencesService) {
    super();
    this.prefs = prefs;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.poll(), 5_000);
    void this.poll();
    log.info("app watcher started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const bundleId of this.activeApps) {
      this.emit("deactivate", bundleId);
    }
    this.activeApps.clear();
    for (const bundleId of this.activeBrowsers.keys()) {
      this.emit("browserDeactivate", bundleId);
    }
    this.activeBrowsers.clear();
    log.info("app watcher stopped");
  }

  refreshWhitelist(): void {
    void this.poll();
  }

  async detectAll(): Promise<{ bundleId: string; name: string; installed: boolean; running: boolean }[]> {
    const whitelist = this.prefs.get().appWhitelist;
    const running = this.prefs.get().automationGranted
      ? await this.getRunningApps()
      : new Set<string>();
    return whitelist.map((bundleId) => ({
      bundleId,
      name: APP_NAMES[bundleId] ?? bundleId,
      installed: existsSync(APP_PATHS[bundleId] ?? ""),
      running: running.has(bundleId),
    }));
  }

  private async poll(): Promise<void> {
    await this.pollApps();
    await this.pollBrowsers();
  }

  private async pollApps(): Promise<void> {
    const whitelist = new Set(this.prefs.get().appWhitelist);
    const running = await this.getRunningApps();

    for (const bundleId of whitelist) {
      const isRunning = running.has(bundleId);
      const wasActive = this.activeApps.has(bundleId);

      if (isRunning && !wasActive) {
        this.activeApps.add(bundleId);
        this.emit("activate", bundleId, APP_NAMES[bundleId] ?? bundleId);
      } else if (!isRunning && wasActive) {
        this.activeApps.delete(bundleId);
        this.emit("deactivate", bundleId);
      }
    }
  }

  private async pollBrowsers(): Promise<void> {
    if (!this.prefs.get().automationGranted) return;

    const sites = this.prefs.get().siteWhitelist;
    if (sites.length === 0) return;

    const running = await this.getRunningApps();

    for (const bundleId of BROWSER_BUNDLE_IDS) {
      const isRunning = running.has(bundleId);

      if (!isRunning) {
        if (this.activeBrowsers.has(bundleId)) {
          this.activeBrowsers.delete(bundleId);
          this.emit("browserDeactivate", bundleId);
        }
        continue;
      }

      const url = await this.getBrowserUrl(bundleId);
      const matchedSite = url ? matchSiteWhitelist(url, sites) : null;
      const wasActive = this.activeBrowsers.has(bundleId);

      if (matchedSite && !wasActive) {
        this.activeBrowsers.set(bundleId, matchedSite);
        this.emit("browserActivate", bundleId, matchedSite, APP_NAMES[bundleId] ?? bundleId);
      } else if (!matchedSite && wasActive) {
        this.activeBrowsers.delete(bundleId);
        this.emit("browserDeactivate", bundleId);
      } else if (matchedSite) {
        this.activeBrowsers.set(bundleId, matchedSite);
      }
    }
  }

  private async getBrowserUrl(bundleId: string): Promise<string | null> {
    const script = BROWSER_URL_SCRIPTS[bundleId];
    if (!script) return null;

    try {
      const { stdout } = await execFileAsync("osascript", ["-e", script]);
      const url = stdout.trim();
      return url.startsWith("http") ? url : null;
    } catch {
      return null;
    }
  }

  private async getRunningApps(): Promise<Set<string>> {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to get bundle identifier of every process whose background only is false',
      ]);
      const bundleIds = stdout.trim().split(", ").map((s) => s.trim());
      return new Set(bundleIds);
    } catch (err) {
      log.warn("failed to get running apps", { err: String(err) });
      return new Set();
    }
  }
}
