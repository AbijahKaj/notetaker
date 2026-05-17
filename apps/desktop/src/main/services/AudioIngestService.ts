import { app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { AudioBridge } from "@notetaker/audio-bridge";
import { TypedEmitter, createLogger, type PipelineEvents } from "@notetaker/core";

const log = createLogger("audio-ingest");

export class AudioIngestService extends TypedEmitter<PipelineEvents> {
  private bridge: AudioBridge | null = null;
  private sidecarPath: string;

  constructor() {
    super();
    this.sidecarPath = this.resolveSidecarPath();
  }

  private resolveSidecarPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, "audio-tap");
    }
    const devPath = join(
      app.getAppPath(),
      "../../native/audio-tap/.build/release/audio-tap",
    );
    if (existsSync(devPath)) return devPath;
    return join(app.getAppPath(), "../../native/audio-tap/.build/release/audio-tap");
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
}
