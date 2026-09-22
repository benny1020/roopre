import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { git, command } from "../src/runner/process.ts";

test(
  "fresh native onboarding provisions a private DB, saves a real profile/harness and resumes the first task",
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-first-use-"));
    const fixtureKey = "explicit-nonsecret-fixture-no-provider-call";
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      const repo = join(root, "pilot-repository");
      await mkdir(repo);
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "Fixture");
      await git(repo, "config", "user.email", "fixture@example.invalid");
      await writeFile(
        join(repo, "README.md"),
        "First-use disposable repository\n",
      );
      await git(repo, "add", "-A");
      await git(repo, "commit", "-m", "baseline");
      const entry = join(root, "main.mjs");
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
              "postgres://fixture:fixture@127.0.0.1:1/unavailable",
          },
        });
      application = await launch();
      let page = await application.firstWindow();
      await page
        .getByRole("heading", { name: "AI 연결", exact: true })
        .waitFor();
      await page
        .getByLabel("연결 이름", { exact: true })
        .fill("첫 사용 검증 연결");
      await page
        .getByLabel("Endpoint", { exact: true })
        .fill("https://invalid.example");
      await page.getByLabel("API key", { exact: true }).fill(fixtureKey);
      await page
        .getByRole("button", { name: "연결 저장", exact: true })
        .click();
      await expect(
        page.getByText(
          "연결을 저장했습니다. 실제 사용 전 연결 검사를 실행하세요.",
        ),
      ).toBeVisible();
      await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
      const connections = await page.evaluate(() =>
        (globalThis as any).roopre.connections(),
      );
      assert.equal(connections.length, 1);
      assert.equal(connections[0].testStatus, undefined);
      assert.equal(JSON.stringify(connections).includes(fixtureKey), false);
      const sealed = await readFile(
        join(root, "roopre/private/connections.json"),
        "utf8",
      );
      assert.equal(
        sealed.includes(fixtureKey),
        false,
        "native safeStorage never persists the fixture plaintext",
      );
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.waitForFunction(
        async () => !(await (globalThis as any).roopre.bootstrap()).busy,
      );
      await page
        .getByRole("button", { name: "환경 준비", exact: true })
        .click();
      await page.waitForFunction(
        async () => {
          const s = await (globalThis as any).roopre.bootstrap();
          return !s.busy && s.connected && s.managed;
        },
        undefined,
        { timeout: 120000 },
      );
      await mkdir("artifacts", { recursive: true });
      await expect(page.getByText(/데이터베이스 연결됨/)).toBeVisible();
      await page.screenshot({ path: "artifacts/first-use-environment.png" });
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page
        .getByLabel("프로젝트 이름", { exact: true })
        .fill("첫 번째 예비 프로젝트");
      // The OS directory picker is the only UI fixture; built IPC, Git, DB and safeStorage are real.
      await application.evaluate(({ dialog }, repo) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [repo],
        })) as any;
      }, repo);
      await page
        .getByRole("button", { name: "저장소 폴더 선택", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "필수 검사 명령 (JSON)", exact: true })
        .fill(
          JSON.stringify(
            ["typecheck", "test", "e2e"].map((name) => ({
              name,
              argv: [
                "node",
                "-e",
                "if(!require('fs').existsSync('README.md'))process.exit(1)",
              ],
              timeoutSeconds: 10,
            })),
          ),
        );
      await page
        .getByLabel("프로젝트 Markdown 지침", { exact: true })
        .fill("# 파일럿 규칙\n승인된 범위와 기존 검사를 유지한다.");
      await page
        .getByRole("button", { name: "프로젝트 연결 저장", exact: true })
        .click();
      await expect(
        page.getByText("프로젝트와 실행 기준을 저장했습니다."),
      ).toBeVisible();
      // Add another project through the actual onboarding form; the next step must target it.
      await page
        .getByRole("combobox", { name: "저장된 프로젝트", exact: true })
        .selectOption("");
      await page
        .getByLabel("프로젝트 이름", { exact: true })
        .fill("첫 사용 파일럿");
      await page
        .getByRole("button", { name: "저장소 폴더 선택", exact: true })
        .click();
      await page
        .getByRole("button", { name: "프로젝트 연결 저장", exact: true })
        .click();
      await expect(
        page
          .getByRole("combobox", { name: "저장된 프로젝트", exact: true })
          .locator("option:checked"),
      ).toHaveText("첫 사용 파일럿");
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page
        .getByRole("button", { name: "기본 흐름 적용", exact: true })
        .click();
      await expect(page.getByText("기본 흐름을 적용했습니다.")).toBeVisible();
      await page
        .getByRole("textbox", { name: "구현 단계 지침", exact: true })
        .fill("검사 기준을 유지하고 작은 변경으로 구현한다.");
      await page
        .getByRole("button", { name: "개발 흐름 저장", exact: true })
        .click();
      await expect(page.getByText("개발 흐름을 저장했습니다.")).toBeVisible();
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page
        .getByLabel("기능 이름", { exact: true })
        .fill("첫 사용자 동선 확인");
      await page
        .getByLabel("요구사항과 완료 기준", { exact: true })
        .fill(
          "AC01 프로젝트 설정과 역할을 재시작 후 복원한다.\nAC02 본인 승인 전 구현하지 않는다.",
        );
      await page
        .getByRole("button", { name: "첫 요구사항 만들기", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "첫 사용자 동선 확인", exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "실행·결과", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "개발 시작", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("region", { name: "실행 준비" }),
      ).toContainText("연결 검사 전");
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: "프로젝트 AI 연결" })
          .getByRole("img", { name: "확인 필요" }),
      ).toBeVisible();
      // Electron cannot create axe's temporary cross-origin page. This app has no frames.
      const audit = await new AxeBuilder({ page })
        .setLegacyMode()
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        audit.violations.map((v) => v.id),
        [],
      );
      await page.screenshot({ path: "artifacts/first-use-task.png" });
      const before = await page.evaluate(() =>
        (globalThis as any).roopre.snapshot(),
      );
      assert.equal(before.projects.length, 2);
      const target = before.projects.find(
        (p: any) => p.name === "첫 사용 파일럿",
      );
      assert.equal(
        before.projects.find((p: any) => p.id !== target.id).workflow,
        undefined,
      );
      assert.equal(before.features[0].projectId, target.id);
      assert.equal(
        target.executionProfile.baseCommit,
        await git(repo, "rev-parse", "HEAD"),
      );
      assert(target.executionProfile.image.startsWith("sha256:"));
      assert(target.workflow.assignments.length >= 5);
      assert.equal(before.runs.length, 0);
      await application.close();
      application = undefined;
      application = await launch();
      page = await application.firstWindow();
      await expect(
        page.getByRole("heading", { name: "첫 사용자 동선 확인", exact: true }),
      ).toBeVisible();
      const after = await page.evaluate(() =>
        (globalThis as any).roopre.snapshot(),
      );
      assert.deepEqual(after.projects, before.projects);
      assert.deepEqual(after.features, before.features);
      assert.equal(after.runs.length, 0);
      assert.equal(
        (await page.evaluate(() => (globalThis as any).roopre.connections()))[0]
          .id,
        connections[0].id,
      );
      await writeFile(
        "artifacts/first-use-results.json",
        JSON.stringify(
          {
            managedDatabaseProvisioned: true,
            nativeEncryptedVault: true,
            repositoryProfileSaved: true,
            workflowSaved: true,
            firstTaskPersisted: true,
            restartPreserved: true,
            modelCalled: false,
            nativeApprovalPerformed: false,
            directoryPicker: "fixture",
            deploymentTest: false,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      if (application) {
        const page = await application.firstWindow();
        await page
          .screenshot({ path: "artifacts/first-use-failed.png" })
          .catch(() => {});
      }
      throw error;
    } finally {
      await application?.close();
      // Delete only the disposable profile's own labelled container/volume.
      const data = await readFile(
        join(root, "roopre/private/onboarding.json"),
        "utf8",
      )
        .then(JSON.parse)
        .catch(() => undefined);
      const id = data?.database?.id;
      if (typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)) {
        const name = `roopre-db-${id}`;
        const owned = await command("docker", [
          "inspect",
          "--format",
          '{{index .Config.Labels "dev.roopre.profile"}}',
          name,
        ]);
        if (owned.code === 0 && owned.output.trim() === id) {
          await command("docker", ["rm", "-f", name]);
          await command("docker", ["volume", "rm", `roopre-data-${id}`]);
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
