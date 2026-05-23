import { SpeechEngine } from "@notetaker/speech";
import { resolveModelPaths } from "@notetaker/speech";
import { TypedEmitter, createLogger, type PcmFrame, type PipelineEvents } from "@notetaker/core";
import type { ModelManager } from "./ModelManager.js";

const log = createLogger("speech-service");

export class SpeechService extends TypedEmitter<PipelineEvents> {
  private engine: SpeechEngine | null = null;
  private models: ModelManager;
  private sessionId = "";

  constructor(models: ModelManager) {
    super();
    this.models = models;
  }

  async start(): Promise<void> {
    const modelsDir = this.models.getModelsDir();
    const modelPaths = resolveModelPaths(modelsDir);
    this.engine = new SpeechEngine({
      modelsDir,
      modelPaths,
      sessionId: this.sessionId,
    });
    this.engine.on("transcript:segment", (seg) => this.emit("transcript:segment", seg));
    this.engine.on("error", (ev) => this.emit("error", ev));
    await this.engine.start();
    log.info("speech service started", { sttReady: this.engine.isSttReady() });
  }

  isSttReady(): boolean {
    return this.engine?.isSttReady() ?? false;
  }

  getNotReadyReason(): string | null {
    return this.engine?.getNotReadyReason() ?? null;
  }

  async stop(): Promise<void> {
    await this.engine?.stop();
    this.engine = null;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.engine?.setSessionId(sessionId);
  }

  setTimelineOrigin(ms: number): void {
    this.engine?.setTimelineOrigin(ms);
  }

  feed(frame: PcmFrame): void {
    this.engine?.feed(frame);
  }
}
