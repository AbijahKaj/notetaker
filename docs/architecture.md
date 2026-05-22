# Architecture

## Overview

NoteTaker is a macOS menu-bar Electron app with a Swift CoreAudio sidecar for per-process audio capture. Speech processing runs locally via sherpa-onnx-node (Silero VAD, Parakeet TDT v3, Sortformer diarization). Summaries are produced by pluggable LLM adapters (Anthropic, OpenAI, OpenRouter, or local MLX).

## Data flow

```
Mic (always) + meeting app/browser taps (when listening)
  → Unix socket PCM frames
  → AudioBridge (TypeScript)
  → Silero VAD
  → Parakeet TDT v3
  → Diarization
  → SQLite + FTS5
  → LLM summarizer
```

## Capture policy

| Source | Capture active | Transcribed when |
|---|---|---|
| Microphone | Always (after permission) | Listening toggle ON |
| Whitelisted meeting apps | App running + listening ON | Listening toggle ON |
| Browsers | Whitelisted site in tab + listening ON | Listening toggle ON |

The listening toggle controls transcription, session lifecycle, and whitelisted system-audio taps. Pausing listening does not stop the microphone.

## Packages

- `@notetaker/core` — shared types, events, IPC contracts, constants
- `@notetaker/audio-bridge` — Swift sidecar lifecycle, PCM streaming, source registry
- `@notetaker/speech` — sherpa-onnx wrapper (VAD, STT, lang-ID, diarization)
- `@notetaker/llm` — summarizer adapters
- `@notetaker/storage` — SQLite schema, FTS5, SQLCipher encryption, export

## Native components

- `native/audio-tap` — Swift binary using `AudioHardwareCreateProcessTap` (macOS 14.2+)
- `native/mlx-summarizer` — Python MLX sidecar for local Llama 3.2 3B summarization

## CoreML upgrade path (Phase 7)

The current v1 uses sherpa-onnx-node for all speech processing. For lower latency and better battery on Apple Silicon, migrate Parakeet inference to CoreML:

1. Export Parakeet TDT 0.6B v3 to CoreML INT8 (see FluidInference/parakeet-tdt-0.6b-v3-coreml on HuggingFace)
2. Add a Swift inference module in `native/audio-tap` or a new `native/parakeet-coreml` target
3. Replace the sherpa-onnx Parakeet path in `packages/speech/src/engine.ts` with a CoreML sidecar call when available
4. Keep sherpa-onnx as fallback for non-Apple-Silicon Macs

Expected gains: ~110x realtime on M4 Pro Neural Engine vs ~32x on ONNX CPU, with GPU/ANE independence from other workloads.

## Security

- API keys stored in macOS Keychain via `keytar`
- SQLite database encrypted at rest with SQLCipher (key in Keychain when `encryptDb` enabled)
- No raw audio persisted unless `persistAudio` is enabled
- Logger redacts API keys and tokens
