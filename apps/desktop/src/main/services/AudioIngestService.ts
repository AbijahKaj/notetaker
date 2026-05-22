import { app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { AudioBridge, sourceKey } from "@notetaker/audio-bridge";
import { TypedEmitter, createLogger, type PipelineEvents, type SourceSpec } from "@notetaker/core";

const log = createLogger("audio-ingest");

const SIDECAR_APP_NAME = "NoteTaker Audio Tap.app";

type AudioIngestEvents = PipelineEvents & {
  "sidecar:crashed": [];
};

export class AudioIngestService extends TypedEmitter<AudioIngestEvents> {
  private bridge: AudioBridge | null = null;
  private sidecarPath: string;
  private micPreviewRefCount = 0;
  private listeningActive = false;
  private micCaptureActive = false;
  private restarting = false;
  private meetingSpecs = new Map<string, SourceSpec>();

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

  private attachBridgeHandlers(bridge: AudioBridge): void {
    bridge.on("audio:frame", (frame) => this.emit("audio:frame", frame));
    bridge.on("audio:source:added", (ev) => this.emit("audio:source:added", ev));
    bridge.on("audio:source:removed", (ev) => this.emit("audio:source:removed", ev));
    bridge.on("sidecar:exit", ({ unexpected }) => {
      if (unexpected) void this.restartAfterCrash();
    });
  }

  private async createBridge(): Promise<AudioBridge> {
    const bridge = new AudioBridge(this.sidecarPath);
    this.attachBridgeHandlers(bridge);
    await bridge.start();
    this.bridge = bridge;
    return bridge;
  }

  async ensureMicCapture(): Promise<boolean> {
    if (!existsSync(this.sidecarPath)) {
      log.warn("audio sidecar not built");
      return false;
    }

    try {
      if (!this.bridge?.isRunning()) {
        await this.createBridge();
      }
      if (!this.micCaptureActive) {
        await this.bridge!.addMicSource();
        this.micCaptureActive = true;
        log.info("mic capture started");
      }
      return true;
    } catch (err) {
      log.warn("mic capture unavailable", { err: String(err) });
      return false;
    }
  }

  /**
   * Release the mic if neither listening nor preview is holding it.
   * The bridge stays up to keep meeting-source state alive without re-handshake.
   */
  async releaseMicIfIdle(): Promise<void> {
    if (this.listeningActive) return;
    if (this.micPreviewRefCount > 0) return;
    if (!this.micCaptureActive || !this.bridge?.isRunning()) {
      this.micCaptureActive = false;
      return;
    }
    try {
      await this.bridge.removeByKey("mic");
    } catch (err) {
      log.warn("mic release failed", { err: String(err) });
    }
    this.micCaptureActive = false;
    log.info("mic capture stopped");
  }

  async shutdown(): Promise<void> {
    this.micCaptureActive = false;
    this.listeningActive = false;
    this.meetingSpecs.clear();
    await this.bridge?.stop();
    this.bridge = null;
  }

  private async restartAfterCrash(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    this.emit("sidecar:crashed");
    log.warn("restarting audio sidecar after crash");

    const restoreMic = this.micCaptureActive;
    const restoreMeetings = [...this.meetingSpecs.entries()];
    this.bridge = null;
    this.micCaptureActive = false;

    try {
      const bridge = await this.createBridge();
      if (restoreMic) {
        await bridge.addMicSource();
        this.micCaptureActive = true;
      }
      for (const [, spec] of restoreMeetings) {
        await this.addSpecToBridge(spec, bridge);
      }
      log.info("audio sidecar restarted");
    } catch (err) {
      log.error("audio sidecar restart failed", { err: String(err) });
    } finally {
      this.restarting = false;
    }
  }

  private async addSpecToBridge(spec: SourceSpec, bridge: AudioBridge = this.bridge!): Promise<void> {
    if (spec.kind === "app") {
      await bridge.addAppSource(spec.bundleId);
    } else if (spec.kind === "browser") {
      await bridge.addBrowserSource(spec.bundleId, spec.matchedSite);
    }
  }

  setListeningActive(active: boolean): void {
    this.listeningActive = active;
  }

  isMicCaptureActive(): boolean {
    return this.micCaptureActive;
  }

  async addAppSource({ bundleId }: { bundleId: string }): Promise<void> {
    if (!this.bridge?.isRunning()) await this.ensureMicCapture();
    const spec: SourceSpec = { kind: "app", bundleId };
    this.meetingSpecs.set(sourceKey(spec), spec);
    await this.bridge?.addAppSource(bundleId);
  }

  async removeAppSource({ bundleId }: { bundleId: string }): Promise<void> {
    const spec: SourceSpec = { kind: "app", bundleId };
    const key = sourceKey(spec);
    await this.bridge?.removeByKey(key);
    this.meetingSpecs.delete(key);
  }

  async addBrowserSource({ bundleId, matchedSite }: { bundleId: string; matchedSite: string }): Promise<void> {
    if (!this.bridge?.isRunning()) await this.ensureMicCapture();
    const spec: SourceSpec = { kind: "browser", bundleId, matchedSite };
    this.meetingSpecs.set(sourceKey(spec), spec);
    await this.bridge?.addBrowserSource(bundleId, matchedSite);
  }

  async removeBrowserSource({ bundleId }: { bundleId: string }): Promise<void> {
    const key = sourceKey({ kind: "browser", bundleId, matchedSite: "" });
    await this.bridge?.removeByKey(key);
    this.meetingSpecs.delete(key);
  }

  async removeAllMeetingSources(): Promise<void> {
    for (const key of [...this.meetingSpecs.keys()]) {
      await this.bridge?.removeByKey(key);
      this.meetingSpecs.delete(key);
    }
  }

  async startMicPreview(): Promise<void> {
    this.micPreviewRefCount += 1;
    if (this.micPreviewRefCount > 1) return;
    await this.ensureMicCapture();
  }

  async stopMicPreview(): Promise<void> {
    if (this.micPreviewRefCount <= 0) return;
    this.micPreviewRefCount -= 1;
    if (this.micPreviewRefCount === 0) {
      await this.releaseMicIfIdle();
    }
  }

  async probeSystemAudioCapture(): Promise<{ ok: boolean; message?: string }> {
    if (!existsSync(this.sidecarPath)) {
      return {
        ok: false,
        message: "Audio sidecar not built. Run: pnpm sidecar:build",
      };
    }

    try {
      await this.ensureMicCapture();
      await this.addAppSource({ bundleId: "com.apple.finder" });
      await this.removeAppSource({ bundleId: "com.apple.finder" });
      log.info("system audio capture probe attempted (Finder tap)");
      return { ok: true };
    } catch (err) {
      log.warn("system audio capture probe failed", { err: String(err) });
      return { ok: false, message: String(err) };
    }
  }
}
