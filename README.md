# Always-On Mac Note Taker

A privacy-first, Granola-style meeting note taker for macOS. Microphone stays on always; system audio is captured only from a curated whitelist of meeting apps and a user-editable list of meeting websites detected via AppleScript polling. Local speech-to-text (Parakeet TDT v3) plus local speaker diarization. Summaries are produced by your choice of cloud LLM (Anthropic, OpenAI, OpenRouter) or a small local MLX model downloaded during onboarding.

## Requirements

- macOS 14.2 or later (CoreAudio process tap API)
- Apple Silicon strongly recommended (Parakeet + MLX perform best on the Neural Engine / GPU)
- Node 20.10+
- pnpm 9
- Xcode 15+ with Swift 5.9+ (to build the audio-tap sidecar)
- Python 3.11+ (only if you want the local MLX summarizer)

## Quick start

```bash
pnpm install
pnpm sidecar:build         # macOS only — builds native/audio-tap
pnpm models:download       # downloads required STT and diarization models
pnpm dev                   # runs the Electron app
```

## Distribution

Build installers for all platforms (CI does this automatically on `v*` tags):

```bash
pnpm -r build
pnpm sidecar:build                    # macOS only
pnpm --filter desktop package:mac     # .dmg + .zip
pnpm --filter desktop package:win     # .exe (NSIS + portable)
pnpm --filter desktop package:linux   # .AppImage + .deb
```

GitHub Actions:
- **CI** (`ci.yml`) — typecheck/build on every push to main
- **Release** (`release.yml`) — builds mac/win/linux artifacts on tag push `v*` (e.g. `v0.1.0`) and uploads to GitHub Releases

For signed macOS distribution, add secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`.

**Platform notes:**
- **macOS**: full feature set (mic + per-app system audio + browser tab detection)
- **Windows / Linux**: app runs; native system-audio capture requires macOS 14.2+. Mic preview works via Web Audio in onboarding.

On first run the onboarding wizard will request microphone and system-audio permissions, let you pick which meeting apps and sites to watch, and optionally guide you through downloading an LLM (cloud key or local MLX bundle).

## Repository layout

```
apps/
  desktop/                  Electron + React app (main + preload + renderer)
packages/
  core/                     Session model, pipeline orchestration, shared types
  audio-bridge/             TypeScript wrapper around the Swift CoreAudio sidecar
  speech/                   VAD, language ID, STT, diarization (sherpa-onnx-node)
  llm/                      Summarizer interface + Anthropic/OpenAI/OpenRouter/MLX adapters
  storage/                  SQLite schema, migrations, FTS, encryption
native/
  audio-tap/                Swift binary using AudioHardwareCreateProcessTap
  mlx-summarizer/           Optional Python MLX sidecar (Llama 3.2 3B 4-bit)
scripts/
  download-models.ts        Onboarding model fetch with SHA256 verification
  build-sidecar.sh          Build the Swift audio tap binary
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full plan.
