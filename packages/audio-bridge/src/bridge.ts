import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { unlink, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  TypedEmitter,
  createLogger,
  newSourceId,
  type PcmFrame,
  type SourceSpec,
  SAMPLE_RATE,
  type PipelineEvents,
} from "@notetaker/core";
import {
  PCM_HEADER_MIN_SIZE,
  pcmFrameHeaderSize,
  type SidecarCommand,
  type SidecarEvent,
  type SidecarSource,
} from "./protocol.js";

const log = createLogger("audio-bridge");

type BridgeEvents = PipelineEvents & {
  "sidecar:exit": [{ code: number | null; signal: NodeJS.Signals | null; unexpected: boolean }];
};

interface ActiveSource {
  sourceId: string;
  spec: SourceSpec;
}

export function sourceKey(spec: SourceSpec): string {
  if (spec.kind === "mic") return "mic";
  if (spec.kind === "app") return `app:${spec.bundleId}`;
  return `browser:${spec.bundleId}`;
}

export class AudioBridge extends TypedEmitter<BridgeEvents> {
  private sidecar: ChildProcess | null = null;
  private server: Server | null = null;
  private socketPath = "";
  private client: Socket | null = null;
  private sources = new Map<string, ActiveSource>();
  private sourceByKey = new Map<string, string>();
  private running = false;
  private sidecarBinary: string;
  private intentionalStop = false;

  constructor(sidecarBinary: string) {
    super();
    this.sidecarBinary = sidecarBinary;
  }

  isRunning(): boolean {
    return this.running;
  }

  getSourceKeys(): string[] {
    return [...this.sourceByKey.keys()];
  }

  getSpecForKey(key: string): SourceSpec | null {
    const sourceId = this.sourceByKey.get(key);
    if (!sourceId) return null;
    return this.sources.get(sourceId)?.spec ?? null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.intentionalStop = false;
    this.socketPath = join(tmpdir(), `notetaker-${randomBytes(8).toString("hex")}.sock`);
    if (existsSync(this.socketPath)) unlink(this.socketPath, () => {});

    await this.startSocketServer();
    await this.spawnSidecar();
    this.running = true;
    log.info("audio bridge started", { socketPath: this.socketPath });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.intentionalStop = true;
    this.sendCommand({ cmd: "stop" });
    this.sidecar?.kill("SIGTERM");
    this.sidecar = null;
    this.client?.destroy();
    this.client = null;
    this.server?.close();
    this.server = null;
    if (existsSync(this.socketPath)) unlink(this.socketPath, () => {});
    this.sources.clear();
    this.sourceByKey.clear();
    this.running = false;
    log.info("audio bridge stopped");
  }

  async addMicSource(): Promise<string> {
    return this.addSource({ type: "mic" }, { kind: "mic" });
  }

  async addAppSource(bundleId: string): Promise<string> {
    return this.addSource({ type: "app", bundleId }, { kind: "app", bundleId });
  }

  async addBrowserSource(bundleId: string, matchedSite: string): Promise<string> {
    return this.addSource(
      { type: "browser", bundleId, matchedSite },
      { kind: "browser", bundleId, matchedSite },
    );
  }

  async removeByKey(key: string): Promise<void> {
    const sourceId = this.sourceByKey.get(key);
    if (!sourceId) return;
    this.sendCommand({ cmd: "remove", sourceId });
  }

  async removeSource(sourceId: string): Promise<void> {
    if (!this.sources.has(sourceId)) return;
    this.sendCommand({ cmd: "remove", sourceId });
  }

  private async addSource(sidecarSource: SidecarSource, spec: SourceSpec): Promise<string> {
    const key = sourceKey(spec);
    const existing = this.sourceByKey.get(key);
    if (existing) return existing;

    const sourceId = newSourceId(spec.kind);
    this.sources.set(sourceId, { sourceId, spec });
    this.sourceByKey.set(key, sourceId);
    this.sendCommand({ cmd: "add", source: sidecarSource, sourceId });
    return sourceId;
  }

