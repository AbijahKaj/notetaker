# NoteTaker

A privacy-first meeting note taker for macOS. Turn on listening when you want to capture a meeting — speech recognition runs locally on your Mac. System audio is captured from whitelisted meeting apps (Zoom, Teams, Slack, etc.) and from browser tabs when a whitelisted meeting site is active (e.g. meet.google.com). Summaries use your choice of cloud LLM (Anthropic, OpenAI, OpenRouter) or an optional local MLX model.

Licensed under the [Apache License 2.0](LICENSE).

## Requirements

- macOS 14.2 or later (CoreAudio process tap API)
- Apple Silicon strongly recommended (Parakeet + MLX perform best on the Neural Engine / GPU)
- Node 20.10+
- pnpm 9
- Xcode 15+ with Swift 5.9+ (to build the audio-tap sidecar)
- Python 3.11+ (only if you want the local MLX summarizer)

## Quick start (from source)

```bash
pnpm install
pnpm sidecar:build         # macOS only — builds native/audio-tap
pnpm models:download       # downloads required STT and diarization models (~580 MB)
pnpm dev                   # runs the Electron app
```

On first run the onboarding wizard requests microphone, system-audio, and browser automation permissions, lets you pick meeting apps and sites, and guides you through downloading speech models and optional LLM setup.

## Download a release

Pre-built installers are published on [GitHub Releases](https://github.com/AbijahKaj/notetaker/releases) when a version tag is pushed (e.g. `v0.1.0`).

**macOS** is the supported platform — full feature set (mic, per-app system audio, browser tab detection).

**Windows / Linux** builds are experimental. The app may install but native system-audio capture requires macOS 14.2+.

## Build installers locally

```bash
pnpm -r build
pnpm sidecar:build                    # macOS only
pnpm --filter desktop package:mac     # .dmg + .zip
pnpm --filter desktop package:win     # .exe (NSIS + portable)
pnpm --filter desktop package:linux   # .AppImage + .deb
```

For signed macOS distribution, add GitHub Actions secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`.

## CI and releases

GitHub Actions:

- **CI** (`ci.yml`) — typecheck and build on pull requests and pushes to main
- **Release** (`release.yml`) — builds mac/win/linux artifacts on tag push `v*` and uploads to GitHub Releases

## Privacy

- Speech-to-text runs locally; audio is not sent to the cloud for transcription
- Cloud LLM providers receive transcript text only if you configure an API key
- API keys and the database encryption key are stored in the macOS Keychain
- Transcripts and notes are stored in an encrypted local SQLite database by default
- No telemetry or analytics

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines. Report security issues via [GitHub Security Advisories](https://github.com/AbijahKaj/notetaker/security/advisories/new).

## Repository layout

```
apps/
  desktop/                  Electron + React app (main + preload + renderer)
packages/
  core/                     Session model, pipeline orchestration, shared types
  audio-bridge/             TypeScript wrapper around the Swift CoreAudio sidecar
  speech/                   VAD, language ID, STT, diarization (sherpa-onnx-node)
  llm/                      Summarizer interface + Anthropic/OpenAI/OpenRouter/MLX adapters
  storage/                  SQLite schema, migrations, FTS, export
native/
  audio-tap/                Swift binary using AudioHardwareCreateProcessTap
  mlx-summarizer/           Optional Python MLX sidecar (Llama 3.2 3B 4-bit)
scripts/
  download-models.ts        Model fetch for onboarding and CLI
  build-sidecar.sh          Build the Swift audio tap binary
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full plan.
