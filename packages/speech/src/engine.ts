import { existsSync } from "node:fs";
import {
  TypedEmitter,
  createLogger,
  newSegmentId,
  type PcmFrame,
  type SpeechSegment,
  type TranscriptSegment,
  type PipelineEvents,
  SAMPLE_RATE,
} from "@notetaker/core";
import type { ModelPaths } from "./models.js";
import {
  createParakeetRecognizer,
  createSileroVad,
  importSherpa,
  tryCreateDiarizer,
} from "./sherpa-bindings.js";

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
  silentWindows: number;
}

const VAD_WINDOW_MS = 32;
const VAD_MIN_SPEECH_MS = 400;
const VAD_END_SILENCE_MS = 900;
const VAD_PRE_SPEECH_PAD_MS = 200;
const VAD_REDEMPTION_MS = 200;
const VAD_MAX_UTTERANCE_MS = 30_000;
const MIN_STT_SAMPLES = Math.floor(SAMPLE_RATE * 0.45);
const ENERGY_SPEECH_THRESHOLD = 0.003;
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
      state = { inSpeech: false, speechStartMs: 0, buffer: [], bufferSamples: 0, silentWindows: 0 };
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
        state.silentWindows = 0;
      }

      if (state.inSpeech) {
        if (isSpeech) {
          state.silentWindows = 0;
          state.buffer.push(chunk);
          state.bufferSamples += chunk.length;
        } else {
          state.silentWindows += 1;
        }

        const utteranceMs = frame.tsMs - state.speechStartMs;
        if (utteranceMs >= VAD_MAX_UTTERANCE_MS) {
          this.flushSpeechSegment(frame, state);
          continue;
        }

        const silenceMs = state.silentWindows * VAD_WINDOW_MS;
        if (silenceMs >= VAD_END_SILENCE_MS) {
          const speechDuration = frame.tsMs - state.speechStartMs - silenceMs;
          if (speechDuration >= VAD_MIN_SPEECH_MS) {
            this.flushSpeechSegment(frame, state);
          } else {
            state.inSpeech = false;
            state.buffer = [];
            state.bufferSamples = 0;
            state.silentWindows = 0;
          }
        }
      }
    }
  }

  private flushSpeechSegment(frame: PcmFrame, state: VadState): void {
    const pcm = concatFloat32(state.buffer);
    if (pcm.length < MIN_STT_SAMPLES) {
      state.inSpeech = false;
      state.buffer = [];
      state.bufferSamples = 0;
      state.silentWindows = 0;
      return;
    }
    const segment: SpeechSegment = {
      sourceId: frame.sourceId,
      startMs: state.speechStartMs - VAD_PRE_SPEECH_PAD_MS,
      endMs: frame.tsMs + VAD_REDEMPTION_MS,
      pcm,
      sampleRate: frame.sampleRate,
    };
    this.emit("speech:segment", segment);
    this.enqueueStt(segment);
    state.inSpeech = false;
    state.buffer = [];
    state.bufferSamples = 0;
    state.silentWindows = 0;
  }

  private detectSpeech(chunk: Float32Array): boolean {
    if (chunk.length === 0) return false;
    if (this.sherpa?.vad) {
      try {
        this.sherpa.vad.acceptWaveform(chunk);
        return this.sherpa.vad.isDetected();
      } catch {
        // fall through to energy-based
      }
    }
    return rmsEnergy(chunk) > ENERGY_SPEECH_THRESHOLD;
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
    const text = (await this.runStt(segment.pcm)).trim();
    if (!text) return [];

    const speakers = await this.diarize(segment.pcm, text);

    if (speakers.length === 0) {
      return [this.makeTranscriptSegment(segment, "S1", text, lang)];
    }

    return speakers
      .map((sp, i) => {
        const line = (sp.text || (i === 0 ? text : "")).trim();
        if (!line) return null;
        return this.makeTranscriptSegment(
          segment,
          sp.speakerId,
          line,
          lang,
          sp.startMs,
          sp.endMs,
        );
      })
      .filter((seg): seg is TranscriptSegment => seg !== null);
  }

  private makeTranscriptSegment(
    segment: SpeechSegment,
    speakerId: string,
    text: string,
    lang: string,
    startMs?: number,
    endMs?: number,
  ): TranscriptSegment {
    return {
      id: newSegmentId(),
      sessionId: this.opts.sessionId,
      sourceId: segment.sourceId,
      speakerId,
      startMs: startMs ?? segment.startMs,
      endMs: endMs ?? segment.endMs,
      text,
      lang,
    };
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

  private async runStt(pcm: Float32Array): Promise<string> {
    if (this.sherpa?.parakeet) {
      try {
        return this.sherpa.parakeet.transcribe(pcm);
      } catch (err) {
        log.warn("parakeet stt error", { err: String(err) });
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
  vad?: { acceptWaveform: (pcm: Float32Array) => void; isDetected: () => boolean };
  parakeet?: { transcribe: (pcm: Float32Array) => string };
  langId?: { detect: (pcm: Float32Array) => string };
  diarizer?: { process: (pcm: Float32Array) => DiarizeResult[] };
}

async function loadSherpa(paths: ModelPaths): Promise<SherpaModules | null> {
  if (!existsSync(paths.vad)) {
    log.warn("VAD model not found", { path: paths.vad });
    return null;
  }

  try {
    const sherpa = await importSherpa();
    let vad: SherpaModules["vad"] | undefined;
    try {
      vad = createSileroVad(sherpa, paths.vad);
    } catch (err) {
      log.warn("silero VAD init failed, using energy-based detection", { err: String(err) });
    }

    let parakeet: SherpaModules["parakeet"];
    if (existsSync(paths.parakeet)) {
      try {
        parakeet = createParakeetRecognizer(sherpa, paths.parakeet);
      } catch (err) {
        log.warn("parakeet model load failed", { err: String(err) });
      }
    }

    const diarizer =
      existsSync(paths.diarization) ? tryCreateDiarizer(sherpa, paths.diarization) ?? undefined : undefined;

    return { ...(vad ? { vad } : {}), parakeet, diarizer };
  } catch (err) {
    log.warn("failed to load sherpa-onnx-node", { err: String(err) });
    return null;
  }
}

function rmsEnergy(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
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
