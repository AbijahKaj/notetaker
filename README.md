# NoteTaker

A privacy-first, Granola-style meeting note taker for macOS. **Your microphone stays on always**; speech recognition runs locally on your Mac. System audio is captured only from a curated whitelist of meeting apps and browser tabs when a whitelisted meeting site is active (e.g. meet.google.com). Summaries use your choice of cloud LLM (Anthropic, OpenAI, OpenRouter) or an optional local MLX model.

→ **[notetaker website & download](https://abijahkaj.github.io/notetaker/)**

Licensed under the [Apache License 2.0](LICENSE).

## Requirements

- macOS 14.2 or later (CoreAudio process tap API)
- Apple Silicon strongly recommended (Parakeet + MLX perform best on the Neural Engine / GPU)
- Node 20.10+
- pnpm 9
- Xcode 15+ with Swift 5.9+ (to build the audio-tap sidecar)
- Python 3.11+ with `pip install mlx-lm` (only if you want the local MLX summarizer)

## Quick start (from source)

```bash
pnpm install
pnpm sidecar:build         # macOS only — builds native/audio-tap
pnpm models:download       # downloads required STT and diarization models (~580 MB)
pnpm dev                   # runs the Electron app
pnpm test                  # run unit tests
```

On first run the onboarding wizard requests microphone, system-audio, and browser automation permissions, lets you pick meeting apps and sites, and guides you through downloading speech models and optional LLM setup.

## How it works

- **Microphone** — always capturing after setup (menu bar shows listening state separately)
- **Listening toggle** — controls transcription, sessions, and whitelisted system-audio capture
- **Meeting apps** — Zoom, Teams, Slack, etc. when running and listening is on
- **Browser tabs** — when a whitelisted site is open in Chrome, Safari, Edge, Arc, Brave, or Vivaldi

## Download a release

Grab the latest signed and notarized build from
[the NoteTaker website](https://abijahkaj.github.io/notetaker/) or
[GitHub Releases](https://github.com/AbijahKaj/notetaker/releases). The app
auto-updates by checking GitHub Releases on launch and every six hours.

**macOS** is the supported platform. Windows/Linux CI builds are not published.

## Build installers locally

```bash
pnpm -r build
pnpm sidecar:build                    # macOS only
pnpm --filter desktop package:mac     # .dmg + .zip
```

For signed macOS distribution, add GitHub Actions secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`.

## CI and releases

GitHub Actions:

- **CI** (`ci.yml`) — typecheck, build, and tests on pull requests and pushes to main
- **Release** (`release.yml`) — builds macOS artifacts on tag push `v*` and uploads to GitHub Releases

## Privacy

- Speech-to-text runs locally; audio is not sent to the cloud for transcription
- Cloud LLM providers receive transcript text only if you configure an API key
- API keys and the database encryption key are stored in the macOS Keychain
- Transcripts and notes are stored in an encrypted local SQLite database by default
  (details in [`docs/encryption.md`](docs/encryption.md))
- Optional raw audio persistence saves `.f32le` files under your app data directory
- Crash logs are written locally and never uploaded
- No telemetry or analytics

Full privacy policy: <https://abijahkaj.github.io/notetaker/privacy.html>

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
