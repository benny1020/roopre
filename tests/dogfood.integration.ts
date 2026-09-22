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
        .getByRole("button", { name: "나중에 · 앱 열기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "프로젝트 만들기", exact: true })
        .click();
      await page
        .getByLabel("프로젝트 이름", { exact: true })
        .fill("roopre 사용성 개선");
      await page
        .getByLabel("설명", { exact: true })
        .fill("실제 Electron/IPC/DB로 루프리의 개발 동선을 확인한다.");
      await page
        .getByRole("dialog", { name: "새 프로젝트" })
        .getByRole("button", { name: "프로젝트 만들기", exact: true })
        .click();
      await page.getByRole("button", { name: "새 기능", exact: true }).click();
      await page
        .getByLabel("기능 이름", { exact: true })
        .fill("단계에서 바로 에이전트 추가");
      await page
        .getByLabel("목표와 완료 기준", { exact: true })
        .fill(
          "AC01 단계의 추가 버튼으로 역할을 추가한다.\nAC02 입력과 배치를 재시작 후 복원한다.\nAC03 사람의 승인 없이 구현하지 않는다.",
        );
      await page
        .getByRole("button", { name: "기능 만들기", exact: true })
        .click();
      await page.getByRole("tab", { name: "실행·결과", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "개발 시작", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "설계 작성·검토로 이동", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: /설계·리뷰/ }),
      ).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "설정", exact: true }).click();
      await page
        .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
        .click();
      await page
        .getByRole("button", { name: "기본 흐름 적용", exact: true })
        .click();
      await expect(
        page.getByText("기본 흐름을 적용했습니다.", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "검증에 에이전트 추가", exact: true })
        .click();
      await page
        .getByRole("button", { name: "새 역할 만들기 · Markdown", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "에이전트 편집" });
      await dialog
        .getByLabel("에이전트 이름", { exact: true })
        .fill("루프리 사용성 검증자");
      await dialog
        .getByLabel("Markdown 지침", { exact: true })
        .fill(
          "# 검증\n키보드 추가, 단계 선택, 저장·재시작 보존을 확인하고 실제 수행 근거만 기록한다.",
        );
      await dialog
        .getByRole("button", { name: "에이전트 저장", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "개발 흐름 저장", exact: true })
        .click();
      await expect(
        page.getByText("개발 흐름을 저장했습니다.", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("화면 테마").selectOption("dark");
      await page.locator(".harness-panel").evaluate((el) => {
        el.scrollTop = 0;
      });
      await mkdir("artifacts", { recursive: true });
      await page.screenshot({ path: "artifacts/dogfood-native-workflow.png" });
      const before = await page.evaluate(() =>
        (globalThis as any).roopre.snapshot(),
      );
      assert.equal(before.projects.length, 1);
      assert.equal(before.features.length, 1);
      assert.equal(
        before.projects[0].workflow.assignments.filter(
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
      await expect(page.getByText("동기화됨", { exact: true })).toBeVisible();
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
            agentCount: after.projects[0].workflow.assignments.length,
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
