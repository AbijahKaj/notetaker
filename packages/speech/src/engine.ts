import { existsSync } from "node:fs";
import {
  TypedEmitter,
  createLogger,
  newSegmentId,
  isParakeetLanguage,
  type PcmFrame,
  type SpeechSegment,
  type TranscriptSegment,
  type PipelineEvents,
  SAMPLE_RATE,
} from "@notetaker/core";
import type { ModelPaths } from "./models.js";

const log = createLogger("speech");

export interface SpeechEngineOptions {
  modelsDir: string;
  modelPaths: ModelPaths;
  sessionId: string;
}

interface VadState {
  inSpeech: boolean;
  speechStartMs: number;
  buffer: Float32Array[];
  bufferSamples: number;
}

const VAD_WINDOW_MS = 32;
const VAD_MIN_SPEECH_MS = 300;
const VAD_PRE_SPEECH_PAD_MS = 300;
const VAD_REDEMPTION_MS = 400;
const LANG_DETECT_SAMPLES = SAMPLE_RATE * 3;

export class SpeechEngine extends TypedEmitter<PipelineEvents> {
  private opts: SpeechEngineOptions;
  private running = false;
  private sessionLang: string | null = null;
  private vadStates = new Map<string, VadState>();
  private sherpa: SherpaModules | null = null;
  private sttQueue: SpeechSegment[] = [];
  private sttProcessing = false;

  constructor(opts: SpeechEngineOptions) {
    super();
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.running) return;
    try {
      this.sherpa = await loadSherpa(this.opts.modelPaths);
      this.running = true;
      log.info("speech engine started");
    } catch (err) {
      log.warn("sherpa-onnx not available, using stub mode", { err: String(err) });
      this.sherpa = null;
      this.running = true;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.vadStates.clear();
    this.sttQueue = [];
    this.sherpa = null;
    log.info("speech engine stopped");
  }

  setSessionId(sessionId: string): void {
    this.opts.sessionId = sessionId;
    this.sessionLang = null;
  }

  feed(frame: PcmFrame): void {
    if (!this.running) return;
    this.processVad(frame);
  }

  private processVad(frame: PcmFrame): void {
    let state = this.vadStates.get(frame.sourceId);
    if (!state) {
      state = { inSpeech: false, speechStartMs: 0, buffer: [], bufferSamples: 0 };
      this.vadStates.set(frame.sourceId, state);
    }

    const windowSamples = Math.floor((VAD_WINDOW_MS / 1000) * frame.sampleRate);
    let offset = 0;

    while (offset < frame.pcm.length) {
      const chunk = frame.pcm.subarray(offset, offset + windowSamples);
      offset += windowSamples;

      const isSpeech = this.detectSpeech(chunk);

      if (isSpeech && !state.inSpeech) {
        state.inSpeech = true;
        state.speechStartMs = frame.tsMs;
        state.buffer = [];
        state.bufferSamples = 0;
      }

      if (state.inSpeech) {
        state.buffer.push(chunk);
        state.bufferSamples += chunk.length;
      }

      if (!isSpeech && state.inSpeech) {
        const speechDuration = frame.tsMs - state.speechStartMs;
        if (speechDuration >= VAD_MIN_SPEECH_MS) {
          const pcm = concatFloat32(state.buffer);
          const segment: SpeechSegment = {
            sourceId: frame.sourceId,
            startMs: state.speechStartMs - VAD_PRE_SPEECH_PAD_MS,
            endMs: frame.tsMs + VAD_REDEMPTION_MS,
            pcm,
            sampleRate: frame.sampleRate,
          };
          this.emit("speech:segment", segment);
          this.enqueueStt(segment);
        }
        state.inSpeech = false;
        state.buffer = [];
        state.bufferSamples = 0;
      }
    }
  }

