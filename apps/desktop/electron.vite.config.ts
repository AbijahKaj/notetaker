import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Workspace packages are pnpm-symlinked into node_modules. electron-builder's
// asar packer rejects files whose realpath escapes apps/desktop/, so instead
// of leaving them as runtime imports we bundle them straight into the main /
// preload output. Third-party deps stay external (esp. native modules).
const WORKSPACE_PACKAGES = [
  "@notetaker/core",
  "@notetaker/audio-bridge",
  "@notetaker/llm",
  "@notetaker/speech",
  "@notetaker/storage",
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
