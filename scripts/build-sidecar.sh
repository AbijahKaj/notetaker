#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/../native/audio-tap"

echo "Building audio-tap sidecar..."
cd "$SIDECAR_DIR"
swift build -c release
echo "Built: $SIDECAR_DIR/.build/release/audio-tap"
