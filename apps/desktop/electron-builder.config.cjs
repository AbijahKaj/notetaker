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
    // @notetaker/* are devDependencies (bundled into out/ by electron-vite).
    // Native modules (better-sqlite3, keytar) stay in dependencies.
    "!**/*.d.ts",
    "!**/*.d.ts.map",
    "!**/*.map",
    "!**/tsconfig*.json",
    "!**/*.tsbuildinfo",
    "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
    "!**/node_modules/.bin",
  ],
  mac: {
    category: "public.app-category.productivity",
    icon: "resources/icon.png",
    // Stable, version-less artifact names so the landing page can link to
    // https://github.com/.../releases/latest/download/NoteTaker-arm64.dmg
    // without having to know the current version.
    artifactName: "${productName}-${arch}.${ext}",
    target: [
      { target: "dmg", arch: "arm64" },
      { target: "zip", arch: "arm64" },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: process.env.APPLE_TEAM_ID ? { teamId: process.env.APPLE_TEAM_ID } : false,
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
  asarUnpack: [
    "**/*.node",
  ],
  npmRebuild: true,
  releaseInfo: {
    releaseNotesFile: "release-notes.md",
  },
  publish: {
    provider: "github",
    owner: "AbijahKaj",
    repo: "notetaker",
    releaseType: "release",
  },
};
