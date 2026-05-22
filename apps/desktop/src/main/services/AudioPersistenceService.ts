import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PcmFrame } from "@notetaker/core";
import { createLogger } from "@notetaker/core";

const log = createLogger("audio-persist");

/** Appends float32 PCM frames to per-session raw audio files (local debugging / optional retention). */
export class AudioPersistenceService {
  private dir: string;
  private streams = new Map<string, ReturnType<typeof createWriteStream>>();
  private enabled = false;
  private sessionId: string | null = null;

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, "audio");
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.closeAll();
  }

  setSessionId(sessionId: string | null): void {
    if (this.sessionId === sessionId) return;
    this.closeAll();
    this.sessionId = sessionId;
  }

  writeFrame(frame: PcmFrame): void {
    if (!this.enabled || !this.sessionId) return;

    const key = `${this.sessionId}/${frame.sourceId}.f32le`;
    let stream = this.streams.get(key);
    if (!stream) {
      const folder = join(this.dir, this.sessionId);
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
      stream = createWriteStream(join(folder, `${frame.sourceId}.f32le`), { flags: "a" });
      this.streams.set(key, stream);
      log.info("persisting audio", { sessionId: this.sessionId, sourceId: frame.sourceId });
    }

    stream.write(Buffer.from(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength));
  }

  closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.end();
    }
    this.streams.clear();
  }
}
