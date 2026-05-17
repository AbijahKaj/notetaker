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
import { PCM_HEADER_SIZE, type SidecarCommand, type SidecarEvent, type SidecarSource } from "./protocol.js";

const log = createLogger("audio-bridge");

interface ActiveSource {
  sourceId: string;
  spec: SourceSpec;
}

export class AudioBridge extends TypedEmitter<PipelineEvents> {
  private sidecar: ChildProcess | null = null;
  private server: Server | null = null;
  private socketPath = "";
  private client: Socket | null = null;
  private sources = new Map<string, ActiveSource>();
  private running = false;
  private sidecarBinary: string;

  constructor(sidecarBinary: string) {
    super();
    this.sidecarBinary = sidecarBinary;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.socketPath = join(tmpdir(), `notetaker-${randomBytes(8).toString("hex")}.sock`);
    if (existsSync(this.socketPath)) unlink(this.socketPath, () => {});

    await this.startSocketServer();
    await this.spawnSidecar();
    this.running = true;
    log.info("audio bridge started", { socketPath: this.socketPath });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.sendCommand({ cmd: "stop" });
    this.sidecar?.kill("SIGTERM");
    this.sidecar = null;
    this.client?.destroy();
    this.client = null;
    this.server?.close();
    this.server = null;
    if (existsSync(this.socketPath)) unlink(this.socketPath, () => {});
    this.sources.clear();
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

  async removeSource(sourceId: string): Promise<void> {
    if (!this.sources.has(sourceId)) return;
    this.sendCommand({ cmd: "remove", sourceId });
  }

  private async addSource(sidecarSource: SidecarSource, spec: SourceSpec): Promise<string> {
    const sourceId = newSourceId(spec.kind);
    this.sources.set(sourceId, { sourceId, spec });
    this.sendCommand({ cmd: "add", source: sidecarSource, sourceId });
    return sourceId;
  }

  private handleSidecarEvent(evt: SidecarEvent): void {
    if (evt.type === "source:started") {
      if (this.sources.has(evt.sourceId)) {
        this.emit("audio:source:added", { sourceId: evt.sourceId });
      }
    } else if (evt.type === "source:stopped") {
      if (this.sources.delete(evt.sourceId)) {
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
          while (headerBuf.length >= PCM_HEADER_SIZE) {
            const sourceIdLen = headerBuf.readUInt8(0);
            const sourceId = headerBuf.subarray(1, 1 + sourceIdLen).toString("utf8");
            const tsMs = Number(headerBuf.readBigUInt64BE(1 + sourceIdLen));
            const sampleCount = headerBuf.readUInt32BE(9 + sourceIdLen);
            const totalSize = PCM_HEADER_SIZE + sampleCount * 4;
            if (headerBuf.length < totalSize) break;

            const pcmBuf = headerBuf.subarray(PCM_HEADER_SIZE, totalSize);
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

      this.sidecar.on("exit", (code) => {
        log.info("sidecar exited", { code });
        if (!ready) {
          clearTimeout(timeout);
          reject(new Error(`Sidecar exited with code ${code}`));
        }
      });
    });
  }

  private sendCommand(cmd: SidecarCommand): void {
    if (!this.sidecar?.stdin?.writable) return;
    const line = JSON.stringify(cmd) + "\n";
    this.sidecar.stdin.write(line);
  }
}
