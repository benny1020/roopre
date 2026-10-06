import {
  HarnessLibrary,
  harnessApplyRequestId,
} from "../../src/main/harness/library.ts";
import { defaultPackage } from "../../src/shared/default-package.ts";
import { exportProject } from "../../src/domain/harness-package.ts";
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
      page.getByRole("heading", { name: "Start with your project" }),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/empty-workspace.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Instructions & team", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Instructions & team", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish instructions" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Save project standards" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Standards, connections & runtime",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Save execution profile" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /^Home/ }).click();
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await page
      .getByLabel("Project name", { exact: true })
      .fill("My first project");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Created from an empty installation");
    await page
      .getByRole("dialog", { name: "New project" })
      .getByRole("button", { name: "Create project", exact: true })
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
  const library = new HarnessLibrary();
  await page.route("**/__test/*", async (route) => {
    const op = new URL(route.request().url()).pathname.split("/").at(-1);
    try {
      let special: unknown;
      const input = route.request().postData()
        ? route.request().postDataJSON()
        : undefined;
      if (op === "harnessCandidate") {
        if (input.kind === "default")
          special = library.add(defaultPackage(), { kind: "editor" });
        else if (input.kind === "json")
          special = library.add(JSON.parse(input.text), { kind: "editor" });
        else if (input.kind === "project") {
          const w = await store.read("owner");
          const p = w.projects.find((p) => p.id === input.projectId)!;
          special = library.add(
            exportProject(w, p, {
              id: p.harness?.package.id ?? "fixture.standard",
              version: p.harness?.package.version ?? "1.0.0",
              name: "Fixture export",
            }),
            { kind: "editor" },
          );
        }
      }
      if (op === "harnessApply") {
        const candidate = library.get(input.token);
        special = await store.execute(
          "owner",
          harnessApplyRequestId(input.token, input),
          {
            type: "apply_harness_package",
            projectId: input.projectId,
            profileId: input.profileId,
            expectedRevision: input.expectedRevision,
            package: candidate.package,
            source: candidate.source,
            bindings: {},
          },
        );
      }
      const value =
        special ??
        (op === "snapshot"
          ? await store.read("owner")
          : op === "command"
            ? await store.execute(
                "owner",
                randomUUID(),
                commandSchema.parse(route.request().postDataJSON()),
              )
            : []);
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
      harnessCandidate: (input: unknown) => request("harnessCandidate", input),
      harnessApply: (input: unknown) => request("harnessApply", input),
    };
  });
  await page.goto("/");
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
});

test("temporary database loss preserves the last screen and clears the warning on reconnect", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /^Standards, connections/ }).click();
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
    page.getByRole("alert").filter({ hasText: "Reconnecting" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Standards, connections & runtime" }),
  ).toBeVisible();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Reconnecting" }),
  ).toHaveCount(0);
});
test("theme choice persists and system mode follows OS appearance", async ({
  page,
}) => {
  await page.getByLabel("Appearance").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".nav-item.active")).toHaveCSS(
    "background-color",
    "rgb(28, 32, 38)",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Appearance").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("project and feature persist while unapproved execution stays blocked", async ({
  page,
  store,
}) => {
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Web regression project");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Isolated UI workflow evidence");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Web regression project", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New feature", exact: true }).click();
  await page
    .getByLabel("Feature name", { exact: true })
    .fill("Approval boundary scenario");
  await page
    .getByLabel("Goal and acceptance criteria", { exact: true })
    .fill("AC01 unapproved work cannot start");
  await page
    .getByRole("button", { name: "Create feature", exact: true })
    .click();
  await page.getByRole("tab", { name: "Build & verify", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start implementation", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start implementation", exact: true }),
  ).toBeDisabled();
  const state = await store.read("owner");
  expect(state.features[0].title).toBe("Approval boundary scenario");
  expect(state.runs).toHaveLength(0);
});
test("execution profile edits survive periodic refresh and overview explains capacity", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Standards, connections & runtime",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Estimated budget per run (USD)", { exact: true })
    .fill("4.5");
  await page.getByLabel("Base branch", { exact: true }).fill("feature/draft");
  // Observe more than one scheduled snapshot; refresh must not overwrite local input.
  await page.waitForResponse((r) => r.url().endsWith("/__test/snapshot"));
  await page.waitForResponse((r) => r.url().endsWith("/__test/snapshot"));
  await expect(
    page.getByLabel("Estimated budget per run (USD)", { exact: true }),
  ).toHaveValue("4.5");
  await expect(page.getByLabel("Base branch", { exact: true })).toHaveValue(
    "feature/draft",
  );
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByLabel("Appearance").selectOption("dark");
  await page.locator(".runtime-settings").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "artifacts/runtime-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.getByLabel("Appearance").selectOption("light");
  await page.screenshot({
    path: "artifacts/runtime-light-minimum.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Workspace run limit", { exact: true }).fill("4");
  await page.getByLabel("Runs per project", { exact: true }).fill("2");
  await page.getByLabel("Parallel agents per stage", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Save execution capacity", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Navigation" })
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await expect(page.getByText("Up to 4 runs", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No runs yet" }),
  ).toBeVisible();
});

