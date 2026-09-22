import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron } from "@playwright/test";
test(
  "fresh Electron opens onboarding without DB, persists progress/theme and resumes after restart",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-native-onboarding-"));
    const entry = join(root, "main.mjs");
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await writeFile(
        entry,
        `import {app} from 'electron';\napp.setPath('appData',${JSON.stringify(root)});\napp.getAppPath=()=>${JSON.stringify(resolve("."))};\nawait import(${JSON.stringify(pathToFileURL(resolve("out/main/index.js")).href)});`,
      );
      const launch = () =>
        electron.launch({
          args: [entry],
          env: {
            PATH: process.env.PATH!,
            HOME: root,
            DEVFLOW_DATABASE_URL:
              "postgres://fixture:never-a-real-secret@127.0.0.1:1/unavailable",
          },
        });
      application = await launch();
      let page = await application.firstWindow();
      await page
        .getByRole("heading", { name: "AI 연결", exact: true })
        .waitFor();
      await page
        .getByLabel("연결 이름", { exact: true })
        .fill("My saved provider");
      await page.getByLabel("시작 화면 테마").selectOption("dark");
      await page.waitForFunction(
        () =>
          (globalThis as any).document.documentElement.dataset.theme === "dark",
      );
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page
        .getByRole("heading", { name: "환경 준비", exact: true })
        .waitFor();
      await page.waitForFunction(
        async () => !(await (globalThis as any).roopre.bootstrap()).busy,
      );
      const status = await page.evaluate(() =>
        (globalThis as any).roopre.bootstrap(),
      );
      assert.equal(status.connected, false);
      assert.equal(status.progress.step, "environment");
      assert(!JSON.stringify(status).includes("never-a-real-secret"));
      await mkdir("artifacts", { recursive: true });
      await page.screenshot({ path: "artifacts/onboarding-dark.png" });
      const rememberedBounds = await application.evaluate(
        ({ BrowserWindow, screen }) => {
          const window = BrowserWindow.getAllWindows()[0];
          const area = screen.getPrimaryDisplay().workArea;
          // Use a reachable rectangle on both CI's small display and a laptop.
          // Off-screen coordinates are intentionally corrected on restoration.
          const width = Math.min(1150, area.width);
          window.setBounds({
            x: area.x + Math.floor((area.width - width) / 2),
            y: area.y,
            width,
            height: 700,
          });
          return window.getNormalBounds();
        },
      );
      await application.close();
      application = undefined;
      const windowState = JSON.parse(
        await readFile(join(root, "roopre", "window-state.json"), "utf8"),
      );
      assert.deepEqual(
        windowState.bounds,
        rememberedBounds,
        "Close flushes the pending window preference write",
      );
      application = await launch();
      page = await application.firstWindow();
      assert.deepEqual(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getNormalBounds(),
        ),
        rememberedBounds,
        "Window geometry survives an actual app restart",
      );
      await page
        .getByRole("heading", { name: "환경 준비", exact: true })
        .waitFor();
      await page.waitForFunction(
        async () => !(await (globalThis as any).roopre.bootstrap()).busy,
      );
      await page.getByRole("button", { name: "뒤로", exact: true }).click();
      await page
        .getByRole("heading", { name: "AI 연결", exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("연결 이름", { exact: true }).inputValue(),
        "My saved provider",
      );
      assert.equal(
        await page.getByLabel("API key", { exact: true }).inputValue(),
        "",
      );
      await page.getByLabel("시작 화면 테마").selectOption("light");
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.screenshot({ path: "artifacts/onboarding-light.png" });
      assert.equal(
        await page
          .getByRole("button", { name: "나중에 · 앱 열기" })
          .isEnabled(),
        false,
      );
      // Only the native directory picker is a fixture; built main/preload and disk I/O are real.
      await application.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [root],
        })) as any;
      }, root);
      const standard = await page.evaluate(() =>
        (globalThis as any).roopre.harnessCandidate({ kind: "default" }),
      );
      assert.equal(standard.package.agents.length, 7);
      const exported = await page.evaluate(
        (token) => (globalThis as any).roopre.harnessExport(token),
        standard.token,
      );
      assert.equal(
        JSON.parse(await readFile(join(exported, "harness.lock.json"), "utf8"))
          .digest,
        standard.digest,
      );
      await application.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [folder],
        })) as any;
      }, exported);
      const imported = await page.evaluate(() =>
        (globalThis as any).roopre.harnessCandidate({ kind: "folder" }),
      );
      assert.deepEqual(imported.package, standard.package);
      assert.equal(imported.digest, standard.digest);
    } finally {
      await application?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
