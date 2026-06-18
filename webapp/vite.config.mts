import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import pluginManifest from "../plugin.json";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

const configDir = dirname(fileURLToPath(import.meta.url));
const pluginId = pluginManifest.id;

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: "classic",
    }),
    cssInjectedByJsPlugin(),
  ],
  build: {
    lib: {
      entry: resolve(configDir, "src/index.tsx"),
      formats: ["iife"],
      name: `plugin_${pluginId.replace(/[.-]/g, "_")}`,
      fileName: () => "main.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "redux",
        "react-redux",
        "prop-types",
        "react-bootstrap",
        "react-router-dom",
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          redux: "Redux",
          "react-redux": "ReactRedux",
          "prop-types": "PropTypes",
          "react-bootstrap": "ReactBootstrap",
          "react-router-dom": "ReactRouterDom",
        },
      },
    },
    sourcemap: false,
    minify: true,
    cssCodeSplit: false,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  resolve: {
    alias: {
      src: resolve(configDir, "src"),
    },
  },
});
