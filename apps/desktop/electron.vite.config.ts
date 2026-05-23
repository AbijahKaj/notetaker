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

// Native modules that ship sibling .dylib / .so files. They MUST NOT be
// bundled — the .node file is loaded via dlopen and uses @rpath to find its
// siblings in the same directory. Bundling the .node into out/main/chunks
// would move it away from those libraries and dyld would fail with
// "Library not loaded: @rpath/lib...".
const NATIVE_EXTERNALS = [
  "sherpa-onnx-node",
  "sherpa-onnx-darwin-arm64",
  "sherpa-onnx-darwin-x64",
  "sherpa-onnx-linux-x64",
  "sherpa-onnx-linux-arm64",
  "sherpa-onnx-win-x64",
  "sherpa-onnx-win-ia32",
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
        external: NATIVE_EXTERNALS,
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
