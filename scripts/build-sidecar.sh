#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/../native/audio-tap"
APP_NAME="NoteTaker Audio Tap.app"
BUILD_DIR="$SIDECAR_DIR/.build/release"
APP_DIR="$BUILD_DIR/$APP_NAME"

echo "Building audio-tap sidecar..."
cd "$SIDECAR_DIR"
swift build -c release

echo "Packaging $APP_NAME (required for macOS Audio Capture privacy)..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
cp "$BUILD_DIR/audio-tap" "$APP_DIR/Contents/MacOS/audio-tap"
cp "$SIDECAR_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
chmod +x "$APP_DIR/Contents/MacOS/audio-tap"

echo "Built: $APP_DIR/Contents/MacOS/audio-tap"
