/** Sherpa-onnx pretrained assets (k2-fsa/sherpa-onnx GitHub releases). */
export interface ModelCatalogEntry {
  id: string;
  required: boolean;
  sizeBytes: number;
  url: string;
  /** Path under the models directory after install (file or extracted folder). */
  installPath: string;
  /** When true, download is a .tar.bz2 extracted into the models directory. */
  archive: boolean;
}

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const RELEASE_SPEAKER = `${RELEASE}/speaker-recongition-models`;

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "silero-vad",
    required: true,
    sizeBytes: 2_000_000,
    url: `${RELEASE}/asr-models/silero_vad.onnx`,
    installPath: "silero_vad/silero_vad.onnx",
    archive: false,
  },
  {
    id: "parakeet-tdt-v3",
    required: true,
    sizeBytes: 490_000_000,
    url: `${RELEASE}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    installPath: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    archive: true,
  },
  {
    id: "sortformer-diarization",
    required: true,
    sizeBytes: 7_000_000,
    url: `${RELEASE}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    installPath: "sherpa-onnx-pyannote-segmentation-3-0",
    archive: true,
  },
  {
    id: "speaker-embedding",
    required: true,
    sizeBytes: 25_000_000,
    url: `${RELEASE_SPEAKER}/nemo_en_titanet_small.onnx`,
    installPath: "nemo_en_titanet_small.onnx",
    archive: false,
  },
  {
    id: "llama-3.2-3b-mlx",
    required: false,
    sizeBytes: 2_000_000_000,
    url: "https://huggingface.co/mlx-community/Llama-3.2-3B-Instruct-4bit/resolve/main/model.safetensors",
    installPath: "llama-3.2-3b-mlx/model.safetensors",
    archive: false,
  },
];
