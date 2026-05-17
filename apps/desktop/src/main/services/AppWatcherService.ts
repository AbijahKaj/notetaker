import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { APP_NAMES, BROWSER_BUNDLE_IDS, TypedEmitter, createLogger } from "@notetaker/core";
import type { PreferencesService } from "./PreferencesService.js";

const execFileAsync = promisify(execFile);
const log = createLogger("app-watcher");

export type WatchedAppKind = "app" | "browser";

type AppWatcherEvents = {
  activate: [bundleId: string, name: string, kind: WatchedAppKind];
  deactivate: [bundleId: string, kind: WatchedAppKind];
};

const APP_PATHS: Record<string, string> = {
  "us.zoom.xos": "/Applications/zoom.us.app",
  "com.microsoft.teams2": "/Applications/Microsoft Teams.app",
  "com.tinyspeck.slackmacgap": "/Applications/Slack.app",
  "com.apple.FaceTime": "/System/Applications/FaceTime.app",
  "com.hnc.Discord": "/Applications/Discord.app",
  "com.cisco.webexmeetingsapp": "/Applications/Webex.app",
};

export class AppWatcherService extends TypedEmitter<AppWatcherEvents> {
  private prefs: PreferencesService;
  private interval: ReturnType<typeof setInterval> | null = null;
  private activeApps = new Map<string, WatchedAppKind>();

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
    for (const [bundleId, kind] of this.activeApps) {
      this.emit("deactivate", bundleId, kind);
    }
    this.activeApps.clear();
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

  private watchedTargets(): { bundleId: string; kind: WatchedAppKind }[] {
    const prefs = this.prefs.get();
    const targets: { bundleId: string; kind: WatchedAppKind }[] = prefs.appWhitelist.map((bundleId) => ({
      bundleId,
      kind: "app" as const,
    }));
    if (prefs.siteWhitelist.length > 0) {
      for (const bundleId of BROWSER_BUNDLE_IDS) {
        targets.push({ bundleId, kind: "browser" });
      }
    }
    return targets;
  }

  private async poll(): Promise<void> {
    const running = await this.getRunningApps();

    for (const { bundleId, kind } of this.watchedTargets()) {
      const isRunning = running.has(bundleId);
      const wasActive = this.activeApps.has(bundleId);

      if (isRunning && !wasActive) {
        this.activeApps.set(bundleId, kind);
        this.emit("activate", bundleId, APP_NAMES[bundleId] ?? bundleId, kind);
      } else if (!isRunning && wasActive) {
        this.activeApps.delete(bundleId);
        this.emit("deactivate", bundleId, kind);
      }
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
