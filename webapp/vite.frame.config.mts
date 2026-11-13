import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: resolve(
        configDir,
        "src/transcription/transcription_frame_entry.ts",
      ),
      formats: ["iife"],
      name: "voiceTranscriptionFrame",
      fileName: () => "transcription-frame.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
