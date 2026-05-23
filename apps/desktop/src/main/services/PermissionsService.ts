import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shell, systemPreferences } from "electron";
import type { PermissionState } from "@notetaker/core";

const execFileAsync = promisify(execFile);

export interface PermissionStatus {
  microphone: PermissionState;
  systemAudio: PermissionState;
  appleEvents: PermissionState;
}

export class PermissionsService {
  check(): PermissionStatus {
    const micRaw = systemPreferences.getMediaAccessStatus("microphone");
    return {
      microphone: micRaw as PermissionState,
      systemAudio: process.platform === "darwin" ? "not-determined" : "granted",
      appleEvents: process.platform === "darwin" ? "not-determined" : "granted",
    };
  }

  async refresh(): Promise<PermissionStatus> {
    const base = this.check();
    if (process.platform === "darwin") {
      base.appleEvents = (await this.probeAppleEvents()) ? "granted" : "denied";
    }
    return base;
  }

  async request(kind: "microphone" | "systemAudio" | "appleEvents"): Promise<boolean> {
    if (kind === "microphone") {
      if (process.platform === "darwin") {
        return systemPreferences.askForMediaAccess("microphone");
      }
      return true;
    }

    if (kind === "systemAudio") {
      if (process.platform !== "darwin") return true;
      await this.openSystemAudioSettings();
      return true;
    }

    if (kind === "appleEvents") {
      if (process.platform !== "darwin") return true;
      // Probing triggers the macOS Automation prompt — only call from explicit user action.
      return this.probeAppleEvents();
    }

    return false;
  }

  async openSystemAudioSettings(): Promise<void> {
    if (process.platform !== "darwin") return;
    // The exact URL changed between macOS versions. Try the most specific one
    // first, fall back to the Privacy & Security root if it fails.
    const urls = [
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AudioCapture",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture",
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
      "x-apple.systempreferences:com.apple.preference.security",
    ];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        return;
      } catch {
        // try next
      }
    }
  }

  private async probeAppleEvents(): Promise<boolean> {
    try {
      await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
