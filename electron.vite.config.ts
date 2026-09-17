import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { format: "es", entryFileNames: "index.js" } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 4317, strictPort: true },
    resolve: { alias: { "@renderer": resolve("src/renderer/src") } },
  },
});
