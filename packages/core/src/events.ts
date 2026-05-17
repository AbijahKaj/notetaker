import { EventEmitter } from "node:events";
import type { PcmFrame, SpeechSegment, TranscriptSegment, Session } from "./types.js";

export type PipelineEvents = {
  "audio:frame": [PcmFrame];
  "audio:source:added": [{ sourceId: string }];
  "audio:source:removed": [{ sourceId: string }];
  "speech:segment": [SpeechSegment];
  "transcript:segment": [TranscriptSegment];
  "session:opened": [Session];
  "session:closed": [Session];
  "session:idle": [{ sessionId: string }];
  "error": [{ where: string; error: unknown }];
};

export class TypedEmitter<T extends Record<string, unknown[]>> extends EventEmitter {
  override on<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof T & string>(event: K, ...args: T[K]): boolean {
    return super.emit(event, ...args);
  }
}