  private detectSpeech(chunk: Float32Array): boolean {
    if (this.sherpa?.vad) {
      try {
        this.sherpa.vad.acceptWaveform(chunk);
        return this.sherpa.vad.isDetected();
      } catch {
        // fall through to energy-based
      }
    }
    return rmsEnergy(chunk) > 0.01;
  }

  private enqueueStt(segment: SpeechSegment): void {
    this.sttQueue.push(segment);
    if (!this.sttProcessing) void this.processSttQueue();
  }

  private async processSttQueue(): Promise<void> {
    this.sttProcessing = true;
    while (this.sttQueue.length > 0) {
      const segment = this.sttQueue.shift()!;
      try {
        const results = await this.transcribe(segment);
        for (const seg of results) {
          this.emit("transcript:segment", seg);
        }
      } catch (err) {
        log.error("stt failed", { err: String(err) });
        this.emit("error", { where: "stt", error: err });
      }
    }
    this.sttProcessing = false;
  }

  private async transcribe(segment: SpeechSegment): Promise<TranscriptSegment[]> {
    const lang = await this.detectLanguage(segment.pcm);
    const useParakeet = isParakeetLanguage(lang);
    const text = await this.runStt(segment.pcm, useParakeet ? "parakeet" : "whisper", lang);
    const speakers = await this.diarize(segment.pcm, text);

    if (speakers.length === 0) {
      return [{
        id: newSegmentId(),
        sessionId: this.opts.sessionId,
        sourceId: segment.sourceId,
        speakerId: "S1",
        startMs: segment.startMs,
        endMs: segment.endMs,
        text,
        lang,
      }];
    }

    return speakers.map((sp, i) => ({
      id: newSegmentId(),
      sessionId: this.opts.sessionId,
      sourceId: segment.sourceId,
      speakerId: sp.speakerId,
      startMs: sp.startMs ?? segment.startMs,
      endMs: sp.endMs ?? segment.endMs,
      text: sp.text || (i === 0 ? text : ""),
      lang,
    }));
  }

  private async detectLanguage(pcm: Float32Array): Promise<string> {
    if (this.sessionLang) return this.sessionLang;
    const sample = pcm.subarray(0, Math.min(pcm.length, LANG_DETECT_SAMPLES));

    if (this.sherpa?.langId) {
      try {
        const lang = this.sherpa.langId.detect(sample) as string;
        this.sessionLang = lang;
        return lang;
      } catch {
        // fall through
      }
    }

    this.sessionLang = "en";
    return "en";
  }

  private async runStt(
    pcm: Float32Array,
    engine: "parakeet" | "whisper",
    lang: string,
  ): Promise<string> {
    if (this.sherpa) {
      try {
        if (engine === "parakeet" && this.sherpa.parakeet) {
          return this.sherpa.parakeet.transcribe(pcm) as string;
        }
        if (engine === "whisper" && this.sherpa.whisper) {
          return this.sherpa.whisper.transcribe(pcm, { language: lang }) as string;
        }
        if (this.sherpa.parakeet) {
          return this.sherpa.parakeet.transcribe(pcm) as string;
        }
      } catch (err) {
        log.warn("stt engine error", { engine, err: String(err) });
      }
    }
    return `[transcription pending — install models via pnpm models:download]`;
  }

  private async diarize(
    pcm: Float32Array,
    text: string,
  ): Promise<{ speakerId: string; text: string; startMs?: number; endMs?: number }[]> {
    if (this.sherpa?.diarizer) {
      try {
        const result = this.sherpa.diarizer.process(pcm) as DiarizeResult[];
        if (result.length > 0) return result;
      } catch (err) {
        log.warn("diarization error", { err: String(err) });
      }
    }
    return [{ speakerId: "S1", text }];
  }
}

interface DiarizeResult {
  speakerId: string;
  text: string;
  startMs?: number;
  endMs?: number;
}

interface SherpaModules {
  vad: { acceptWaveform: (pcm: Float32Array) => void; isDetected: () => boolean };
  parakeet?: { transcribe: (pcm: Float32Array) => string };
  whisper?: { transcribe: (pcm: Float32Array, opts: { language: string }) => string };
  langId?: { detect: (pcm: Float32Array) => string };
  diarizer?: { process: (pcm: Float32Array) => DiarizeResult[] };
}

