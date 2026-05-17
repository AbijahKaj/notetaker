import { join } from "node:path";

export interface ModelPaths {
  vad: string;
  parakeet: string;
  whisper?: string;
  langId?: string;
  diarization: string;
}

export function resolveModelPaths(modelsDir: string): ModelPaths {
  return {
    vad: join(modelsDir, "silero_vad", "silero_vad.onnx"),
    parakeet: join(modelsDir, "parakeet-tdt-0.6b-v3"),
    whisper: join(modelsDir, "whisper-large-v3-turbo"),
    langId: join(modelsDir, "lang-id"),
    diarization: join(modelsDir, "sortformer-diarization"),
  };
}
