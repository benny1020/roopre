import { ownerFixture } from "../fixtures/workspace.ts";
import { emptyWorkspace } from "../../src/database/initial.ts";
import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/database/store.ts";
import { commandSchema } from "../../src/shared/contracts.ts";

// Real renderer + PostgreSQL/domain, with an explicit test-only IPC transport.
// This does NOT validate Electron IPC, macOS authentication, Keychain or model calls.
const test = base.extend<{ store: Store; seeded: boolean }>({
  seeded: [true, { option: true }],
  store: async ({ seeded }, use) => {
    const store = new Store(
      `test-web-${randomUUID()}`,
      undefined,
      "local-owner",
      seeded ? ownerFixture : emptyWorkspace,
    );
    await store.init();
    try {
      await use(store);
    } finally {
      for (const table of ["commands", "events"])
        await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
          store.key,
        ]);
      await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
      await store.close();
    }
  },
});

test.describe("fresh installation", () => {
  test.use({ seeded: false });
  test("empty workspace supports settings and first project creation", async ({
    page,
    store,
  }) => {
    expect((await store.read("owner")).projects).toHaveLength(0);
    await expect(
      page.getByRole("heading", { name: "내 프로젝트로 시작하세요" }),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/empty-workspace.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "지침 · 팀 설정", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "지침 · 팀 설정", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "새 지침 버전 게시" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "프로젝트 기준 저장" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "표준 · 연결 · 환경", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "실행 프로필 저장" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /^내 할 일/ }).click();
    await page
      .getByRole("button", { name: "프로젝트 만들기", exact: true })
      .click();
    await page
      .getByLabel("프로젝트 이름", { exact: true })
      .fill("My first project");
    await page
      .getByLabel("설명", { exact: true })
      .fill("Created from an empty installation");
    await page
      .getByRole("dialog", { name: "새 프로젝트" })
      .getByRole("button", { name: "프로젝트 만들기", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "My first project", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "My first project", exact: true }),
    ).toBeVisible();
    const state = await store.read("owner");
    expect(state.projects).toHaveLength(1);
    expect(state.people.map((person) => person.id)).toEqual(["owner"]);
    expect(state.features).toHaveLength(0);
  });
});
test.beforeEach(async ({ page, store }) => {
  await page.route("**/__test/*", async (route) => {
    const op = new URL(route.request().url()).pathname.split("/").at(-1);
    try {
      const value =
        op === "snapshot"
          ? await store.read("owner")
          : op === "command"
            ? await store.execute(
                "owner",
                randomUUID(),
                commandSchema.parse(route.request().postDataJSON()),
              )
            : [];
      await route.fulfill({ json: { value } });
    } catch (e) {
      await route.fulfill({
        status: 400,
        json: { error: (e as Error).message },
      });
    }
  });
  await page.addInitScript(() => {
    const request = async (op: string, body?: unknown) => {
      const response = await fetch(`/__test/${op}`, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json()) as {
        error?: string;
        value: unknown;
      };
      if (!response.ok) throw Error(data.error);
      return data.value;
    };
    (globalThis as any).roopre = {
      snapshot: () => request("snapshot"),
      command: (c: unknown) => request("command", c),
      connections: () => request("connections"),
    };
  });
  await page.goto("/");
  await expect(page.getByText("동기화됨", { exact: true })).toBeVisible();
});

