import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connect, type Socket } from "node:net";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { _electron as electron, expect } from "@playwright/test";
import { databaseUrl } from "../src/database/store.ts";

// Built Electron/main/preload, real IPC/domain/PostgreSQL, and a disposable
// profile/schema. The TCP proxy is the sole fixture boundary: it isolates the
// read failure/reconnection experiment without altering the app or user DB.
// No provider, model, owner-authentication, approval receipt, or run is made.
test(
  "portfolio native: real snapshot navigation, restart restoration, and DB read recovery",
  { timeout: 120000 },
  async () => {
    const upstream = new URL(databaseUrl);
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname),
      "Requires a local development PostgreSQL",
    );
    const schema = `portfolio_native_${randomUUID().replaceAll("-", "")}`;
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    const root = await mkdtemp(join(tmpdir(), "roopre-portfolio-native-"));
    const sockets = new Set<Socket>();
    let online = true;
    const proxy = createServer((client) => {
      if (!online) return client.destroy();
      const target = connect(Number(upstream.port || 5432), upstream.hostname);
      const destroy = () => {
        client.destroy();
        target.destroy();
      };
      for (const socket of [client, target]) {
        sockets.add(socket);
        socket.on("error", destroy);
        socket.on("close", () => sockets.delete(socket));
      }
      client.pipe(target).pipe(client);
    });
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const address = proxy.address();
      assert(address && typeof address !== "string");
      const url = new URL(databaseUrl);
      url.hostname = "127.0.0.1";
      url.port = String(address.port);
      url.searchParams.set("options", `-c search_path=${schema}`);
      const entry = join(root, "main.mjs");
      await writeFile(
        entry,
        `import { app } from 'electron';\napp.setPath('appData',${JSON.stringify(root)});\napp.getAppPath=()=>${JSON.stringify(resolve("."))};\nawait import(${JSON.stringify(pathToFileURL(resolve("out/main/index.js")).href)});`,
      );
      const launch = () =>
        electron.launch({
          args: [entry],
          env: {
            PATH: process.env.PATH!,
            HOME: root,
            DEVFLOW_DATABASE_URL: url.href,
          },
        });
      application = await launch();
      let page = await application.firstWindow();
      await page
        .getByRole("button", { name: "나중에 · 앱 열기", exact: true })
        .click();
      await expect(page.getByText("동기화됨", { exact: true })).toBeVisible();

      // This uses the app's real preload IPC command handler to create only
      // disposable read-model records. It deliberately does not publish or
      // approve a design, configure a provider, or queue an execution.
      const created = await page.evaluate(async () => {
        const api = (globalThis as any).roopre;
        const projects: Array<{ id: string; name: string }> = [];
        for (const name of [
          "Alpha delivery",
          "Beta platform",
          "Gamma portal",
        ]) {
          const project = await api.command({
            type: "create_project",
            name,
            description: "Disposable native portfolio integration fixture",
            reviewerIds: ["owner"],
          });
          const feature = await api.command({
            type: "create_feature",
            projectId: project.entityId,
            title: `${name} 기능`,
            template: "feature",
            requirements: "AC-01 관제에서 실제 snapshot을 확인한다.",
          });
          projects.push({
            id: project.entityId,
            name: `${name} 기능:${feature.entityId}`,
          });
        }
        return { projects, snapshot: await api.snapshot() };
      });
      assert.equal(created.snapshot.projects.length, 3);
      assert.equal(created.snapshot.features.length, 3);
      assert.equal(created.snapshot.runs.length, 0);
      const gamma = created.snapshot.projects.find(
        (project: any) => project.name === "Gamma portal",
      );
      const gammaFeature = created.snapshot.features.find(
        (feature: any) => feature.projectId === gamma.id,
      );

      await page.getByRole("button", { name: /명령 · 작업 검색/ }).click();
      const commandSearch = page.getByRole("combobox", {
        name: "명령과 작업 검색",
      });
      await commandSearch.fill("전역 관제");
      await commandSearch.press("Enter");
      await expect(
        page.getByRole("heading", { name: "전역 관제", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "에이전트 작업실", exact: true })
        .click();
      await expect(
        page.getByText("실행 인스턴스가 있는 작업석만 표시합니다.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("현재 실행 기록 없음", { exact: true }).first(),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "프로젝트 흐름", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "프로젝트 단계 관제" }),
      ).toBeVisible();
      await page.getByLabel("프로젝트 범위").selectOption(gamma.id);
      await page.getByLabel("전역 기능 검색").fill("Gamma portal 기능");
      await page.getByRole("button", { name: "Gamma portal 기능" }).click();
      await expect(
        page.getByRole("complementary", { name: "선택한 작업" }),
      ).toContainText("Gamma portal 기능");
      await mkdir("artifacts", { recursive: true });
      await page.screenshot({
        path: "artifacts/portfolio-native-selected.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: /기존 설계·승인 상세 보기/ })
        .click();
      await expect(
        page.getByRole("heading", { name: "Gamma portal 기능", exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "개발·검증", exact: true }).click();
      await expect(
        page.getByRole("tab", { name: "개발·검증", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page
        .getByRole("button", { name: "기능 목록으로", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "전역 관제", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("프로젝트 범위")).toHaveValue(gamma.id);
      await expect(page.getByLabel("전역 기능 검색")).toHaveValue(
        "Gamma portal 기능",
      );
      await expect(
        page.getByRole("complementary", { name: "선택한 작업" }),
      ).toContainText("Gamma portal 기능");

      // Force foreground reads through the isolated proxy to fail. The last
      // accepted app snapshot must remain visible until a later real read wins.
      online = false;
      for (const socket of sockets) socket.destroy();
      await expect(page.getByText("연결 확인 중", { exact: true })).toBeVisible(
        {
          timeout: 20000,
        },
      );
      await expect(page.getByRole("status")).toContainText("오래된 화면");
      await expect(
        page.getByRole("heading", { name: "Gamma portal 기능", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: "artifacts/portfolio-native-db-offline.png",
        fullPage: true,
      });
      online = true;
      await expect(page.getByText("동기화됨", { exact: true })).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByRole("status")).toHaveCount(0);
      await page.screenshot({
        path: "artifacts/portfolio-native-db-recovered.png",
        fullPage: true,
      });

      await application.close();
      application = undefined;
      application = await launch();
      page = await application.firstWindow();
      await expect(page.getByText("동기화됨", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "전역 관제", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("프로젝트 범위")).toHaveValue(gamma.id);
      await expect(page.getByLabel("전역 기능 검색")).toHaveValue(
        "Gamma portal 기능",
      );
      await expect(
        page.getByRole("complementary", { name: "선택한 작업" }),
      ).toContainText("Gamma portal 기능");
      await page.screenshot({
        path: "artifacts/portfolio-native-restarted.png",
        fullPage: true,
      });
      await writeFile(
        "artifacts/portfolio-native-result.json",
        JSON.stringify(
          {
            realElectronMainAndPreload: true,
            realPostgreSQL: true,
            disposableProfileAndSchema: true,
            dbFailureFixtureBoundary: "test-local TCP proxy only",
            projects: 3,
            navigationRestored: true,
            restartRestored: true,
            approvalFabricated: false,
            providerOrModelCalled: false,
            executionRunCreated: false,
          },
          null,
          2,
        ),
      );
    } finally {
      await application?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) =>
        proxy.close(() => resolveClose()),
      );
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
