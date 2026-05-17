import { app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { AudioBridge } from "@notetaker/audio-bridge";
import { TypedEmitter, createLogger, type PipelineEvents } from "@notetaker/core";

const log = createLogger("audio-ingest");

const SIDECAR_APP_NAME = "NoteTaker Audio Tap.app";

export class AudioIngestService extends TypedEmitter<PipelineEvents> {
  private bridge: AudioBridge | null = null;
  private sidecarPath: string;
  private micPreviewRefCount = 0;
  private listeningActive = false;

  constructor() {
    super();
    this.sidecarPath = this.resolveSidecarPath();
  }

  private resolveSidecarPath(): string {
    const bundledApp = join(process.resourcesPath, SIDECAR_APP_NAME, "Contents/MacOS/audio-tap");
    if (app.isPackaged && existsSync(bundledApp)) {
      return bundledApp;
    }

    const devBundled = join(
      app.getAppPath(),
      "../../native/audio-tap/.build/release",
      SIDECAR_APP_NAME,
      "Contents/MacOS/audio-tap",
    );
    if (existsSync(devBundled)) return devBundled;

    const devBinary = join(
      app.getAppPath(),
      "../../native/audio-tap/.build/release/audio-tap",
    );
    if (existsSync(devBinary)) {
      log.warn(
        "audio sidecar .app bundle missing — run pnpm sidecar:build for mic permission prompts",
      );
      return devBinary;
    }

    return devBundled;
  }

  async start(): Promise<void> {
    if (this.bridge) return;
    this.bridge = new AudioBridge(this.sidecarPath);
    this.bridge.on("audio:frame", (frame) => this.emit("audio:frame", frame));
    this.bridge.on("audio:source:added", (ev) => this.emit("audio:source:added", ev));
    this.bridge.on("audio:source:removed", (ev) => this.emit("audio:source:removed", ev));
    try {
      await this.bridge.start();
    } catch (err) {
      log.warn("audio sidecar unavailable, running without native capture", { err: String(err) });
    }
  }

  async stop(): Promise<void> {
    await this.bridge?.stop();
    this.bridge = null;
    this.listeningActive = false;
  }

  setListeningActive(active: boolean): void {
    this.listeningActive = active;
  }

  async addMicSource(): Promise<void> {
    await this.bridge?.addMicSource();
  }

  async addAppSource({ bundleId }: { bundleId: string }): Promise<void> {
    await this.bridge?.addAppSource(bundleId);
  }

  async removeAppSource({ bundleId }: { bundleId: string }): Promise<void> {
    // Bridge tracks by sourceId; for now we rely on sidecar lifecycle
    log.info("remove app source requested", { bundleId });
  }

  async addBrowserSource({ bundleId, matchedSite }: { bundleId: string; matchedSite: string }): Promise<void> {
    await this.bridge?.addBrowserSource(bundleId, matchedSite);
  }

  async removeBrowserSource({ bundleId }: { bundleId: string }): Promise<void> {
    log.info("remove browser source requested", { bundleId });
  }

  async startMicPreview(): Promise<void> {
    this.micPreviewRefCount += 1;
    if (this.micPreviewRefCount > 1) return;
    await this.start();
    await this.addMicSource();
  }

  async stopMicPreview(): Promise<void> {
    if (this.micPreviewRefCount <= 0) return;
    this.micPreviewRefCount -= 1;
    if (this.micPreviewRefCount > 0) return;
    if (this.listeningActive) return;
    await this.stop();
  }

  /**
   * Attempts a process tap so macOS registers the app for Audio Capture privacy.
   * The app only appears in System Settings after this runs at least once.
   */
  async probeSystemAudioCapture(): Promise<{ ok: boolean; message?: string }> {
    if (!existsSync(this.sidecarPath)) {
      return {
        ok: false,
        message: "Audio sidecar not built. Run: pnpm sidecar:build",
      };
    }

    try {
      await this.start();
      await this.addAppSource({ bundleId: "com.apple.finder" });
      log.info("system audio capture probe attempted (Finder tap)");
      return { ok: true };
    } catch (err) {
      log.warn("system audio capture probe failed", { err: String(err) });
      return { ok: false, message: String(err) };
    }
  }
}
