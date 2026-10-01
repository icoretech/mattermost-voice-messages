import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    css: false,
    setupFiles: [],
  },
  resolve: {
    alias: {
      src: resolve(configDir, "src"),
    },
  },
});
