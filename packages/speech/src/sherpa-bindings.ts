import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@notetaker/core";

const log = createLogger("speech");

export type SherpaModule = {
  Vad: new (config: Record<string, unknown>, bufferSizeInSeconds: number) => {
    acceptWaveform: (samples: Float32Array) => void;
    isDetected: () => boolean;
  };
  OfflineRecognizer: new (config: Record<string, unknown>) => {
    createStream: () => {
      acceptWaveform: (wave: { samples: Float32Array; sampleRate: number }) => void;
    };
    decode: (stream: { acceptWaveform: (wave: { samples: Float32Array; sampleRate: number }) => void }) => void;
    getResult: (stream: unknown) => { text?: string };
  };
  OfflineSpeakerDiarization?: new (config: Record<string, unknown>) => {
    process: (pcm: Float32Array) => { segments?: { speakerId?: string; text?: string; startMs?: number; endMs?: number }[] };
  };
};

export async function importSherpa(): Promise<SherpaModule> {
  const mod = (await import("sherpa-onnx-node")) as unknown as { default?: SherpaModule } & SherpaModule;
  const sherpa = (mod.default ?? mod) as SherpaModule;
  if (!sherpa.Vad || !sherpa.OfflineRecognizer) {
    throw new Error("sherpa-onnx-node missing Vad or OfflineRecognizer");
  }
  return sherpa;
}

export function createSileroVad(
  sherpa: SherpaModule,
  modelPath: string,
): { acceptWaveform: (pcm: Float32Array) => void; isDetected: () => boolean } {
  const instance = new sherpa.Vad(
    {
      sileroVad: {
        model: modelPath,
        threshold: 0.45,
        minSilenceDuration: 0.25,
        minSpeechDuration: 0.15,
      },
      sampleRate: 16_000,
      numThreads: 1,
    },
    30,
  );
  return {
    acceptWaveform: (pcm) => instance.acceptWaveform(pcm),
    isDetected: () => instance.isDetected(),
  };
}

function findModelFile(dir: string, pattern: RegExp): string | undefined {
  try {
    return readdirSync(dir).find((name) => pattern.test(name));
  } catch {
    return undefined;
  }
}

export function createParakeetRecognizer(
  sherpa: SherpaModule,
  modelDir: string,
): { transcribe: (pcm: Float32Array) => string } {
  const tokens = findModelFile(modelDir, /^tokens\.txt$/i);
  if (!tokens) throw new Error(`tokens.txt not found in ${modelDir}`);

  const encoder = findModelFile(modelDir, /encoder.*\.onnx$/i);
  const decoder = findModelFile(modelDir, /decoder.*\.onnx$/i);
  const joiner = findModelFile(modelDir, /joiner.*\.onnx$/i);
  if (!encoder || !decoder || !joiner) throw new Error(`incomplete parakeet model in ${modelDir}`);

  const modelConfig: Record<string, unknown> = {
    transducer: {
      encoder: join(modelDir, encoder),
      decoder: join(modelDir, decoder),
      joiner: join(modelDir, joiner),
    },
    tokens: join(modelDir, tokens),
    numThreads: 4,
  };

  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig,
  });

  return {
    transcribe: (pcm) => {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: pcm, sampleRate: 16_000 });
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      return result?.text?.trim() ?? "";
    },
  };
}

export function tryCreateDiarizer(
  sherpa: SherpaModule,
  modelDir: string,
): { process: (pcm: Float32Array) => { speakerId: string; text: string; startMs?: number; endMs?: number }[] } | null {
  if (!sherpa.OfflineSpeakerDiarization) return null;
  try {
    const segmentation = findModelFile(modelDir, /segmentation.*\.onnx$/i);
    const embedding = findModelFile(modelDir, /embedding.*\.onnx$/i);
    if (!segmentation || !embedding) return null;
    const instance = new sherpa.OfflineSpeakerDiarization({
      segmentation: { model: join(modelDir, segmentation) },
      embedding: { model: join(modelDir, embedding) },
      clustering: { numClusters: -1 },
      minDurationOn: 0.2,
      minDurationOff: 0.5,
    });
    return {
      process: (pcm) => {
        const result = instance.process(pcm);
        return (result?.segments ?? []).map((s, i) => ({
          speakerId: s.speakerId ?? `S${i + 1}`,
          text: s.text ?? "",
          startMs: s.startMs,
          endMs: s.endMs,
        }));
      },
    };
  } catch (err) {
    log.warn("diarizer init failed", { err: String(err) });
    return null;
  }
}
