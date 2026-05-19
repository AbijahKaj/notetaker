const { existsSync } = require("node:fs");
const { join } = require("node:path");

const isMac = process.platform === "darwin";
const sidecarAppPath = join(
  __dirname,
  "../../native/audio-tap/.build/release/NoteTaker Audio Tap.app",
);
const sidecarBinaryPath = join(__dirname, "../../native/audio-tap/.build/release/audio-tap");
const sidecarPath = existsSync(sidecarAppPath) ? sidecarAppPath : sidecarBinaryPath;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.notetaker.desktop",
  productName: "NoteTaker",
  directories: {
    output: "release",
    buildResources: "resources",
  },
  files: [
    "out/**/*",
    "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
    "!**/node_modules/.bin",
  ],
  mac: {
    category: "public.app-category.productivity",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    extendInfo: {
      NSMicrophoneUsageDescription:
        "NoteTaker uses your microphone to transcribe meetings locally on this Mac.",
      NSAudioCaptureUsageDescription:
        "NoteTaker captures audio from your meeting apps (Zoom, Teams, Slack, etc.) so it can transcribe the other side of the call. System audio never leaves your Mac unless you opt in to a cloud LLM.",
      NSAppleEventsUsageDescription:
        "NoteTaker reads the URL of the active browser tab so it knows when you are in a meeting (e.g. meet.google.com). It does not read page contents.",
      LSUIElement: true,
      NSHighResolutionCapable: true,
    },
    extraResources: isMac && existsSync(sidecarPath)
      ? [{ from: sidecarPath, to: existsSync(sidecarAppPath) ? "NoteTaker Audio Tap.app" : "audio-tap" }]
      : [],
  },
  win: {
    target: ["nsis", "portable"],
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Office",
    maintainer: "Abijah Kajabika",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  publish: null,
};
