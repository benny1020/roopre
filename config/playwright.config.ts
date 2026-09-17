import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../tests/web",
  outputDir: "../artifacts/web-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/web-report", open: "never" }],
  ],
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4327",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: resolve(import.meta.dirname, ".."),
    command: "pnpm exec vite --config config/vite.web.config.ts --port 4327",
    url: "http://127.0.0.1:4327",
    reuseExistingServer: false,
  },
});