async function loadSherpa(paths: ModelPaths): Promise<SherpaModules | null> {
  if (!existsSync(paths.vad)) {
    log.warn("VAD model not found", { path: paths.vad });
    return null;
  }

  try {
    const sherpa = await import("sherpa-onnx-node");
    const vad = createVad(sherpa, paths.vad);
    const parakeet = existsSync(paths.parakeet)
      ? createRecognizer(sherpa, paths.parakeet, "parakeet")
      : undefined;
    const whisper =
      paths.whisper && existsSync(paths.whisper)
        ? createRecognizer(sherpa, paths.whisper, "whisper")
        : undefined;
    const langId =
      paths.langId && existsSync(paths.langId)
        ? createLangId(sherpa, paths.langId)
        : undefined;
    const diarizer = existsSync(paths.diarization)
      ? createDiarizer(sherpa, paths.diarization)
      : undefined;

    return { vad, parakeet, whisper, langId, diarizer };
  } catch (err) {
    log.warn("failed to load sherpa-onnx-node", { err: String(err) });
    return null;
  }
}

function createVad(sherpa: typeof import("sherpa-onnx-node"), modelPath: string): SherpaModules["vad"] {
  const Vad = sherpa.Vad ?? sherpa.SileroVad;
  if (!Vad) throw new Error("VAD not available in sherpa-onnx-node");
  const instance = new Vad({ model: modelPath, threshold: 0.5, minSilenceDuration: 0.25 });
  return {
    acceptWaveform: (pcm: Float32Array) => instance.acceptWaveform(pcm),
    isDetected: () => instance.isDetected?.() ?? instance.isSpeechDetected?.() ?? false,
  };
}

function createRecognizer(
  sherpa: typeof import("sherpa-onnx-node"),
  modelPath: string,
  _type: "parakeet" | "whisper",
): { transcribe: (pcm: Float32Array, opts?: { language: string }) => string } {
  const Recognizer = sherpa.OfflineRecognizer ?? sherpa.Recognizer;
  if (!Recognizer) throw new Error("Recognizer not available");
  const instance = new Recognizer({ model: modelPath, numThreads: 4 });
  return {
    transcribe: (pcm: Float32Array, opts?: { language: string }) => {
      const result = instance.decode(pcm, opts?.language ? { language: opts.language } : {});
      return result?.text ?? "";
    },
  };
}

function createLangId(sherpa: typeof import("sherpa-onnx-node"), modelPath: string): { detect: (pcm: Float32Array) => string } {
  const LangId = sherpa.SpokenLanguageIdentification ?? sherpa.LangId;
  if (!LangId) throw new Error("LangId not available");
  const instance = new LangId({ model: modelPath });
  return {
    detect: (pcm: Float32Array) => {
      const result = instance.compute(pcm);
      return result?.lang ?? result?.language ?? "en";
    },
  };
}

function createDiarizer(sherpa: typeof import("sherpa-onnx-node"), modelPath: string): { process: (pcm: Float32Array) => DiarizeResult[] } {
  const Diarizer = sherpa.OfflineSpeakerDiarization ?? sherpa.Diarizer;
  if (!Diarizer) throw new Error("Diarizer not available");
  const instance = new Diarizer({ model: modelPath });
  return {
    process: (pcm: Float32Array) => {
      const result = instance.process(pcm);
      return (result?.segments ?? []).map((s, i) => ({
        speakerId: s.speakerId ?? `S${i + 1}`,
        text: s.text ?? "",
        startMs: s.startMs,
        endMs: s.endMs,
      }));
    },
  };
}

function rmsEnergy(pcm: Float32Array): number {
  let sum = 0;
  for (const s of pcm) sum += s * s;
  return Math.sqrt(sum / pcm.length);
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
