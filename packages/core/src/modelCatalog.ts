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
  /** Expected SHA-256 of downloaded bytes (verified before install). */
  downloadSha256?: string;
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
    downloadSha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
  },
  {
    id: "parakeet-tdt-v3",
    required: true,
    sizeBytes: 490_000_000,
    url: `${RELEASE}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    installPath: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    archive: true,
    downloadSha256: "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf",
  },
  {
    id: "sortformer-diarization",
    required: true,
    sizeBytes: 7_000_000,
    url: `${RELEASE}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    installPath: "sherpa-onnx-pyannote-segmentation-3-0",
    archive: true,
    downloadSha256: "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488",
  },
  {
    id: "speaker-embedding",
    required: true,
    sizeBytes: 25_000_000,
    url: `${RELEASE_SPEAKER}/nemo_en_titanet_small.onnx`,
    installPath: "nemo_en_titanet_small.onnx",
    archive: false,
    downloadSha256: "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e",
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