  private dropSource(sourceId: string): void {
    const entry = this.sources.get(sourceId);
    if (!entry) return;
    this.sources.delete(sourceId);
    this.sourceByKey.delete(sourceKey(entry.spec));
  }

  private handleSidecarEvent(evt: SidecarEvent): void {
    if (evt.type === "source:started") {
      if (this.sources.has(evt.sourceId)) {
        this.emit("audio:source:added", { sourceId: evt.sourceId });
      }
    } else if (evt.type === "source:stopped") {
      if (this.sources.has(evt.sourceId)) {
        this.dropSource(evt.sourceId);
        this.emit("audio:source:removed", { sourceId: evt.sourceId });
      }
    } else if (evt.type === "error") {
      log.error("sidecar error", { message: evt.message });
    }
  }

  private startSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.client = socket;
        let headerBuf = Buffer.alloc(0);

        socket.on("data", (chunk) => {
          headerBuf = Buffer.concat([headerBuf, chunk]);
          while (headerBuf.length >= PCM_HEADER_MIN_SIZE) {
            const sourceIdLen = headerBuf.readUInt8(0);
            const headerSize = pcmFrameHeaderSize(sourceIdLen);
            if (headerBuf.length < headerSize) break;

            const sourceId = headerBuf.subarray(1, 1 + sourceIdLen).toString("utf8");
            const tsMs = Number(headerBuf.readBigUInt64BE(1 + sourceIdLen));
            const sampleCount = headerBuf.readUInt32BE(9 + sourceIdLen);
            const totalSize = headerSize + sampleCount * 4;
            if (headerBuf.length < totalSize) break;

            const pcmBuf = headerBuf.subarray(headerSize, totalSize);
            const pcm = new Float32Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
              pcm[i] = pcmBuf.readFloatLE(i * 4);
            }

            const source = this.sources.get(sourceId);
            if (source) {
              const frame: PcmFrame = {
                sourceId,
                sourceSpec: source.spec,
                sampleRate: SAMPLE_RATE,
                pcm,
                tsMs,
              };
              this.emit("audio:frame", frame);
            }

            headerBuf = headerBuf.subarray(totalSize);
          }
        });
      });

      this.server.listen(this.socketPath, () => resolve());
      this.server.on("error", reject);
    });
  }

  private spawnSidecar(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sidecar = spawn(this.sidecarBinary, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let ready = false;
      const timeout = setTimeout(() => {
        if (!ready) reject(new Error("Sidecar startup timeout"));
      }, 10_000);

      this.sidecar.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString("utf8").split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const evt = JSON.parse(line) as SidecarEvent | { type: "ready" };
            if (evt.type === "ready") {
              ready = true;
              clearTimeout(timeout);
              this.sendCommand({ cmd: "start", socketPath: this.socketPath });
              resolve();
            } else {
              this.handleSidecarEvent(evt as SidecarEvent);
            }
          } catch {
            log.debug("sidecar stdout", { line });
          }
        }
      });

      this.sidecar.stderr?.on("data", (data: Buffer) => {
        log.warn("sidecar stderr", { msg: data.toString("utf8") });
      });

      this.sidecar.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.sidecar.on("exit", (code, signal) => {
        const unexpected = !this.intentionalStop && ready;
        log.error("sidecar exited", { code, signal, unexpected });
        this.running = false;
        this.sidecar = null;
        if (!ready) {
          clearTimeout(timeout);
          reject(new Error(`Sidecar exited with code ${code}`));
          return;
        }
        this.emit("sidecar:exit", { code, signal, unexpected });
      });
    });
  }

  private sendCommand(cmd: SidecarCommand): void {
    if (!this.sidecar?.stdin?.writable) return;
    const line = JSON.stringify(cmd) + "\n";
    this.sidecar.stdin.write(line);
  }
}