test("temporary database loss preserves the last screen and clears the warning on reconnect", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^표준 · 연결/ }).click();
  let calls = 0;
  await page.route("**/__test/snapshot", async (route) => {
    if (++calls <= 2)
      await route.fulfill({
        status: 503,
        json: { error: "fixture DB unavailable" },
      });
    else await route.fallback();
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "연결 복구 중" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "표준 · 연결 · 실행 환경" }),
  ).toBeVisible();
  await expect(page.getByText("동기화됨", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "연결 복구 중" }),
  ).toHaveCount(0);
});
test("theme choice persists and system mode follows OS appearance", async ({
  page,
}) => {
  await page.getByLabel("화면 테마").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".nav-item.active")).toHaveCSS(
    "background-color",
    "rgb(32, 36, 43)",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("화면 테마").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("project and feature persist while unapproved execution stays blocked", async ({
  page,
  store,
}) => {
  await page
    .getByRole("button", { name: "프로젝트 추가", exact: true })
    .click();
  await page
    .getByLabel("프로젝트 이름", { exact: true })
    .fill("Web regression project");
  await page
    .getByLabel("설명", { exact: true })
    .fill("Isolated UI workflow evidence");
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Web regression project", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "새 기능", exact: true }).click();
  await page
    .getByLabel("기능 이름", { exact: true })
    .fill("Approval boundary scenario");
  await page
    .getByLabel("목표와 완료 기준", { exact: true })
    .fill("AC01 unapproved work cannot start");
  await page.getByRole("button", { name: "기능 만들기", exact: true }).click();
  await page.getByRole("tab", { name: "실행·결과", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "개발 시작", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "개발 시작", exact: true }),
  ).toBeDisabled();
  const state = await store.read("owner");
  expect(state.features[0].title).toBe("Approval boundary scenario");
  expect(state.runs).toHaveLength(0);
});
test("execution profile edits survive periodic refresh and overview explains capacity", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "표준 · 연결 · 환경", exact: true })
    .click();
  await page.getByLabel("실행당 추정 예산 (USD)", { exact: true }).fill("4.5");
  await page.getByLabel("기준 브랜치", { exact: true }).fill("feature/draft");
  // Observe more than one scheduled snapshot; refresh must not overwrite local input.
  await page.waitForResponse((r) => r.url().endsWith("/__test/snapshot"));
  await page.waitForResponse((r) => r.url().endsWith("/__test/snapshot"));
  await expect(
    page.getByLabel("실행당 추정 예산 (USD)", { exact: true }),
  ).toHaveValue("4.5");
  await expect(page.getByLabel("기준 브랜치", { exact: true })).toHaveValue(
    "feature/draft",
  );
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByLabel("화면 테마").selectOption("dark");
  await page.locator(".runtime-settings").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "artifacts/runtime-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.getByLabel("화면 테마").selectOption("light");
  await page.screenshot({
    path: "artifacts/runtime-light-minimum.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^실행 현황/ }).click();
  await expect(
    page.getByText("동시에 최대 2개 프로젝트를 실행합니다.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "아직 실행한 작업이 없습니다" }),
  ).toBeVisible();
});

test("custom agent Markdown, project workflow and instruction provenance survive reload", async ({
  page,
  store,
}) => {
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
    .click();
  await page
    .getByRole("button", { name: "에이전트 만들기", exact: true })
    .click();
  await page.getByLabel("에이전트 이름", { exact: true }).fill("컨벤션 검증자");
  await page
    .getByLabel("Markdown 지침", { exact: true })
    .fill("# 검토 기준\n\n프로젝트 명명 규칙과 오류 처리 규칙을 확인한다.");
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  await expect(page.locator(".markdown-preview")).toContainText(
    "프로젝트 명명 규칙",
  );
  await page
    .getByRole("button", { name: "에이전트 저장", exact: true })
    .click();
  await expect(
    page.getByText("에이전트 버전을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "기본 흐름 적용", exact: true })
    .click();
  await expect(
    page.getByText("기본 흐름을 적용했습니다.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "검증 에이전트 추가", exact: true })
    .click();
  await page
    .getByLabel("검증 단계 지침", { exact: true })
    .fill("모든 이름은 프로젝트 기준과 대조한다.");
  await page
    .getByRole("button", { name: "개발 흐름 저장", exact: true })
    .click();
  await expect(
    page.getByText("개발 흐름을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("검증 단계 지침", { exact: true })).toHaveValue(
    "모든 이름은 프로젝트 기준과 대조한다.",
  );
  await page
    .getByRole("button", { name: "적용 지침 확인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "현재 편집 중인 흐름의 지침 미리보기" }),
  ).toBeVisible();
  await expect(page.locator(".markdown-preview")).toContainText("전역 v1");
  const w = await store.read("owner");
  expect(
    w.projects[0].workflow!.assignments.filter(
      (a) => a.stage === "verification",
    ),
  ).toHaveLength(2);
  expect(w.agents).toHaveLength(6);
  expect(w.runs).toHaveLength(0);
  await page.getByLabel("화면 테마").selectOption("dark");
  await page.locator(".harness-panel").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "artifacts/harness-dark.png",
    fullPage: true,
    animations: "disabled",
  });
});
