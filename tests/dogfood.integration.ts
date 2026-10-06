import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { _electron as electron, expect } from "@playwright/test";
import { databaseUrl } from "../src/database/store.ts";

// Built Electron, real IPC/domain/PostgreSQL, disposable profile and DB schema.
// No substituted bridge, provider, owner authentication or approval receipt.
// Run explicitly on a Mac with the development PostgreSQL available.
test(
  "Roopre self-use: create a UX task, configure agents and resume without fabricating approval",
  { timeout: 90000 },
  async () => {
    const url = new URL(databaseUrl);
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      "Requires a local development DB",
    );
    const schema = `dogfood_${randomUUID().replaceAll("-", "")}`;
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    const root = await mkdtemp(join(tmpdir(), "roopre-dogfood-"));
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
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
        .getByRole("button", { name: "Skip for now · Open app", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await page
        .getByLabel("Project name", { exact: true })
        .fill("다른 프로젝트");
      await page
        .getByLabel("Description", { exact: true })
        .fill("실제 Electron/IPC/DB로 루프리의 개발 동선을 확인한다.");
      await page
        .getByRole("dialog", { name: "New project" })
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      await page
        .getByLabel("Project name", { exact: true })
        .fill("roopre 사용성 개선");
      await page
        .getByLabel("Description", { exact: true })
        .fill("두 번째 프로젝트의 설정 문맥을 확인한다.");
      await page
        .getByRole("dialog", { name: "New project" })
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "New feature", exact: true })
        .click();
      await page
        .getByLabel("Feature name", { exact: true })
        .fill("단계에서 바로 에이전트 추가");
      await page
        .getByLabel("Goal and acceptance criteria", { exact: true })
        .fill(
          "AC01 단계의 추가 버튼으로 역할을 추가한다.\nAC02 입력과 배치를 재시작 후 복원한다.\nAC03 사람의 승인 없이 구현하지 않는다.",
        );
      await page
        .getByRole("button", { name: "Create feature", exact: true })
        .click();
      await page
        .getByRole("tab", { name: "Build & verify", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Start implementation", exact: true }),
      ).toBeDisabled();
      const taskState = await page.evaluate(() =>
        (globalThis as any).roopre.snapshot(),
      );
      const taskProjectId = taskState.features[0].projectId;
      await page
        .getByRole("button", {
          name: "Configure execution profile",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Projects", exact: true }),
      ).toHaveValue(taskProjectId);
      await page
        .getByRole("button", { name: "Back to work", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Open design review", exact: true })
        .click();
      await expect(page.getByRole("tab", { name: /Plan/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Agents & workflow", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Use default workflow", exact: true })
        .click();
      await expect(
        page.getByText("Default workflow applied.", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Add agent to Verification", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Create role · Markdown", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Edit agent" });
      await dialog
        .getByLabel("Agent name", { exact: true })
        .fill("루프리 사용성 검증자");
      await dialog
        .getByLabel("Markdown instructions", { exact: true })
        .fill(
          "# 검증\n키보드 추가, 단계 선택, 저장·재시작 보존을 확인하고 실제 수행 근거만 기록한다.",
        );
      await dialog
        .getByRole("button", { name: "Save agent", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Save workflow", exact: true })
        .click();
      await expect(
        page.getByText("Workflow saved.", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("Appearance").selectOption("dark");
      await page.locator(".harness-panel").evaluate((el) => {
        el.scrollTop = 0;
      });
      await mkdir("artifacts", { recursive: true });
      await page.screenshot({ path: "artifacts/dogfood-native-workflow.png" });
      const before = await page.evaluate(() =>
        (globalThis as any).roopre.snapshot(),
      );
      assert.equal(before.projects.length, 2);
      const savedProject = before.projects.find(
        (p: any) => p.id === taskProjectId,
      );
      assert.equal(
        before.projects.find((p: any) => p.id !== taskProjectId).workflow,
        undefined,
      );
      assert.equal(before.features.length, 1);
      assert.equal(
        savedProject.workflow.assignments.filter(
          (a: any) => a.stage === "verification",
        ).length,
        2,
      );
      assert.equal(before.gates[before.features[0].id].eligible, false);
      assert.equal(before.runs.length, 0);
      await application.close();
      application = undefined;
      application = await launch();
      page = await application.firstWindow();
      await expect(page.getByText("Synced", { exact: true })).toBeVisible();
      const after = await page.evaluate(() =>
        (globalThis as any).roopre.snapshot(),
      );
      assert.deepEqual(after.projects, before.projects);
      assert.deepEqual(after.features, before.features);
      assert.equal(after.runs.length, 0);
      assert.equal(after.gates[after.features[0].id].eligible, false);
      await writeFile(
        "artifacts/dogfood-native-result.json",
        JSON.stringify(
          {
            project: "roopre 사용성 개선",
            task: "단계에서 바로 에이전트 추가",
            realElectronIPC: true,
            realPostgreSQL: true,
            persistedAfterRestart: true,
            agentCount: after.projects.find((p: any) => p.id === taskProjectId)
              .workflow.assignments.length,
            implementationExecuted: false,
            modelCalled: false,
            approvalFabricated: false,
            limitation:
              "Isolated profile; no saved provider or human design approval. Actual AI implementation remains unverified.",
          },
          null,
          2,
        ),
      );
    } finally {
      await application?.close();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
