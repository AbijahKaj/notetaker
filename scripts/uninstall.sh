#!/usr/bin/env bash
# Uninstall NoteTaker from this Mac.
#
# Removes everything NoteTaker put on disk: preferences, recordings, the local
# database, downloaded models, keychain entries, crash logs, login items, and
# the NoteTaker.app bundle itself.
#
# Usage:
#   scripts/uninstall.sh              # full uninstall (data + app bundle)
#   scripts/uninstall.sh --keep-app   # remove data only, keep /Applications/NoteTaker.app
#   scripts/uninstall.sh --yes        # skip confirmation
#
# Safe to run more than once. Anything that's already gone is silently skipped.

set -u

REMOVE_APP=true
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --keep-app) REMOVE_APP=false ;;
    --yes|-y) ASSUME_YES=true ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

HOME_DIR="${HOME}"
SUPPORT="${HOME_DIR}/Library/Application Support"
CACHES="${HOME_DIR}/Library/Caches"
LOGS="${HOME_DIR}/Library/Logs"
PREFS="${HOME_DIR}/Library/Preferences"
SAVED_STATE="${HOME_DIR}/Library/Saved Application State"

TARGETS=(
  "${SUPPORT}/NoteTaker"
  "${SUPPORT}/notetaker-desktop"
  "${SUPPORT}/desktop"
  "${SUPPORT}/com.notetaker.desktop"
  "${CACHES}/NoteTaker"
  "${CACHES}/notetaker-desktop"
  "${CACHES}/com.notetaker.desktop"
  "${PREFS}/com.notetaker.desktop.plist"
  "${SAVED_STATE}/com.notetaker.desktop.savedState"
  "${LOGS}/NoteTaker"
  "${LOGS}/notetaker-desktop"
)

echo "About to remove NoteTaker data from this Mac:"
for t in "${TARGETS[@]}"; do
  if [[ -e "$t" ]]; then
    size=$(du -sh "$t" 2>/dev/null | awk '{print $1}')
    printf "  - %s  (%s)\n" "$t" "${size:-?}"
  fi
done
echo "  - keychain entries under service com.notetaker.desktop (db key + LLM keys)"
echo "  - login item (Launch at login)"
if $REMOVE_APP; then
  echo "  - /Applications/NoteTaker.app  (requires it to be quit)"
fi
echo

if ! $ASSUME_YES; then
  read -r -p "Proceed? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# Try to quit any running instance so DB locks etc. are released.
if pgrep -fi "NoteTaker.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "→ quitting running NoteTaker…"
  osascript -e 'tell application "NoteTaker" to quit' >/dev/null 2>&1 || true
  sleep 1
  pkill -f "NoteTaker.app/Contents/MacOS" 2>/dev/null || true
fi

removed=0
failed=0
for t in "${TARGETS[@]}"; do
  if [[ -e "$t" ]]; then
    if rm -rf "$t" 2>/dev/null; then
      echo "✓ removed $t"
      removed=$((removed + 1))
    else
      echo "✗ failed   $t" >&2
      failed=$((failed + 1))
    fi
  fi
done

# Keychain entries (silent if missing).
keychain_delete() {
  security delete-generic-password -s "com.notetaker.desktop" -a "$1" >/dev/null 2>&1 && \
    echo "✓ removed keychain entry: $1"
}
keychain_delete "db:encryption"
for provider in anthropic openai openrouter; do
  keychain_delete "llm:${provider}"
done

# Login item.
osascript -e 'tell application "System Events" to delete login item "NoteTaker"' \
  >/dev/null 2>&1 && echo "✓ removed login item" || true

if $REMOVE_APP; then
  for candidate in "/Applications/NoteTaker.app" "${HOME_DIR}/Applications/NoteTaker.app"; do
    if [[ -d "$candidate" ]]; then
      if rm -rf "$candidate" 2>/dev/null; then
        echo "✓ removed $candidate"
        removed=$((removed + 1))
      else
        echo "✗ failed   $candidate (may need: sudo rm -rf '$candidate')" >&2
        failed=$((failed + 1))
      fi
    fi
  done
fi

echo
echo "Done. removed=$removed failed=$failed"
exit $(( failed == 0 ? 0 : 1 ))
