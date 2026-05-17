declare module "sherpa-onnx-node" {
  export class Vad {
    constructor(opts: Record<string, unknown>);
    acceptWaveform(pcm: Float32Array): void;
    isDetected(): boolean;
    isSpeechDetected(): boolean;
  }
  export class SileroVad extends Vad {}
  export class OfflineRecognizer {
    constructor(opts: Record<string, unknown>);
    decode(pcm: Float32Array, opts?: Record<string, unknown>): { text?: string };
  }
  export class Recognizer extends OfflineRecognizer {}
  export class SpokenLanguageIdentification {
    constructor(opts: Record<string, unknown>);
    compute(pcm: Float32Array): { lang?: string; language?: string };
  }
  export class LangId extends SpokenLanguageIdentification {}
  export class OfflineSpeakerDiarization {
    constructor(opts: Record<string, unknown>);
    process(pcm: Float32Array): { segments?: { speakerId?: string; text?: string; startMs?: number; endMs?: number }[] };
  }
  export class Diarizer extends OfflineSpeakerDiarization {}
}
