import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { BROWSER_BUNDLE_IDS, createLogger } from "@notetaker/core";
import type { PreferencesService } from "./PreferencesService.js";

const execFileAsync = promisify(execFile);
const log = createLogger("tab-poller");

const BROWSER_SCRIPTS: Record<string, string> = {
  "com.google.Chrome": 'tell application "Google Chrome" to get URL of every tab of every window',
  "com.apple.Safari": 'tell application "Safari" to get URL of every tab of every window',
  "company.thebrowser.Browser": 'tell application "Arc" to get URL of every tab of every window',
  "com.microsoft.edgemac": 'tell application "Microsoft Edge" to get URL of every tab of every window',
};

const BROWSER_DEACTIVATE_MS = 30_000;

interface BrowserState {
  active: boolean;
  matchedSite: string;
  lastMatchMs: number;
}

export class TabPollerService extends EventEmitter {
  private prefs: PreferencesService;
  private interval: ReturnType<typeof setInterval> | null = null;
  private browserStates = new Map<string, BrowserState>();

  constructor(prefs: PreferencesService) {
    super();
    this.prefs = prefs;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.poll(), 5_000);
    void this.poll();
    log.info("tab poller started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const [bundleId] of this.browserStates) {
      this.emit("deactivate", { bundleId });
    }
    this.browserStates.clear();
    log.info("tab poller stopped");
  }

  refreshWhitelist(): void {
    void this.poll();
  }

  private async poll(): Promise<void> {
    const siteWhitelist = this.prefs.get().siteWhitelist;

    for (const bundleId of BROWSER_BUNDLE_IDS) {
      if (!BROWSER_SCRIPTS[bundleId]) continue;

      const urls = await this.getTabUrls(bundleId);
      const matchedSite = this.findMatchingSite(urls, siteWhitelist);
      const state = this.browserStates.get(bundleId) ?? {
        active: false,
        matchedSite: "",
        lastMatchMs: 0,
      };

      if (matchedSite) {
        state.lastMatchMs = Date.now();
        if (!state.active || state.matchedSite !== matchedSite) {
          state.active = true;
          state.matchedSite = matchedSite;
          this.browserStates.set(bundleId, state);
          this.emit("activate", { bundleId, matchedSite });
          log.info("browser tap activated", { bundleId, matchedSite });
        }
      } else if (state.active) {
        const elapsed = Date.now() - state.lastMatchMs;
        if (elapsed > BROWSER_DEACTIVATE_MS) {
          state.active = false;
          state.matchedSite = "";
          this.browserStates.set(bundleId, state);
          this.emit("deactivate", { bundleId });
          log.info("browser tap deactivated", { bundleId });
        }
      }
    }
  }

  private findMatchingSite(urls: string[], whitelist: string[]): string | null {
    for (const url of urls) {
      for (const site of whitelist) {
        if (url.includes(site)) return site;
      }
    }
    return null;
  }

  private async getTabUrls(bundleId: string): Promise<string[]> {
    const script = BROWSER_SCRIPTS[bundleId];
    if (!script) return [];
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", script]);
      return stdout.trim().split(", ").map((s) => s.trim()).filter(Boolean);
    } catch (err) {
      log.debug("tab poll failed", { bundleId, err: String(err) });
      return [];
    }
  }
}
