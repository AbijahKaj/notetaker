import { existsSync } from "node:fs";
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
    process: (samples: Float32Array) => DiarizationSegmentRaw[];
  };
};

/** Sherpa returns start/end in seconds and speaker as integer index. */
export interface DiarizationSegmentRaw {
  start: number;
  end: number;
  speaker: number;
}

export interface DiarizationTurn {
  speakerId: string;
  startSec: number;
  endSec: number;
}

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

  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, encoder),
        decoder: join(modelDir, decoder),
        joiner: join(modelDir, joiner),
      },
      tokens: join(modelDir, tokens),
      numThreads: 4,
    },
  });

  return {
    transcribe: (pcm) => {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: pcm, sampleRate: 16_000 });
      recognizer.decode(stream);
      return recognizer.getResult(stream)?.text?.trim() ?? "";
    },
  };
}

export function createDiarizer(
  sherpa: SherpaModule,
  segmentationDir: string,
  embeddingModelPath: string,
): { process: (pcm: Float32Array) => DiarizationTurn[] } | null {
  if (!sherpa.OfflineSpeakerDiarization) {
    log.warn("OfflineSpeakerDiarization not available in sherpa-onnx-node");
    return null;
  }

  const segFile =
    findModelFile(segmentationDir, /^model\.int8\.onnx$/i) ??
    findModelFile(segmentationDir, /^model\.onnx$/i);
  if (!segFile) {
    log.warn("pyannote segmentation model not found", { segmentationDir });
    return null;
  }
  if (!existsSync(embeddingModelPath)) {
    log.warn("speaker embedding model not found", { embeddingModelPath });
    return null;
  }

  try {
    const instance = new sherpa.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: join(segmentationDir, segFile) },
        numThreads: 1,
      },
      embedding: {
        model: embeddingModelPath,
        numThreads: 1,
      },
      clustering: { threshold: 0.5 },
      minDurationOn: 0.25,
      minDurationOff: 0.4,
    });

    return {
      process: (pcm) => {
        const raw = instance.process(pcm);
        return raw.map((s) => ({
          speakerId: `S${(s.speaker ?? 0) + 1}`,
          startSec: s.start,
          endSec: s.end,
        }));
      },
    };
  } catch (err) {
    log.warn("diarizer init failed", { err: String(err) });
    return null;
  }
}