test("custom agent Markdown, project workflow and instruction provenance survive reload", async ({
  page,
  store,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await page
    .getByLabel("Agent name", { exact: true })
    .fill("Convention reviewer");
  await page
    .getByLabel("Markdown instructions", { exact: true })
    .fill("# 검토 기준\n\n프로젝트 명명 규칙과 오류 처리 규칙을 확인한다.");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".markdown-preview")).toContainText(
    "프로젝트 명명 규칙",
  );
  await page.getByRole("button", { name: "Save agent", exact: true }).click();
  await expect(
    page.getByText("Agent version saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use default workflow", exact: true })
    .click();
  await expect(
    page.getByText("Default workflow applied.", { exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await expect(
    page.getByLabel("Verification Execution mode", { exact: true }),
  ).toHaveValue("parallel");
  await page.getByTestId("rf__node-design").locator("strong").first().click();
  await page
    .getByLabel("Design Execution mode", { exact: true })
    .selectOption("sequential");
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await page
    .getByTestId("rf__node-verification")
    .getByRole("button", { name: "Add agent to Verification", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Add agent to Verification" })
    .getByRole("button", { name: /Convention/ })
    .click();
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await page
    .getByLabel("Verification Stage instructions", { exact: true })
    .fill("모든 이름은 프로젝트 기준과 대조한다.");
  await page
    .getByRole("button", { name: "Save workflow", exact: true })
    .click();
  await expect(
    page.getByText("Workflow saved.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByTestId("rf__node-design").locator("strong").first().click();
  await expect(
    page.getByLabel("Design Execution mode", { exact: true }),
  ).toHaveValue("sequential");
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await expect(
    page.getByLabel("Verification Execution mode", { exact: true }),
  ).toHaveValue("parallel");
  await page.screenshot({
    path: "artifacts/parallel-stage-settings.png",
    fullPage: true,
  });
  await expect(
    page.getByLabel("Verification Stage instructions", { exact: true }),
  ).toHaveValue("모든 이름은 프로젝트 기준과 대조한다.");
  await page
    .getByRole("button", { name: "Inspect instructions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Instructions for the workflow draft" }),
  ).toBeVisible();
  await expect(page.locator(".markdown-preview")).toContainText("Global v1");
  const w = await store.read("owner");
  expect(
    w.projects[0].workflow!.assignments.filter(
      (a) => a.stage === "verification",
    ),
  ).toHaveLength(2);
  expect(w.agents).toHaveLength(6);
  expect(w.runs).toHaveLength(0);
  await page.getByLabel("Appearance").selectOption("dark");
  await page.locator(".harness-panel").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "artifacts/harness-dark.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("harness standard edits, previews, applies atomically and persists feature directory settings", async ({
  page,
  store,
}) => {
  const secondProject = (
    await store.execute("owner", randomUUID(), {
      type: "create_project",
      name: "Second standard project",
      description: "",
      reviewerIds: ["owner"],
    })
  ).entityId!;
  await store.execute("owner", randomUUID(), {
    type: "create_feature",
    projectId: "first-project",
    title: "결제 범위 테스트",
    requirements: "AC01 verify payment",
    template: "feature",
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Harness standards", exact: true })
    .click();
  await page.getByRole("button", { name: "Start from defaults" }).click();
  await expect(
    page.getByRole("heading", { name: /Roopre development standard/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit specification", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Validate changes", exact: true }),
  ).toBeEnabled();
  const editor = page.getByLabel("Standard definition JSON", { exact: true });
  const spec = JSON.parse(await editor.inputValue());
  spec.id = "company.commerce";
  spec.name = "결제팀 개발 표준";
  spec.profiles[0].scopes = [
    {
      id: "checkout",
      name: "결제 영역",
      paths: ["src/checkout/"],
      instructions: "결제 검증 마커",
    },
  ];
  await editor.fill(JSON.stringify(spec));
  await expect(
    page.getByRole("button", { name: "Apply to project", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Validate changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply to project", exact: true })
    .click();
  await expect(page.getByText(/Standard applied/)).toBeVisible();
  let state = await store.read("owner");
  const project = state.projects[0];
  expect(project.harness?.package.id).toBe("company.commerce");
  expect(project.workflow?.assignments).toHaveLength(7);
  const beforeIds = Object.values(project.harness!.agents);
  await page
    .getByLabel("Standards project", { exact: true })
    .selectOption(secondProject);
  await page
    .getByRole("button", { name: "Apply to project", exact: true })
    .click();
  await expect(page.getByText(/Standard applied/)).toBeVisible();
  expect(
    (await store.read("owner")).projects.find((p) => p.id === secondProject)!
      .harness?.digest,
  ).toBe(project.harness!.digest);
  await page
    .getByLabel("Standards project", { exact: true })
    .selectOption(project.id);
  await page
    .getByRole("button", { name: "Refresh comparison", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start from defaults", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit specification", exact: true })
    .click();
  await editor.fill(JSON.stringify(spec));
  await page
    .getByRole("button", { name: "Validate changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply to project", exact: true })
    .click();
  await expect(page.getByText(/Standard applied/)).toBeVisible();
  state = await store.read("owner");
  expect(Object.values(state.projects[0].harness!.agents)).toEqual(beforeIds);
  await page
    .getByRole("button", { name: "Files & Markdown", exact: true })
    .click();
  await page
    .getByRole("button", { name: "agents/convention-reviewer.md", exact: true })
    .click();
  await expect(
    page.getByLabel("Harness Markdown", { exact: true }),
  ).toContainText(/global and project/);
  await page
    .getByLabel("결제 범위 테스트 Feature scope", { exact: true })
    .selectOption("checkout");
  await expect(
    page.getByLabel("결제 범위 테스트 Feature scope", { exact: true }),
  ).toHaveValue("checkout");
  expect(
    (await store.read("owner")).features.find(
      (f) => f.title === "결제 범위 테스트",
    )!.harnessScope,
  ).toBe("checkout");
  await page.getByLabel("Appearance").selectOption("dark");
  await page.screenshot({
    path: "artifacts/harness-package-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Harness standards", exact: true })
    .click();
  await expect(
    page.getByText("Applied standard · 결제팀 개발 표준", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("결제 범위 테스트 Feature scope", { exact: true }),
  ).toHaveValue("checkout");
});
