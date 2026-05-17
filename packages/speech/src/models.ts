import { join } from "node:path";

export interface ModelPaths {
  vad: string;
  parakeet: string;
  diarizationSegmentation: string;
  diarizationEmbedding: string;
}

export function resolveModelPaths(modelsDir: string): ModelPaths {
  return {
    vad: join(modelsDir, "silero_vad", "silero_vad.onnx"),
    parakeet: join(modelsDir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"),
    diarizationSegmentation: join(modelsDir, "sherpa-onnx-pyannote-segmentation-3-0"),
    diarizationEmbedding: join(modelsDir, "nemo_en_titanet_small.onnx"),
  };
}
