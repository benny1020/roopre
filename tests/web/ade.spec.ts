import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adeFixture, patch } from "../fixtures/ade";
import { gate } from "../../src/shared/contracts";
const state = adeFixture();
async function prepare(page: Page, state = adeFixture(), conversation?: any) {
  await page.addInitScript(
    ({ state, patch, conversation }) => {
      const w = globalThis as unknown as {
        roopre: unknown;
        __diffResolvers: Record<string, (s: string) => void>;
        __revealed: unknown[];
      };
      w.__diffResolvers = {};
      w.__revealed = [];
      w.roopre = {
        snapshot: async () => state,
        connections: async () => [],
        command: async () => {
          throw Error("No mutation in ADE display fixture");
        },
        runAction: async (id: string, action: string) => {
          if (action === "diff")
            return new Promise<string>((resolve) => {
              w.__diffResolvers[id] = resolve;
            });
          throw Error("unsupported");
        },
        revealArtifact: async (...args: unknown[]) => {
          w.__revealed.push(args);
        },
      };
      if (conversation) {
        (w.roopre as any).conversations = {
          listThreads: async () => [conversation.thread],
          getThread: async () => conversation.thread,
          listTurns: async () => conversation.turns || [],
          sendTurn: async () => {
            throw Error("unused");
          },
          cancelTurn: async () => true,
          resetSummary: async () => conversation.thread,
          deleteThread: async (input: any) => {
            (globalThis as any).__deleteInputs.push(input);
          },
        };
        (globalThis as any).__deleteInputs = [];
      }
      if (localStorage.getItem("owner:selected") === null)
        localStorage.setItem(
          "owner:selected",
          JSON.stringify(state.features[0].id),
        );
      localStorage.setItem(
        `owner:tab:${state.features[0].id}`,
        JSON.stringify("execution"),
      );
      localStorage.setItem("theme", JSON.stringify("dark"));
    },
    { state, patch, conversation },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: state.features[0].title, exact: true }),
  ).toBeVisible();
  if (state.runs.length)
    await page.getByRole("tab", { name: /^Verification/ }).click();
}
async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}

async function openPortfolio(page: Page) {
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  const search = page.getByRole("combobox", {
    name: "Search commands and work",
  });
  await search.fill("Workspace overview");
  await search.press("Enter");
}

function simpleApprovalState() {
  const snapshot = adeFixture();
  const feature = snapshot.features[0];
  const design = feature.designs.at(-1)!;
  design.reviewers = ["owner"];
  feature.threads = [];
  snapshot.gates[feature.id] = gate(snapshot, feature);
  snapshot.approvalBindings = {
    [feature.id]: "b".repeat(64),
  };
  return { snapshot, feature, design };
}

async function prepareHome(page: Page, state = adeFixture()) {
  await page.addInitScript((state) => {
    (globalThis as any).roopre = {
      snapshot: async () => state,
      connections: async () => [],
      command: async () => {
        throw Error("No mutation in home fixture");
      },
      runAction: async () => {
        throw Error("No run action in home fixture");
      },
      revealArtifact: async () => undefined,
    };
    localStorage.setItem("theme", JSON.stringify("dark"));
  }, state);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Development workspace", exact: true }),
  ).toBeVisible();
}

test("home explains the full development flow before exposing advanced control", async ({
  page,
}) => {
  const state = adeFixture();
  await prepareHome(page, state);

  const primary = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  await expect(primary.getByRole("button")).toHaveCount(4);
  await expect(primary.getByRole("button").nth(0)).toContainText("Home");
  await expect(primary.getByRole("button").nth(1)).toContainText("Work");
  await expect(primary.getByRole("button").nth(2)).toContainText("Quality");
  await expect(primary.getByRole("button").nth(3)).toContainText("Agents");
  await expect(
    page.getByRole("heading", { name: "Needs your attention" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Project flow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Workspace overview/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Quality evidence/ }),
  ).toBeVisible();
  await expect(
    page.locator(".project-flow-row").first().locator(".flow-step"),
  ).toHaveCount(3);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "artifacts/flow-home-dark.png",
    fullPage: true,
  });
  await axe(page);
  await page.getByLabel("Appearance").selectOption("light");
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.screenshot({
    path: "artifacts/flow-home-light-1024.png",
    fullPage: true,
  });
  await axe(page);

  await page.evaluate(
    ({ featureId, runId }) =>
      localStorage.setItem(`ade:run:${featureId}`, runId),
    {
      featureId: state.features[0].id,
      runId: "ade-run-previous",
    },
  );
  await page.locator(".project-flow-row").first().click();
  await expect(
    page.getByRole("heading", { name: state.features[0].title, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".work-context .flow-step")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: /^Plan/ })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Build & verify", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Rules", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-current");
});

test("quality intelligence exposes evidence denominators and opens the exact run", async ({
  page,
}) => {
  const quality = adeFixture();
  const current = quality.runs.at(-1)!;
  current.status = "ready_for_merge";
  current.runtime!.terminationConfirmed = true;
  current.runtime!.review = "AC와 고정 검사를 확인했습니다.";
  current.runtime!.harness = {
    version: 1,
    workflowRevision: 4,
    agents: [],
  };
  current.runtime!.evidence.push({
    name: "test",
    status: "passed",
    code: 0,
    at: current.at,
    tree: "f".repeat(40),
    log: "all passed",
    attempt: current.runtime!.attempt,
  });
  await prepareHome(page, quality);
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Quality" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Standards backed by results" }),
  ).toBeVisible();
  await expect(page.getByLabel("Quality metrics")).toContainText("Ready rate");
  await expect(page.getByLabel("Quality metrics")).toContainText(
    "Complete evidence",
  );
  await expect(page.getByText(/Early evidence/)).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "artifacts/quality-intelligence-dark.png",
    fullPage: true,
  });
  await axe(page);
  await page.getByLabel("Appearance").selectOption("light");
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.screenshot({
    path: "artifacts/quality-intelligence-light-1024.png",
    fullPage: true,
  });
  await axe(page);

  await page
    .getByRole("button", {
      name: new RegExp(`Ready for review, attempt ${current.runtime!.attempt}`),
    })
    .click();
  await expect(page.getByLabel("Select run")).toHaveValue(current.id);
});

test("quality intelligence keeps incomplete runtime and invalid costs visible", async ({
  page,
}) => {
  const quality = adeFixture();
  quality.runs[0].runtime = undefined;
  quality.runs[1].runtime!.costReported = true;
  quality.runs[1].runtime!.costUsd = -1;
  await prepareHome(page, quality);
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Quality" })
    .click();

  await expect(
    page.getByText(
      "1 runs without environment records are excluded from metrics.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("1 invalid cost records are excluded from the total."),
  ).toBeVisible();
  await expect(page.locator(".quality-clear")).toHaveCount(0);
  await expect(page.locator(".quality-table-row").first()).toContainText(
    "Invalid value 1",
  );
  await expect(page.locator(".quality-table-row").first()).not.toContainText(
    "Reported",
  );
  await axe(page);
});

test("home agent rows always open the current run", async ({ page }) => {
  const active = adeFixture();
  await prepareHome(page, active);
  await page.evaluate(
    ({ featureId, runId }) =>
      localStorage.setItem(`ade:run:${featureId}`, runId),
    { featureId: active.features[0].id, runId: "ade-run-previous" },
  );
  await page.locator(".agent-activity-row").first().click();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-current");
});

test("home decision rows always open the current run", async ({ page }) => {
  const decision = adeFixture();
  decision.runs.at(-1)!.status = "ready_for_merge";
  decision.runs.at(-1)!.runtime!.terminationConfirmed = true;
  await prepareHome(page, decision);
  await page.evaluate(
    ({ featureId, runId }) =>
      localStorage.setItem(`ade:run:${featureId}`, runId),
    { featureId: decision.features[0].id, runId: "ade-run-previous" },
  );
  await page.locator(".home-work-row").first().click();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-current");
});

test("local owner confirms the displayed design without a checklist", async ({
  page,
}) => {
  const { snapshot, feature, design } = simpleApprovalState();
  await prepare(page, snapshot);
  await page.evaluate(() => {
    const w = globalThis as any;
    w.__reviewCommands = [];
    w.roopre.command = async (command: unknown) => {
      w.__reviewCommands.push(command);
      return {};
    };
  });
  await page.getByRole("tab", { name: /Plan/ }).click();
  await expect(page.getByLabel("Design review brief")).toContainText(
    "Change impact",
  );
  await expect(page.getByLabel("Design review brief")).toContainText(
    "Verification plan",
  );
  await expect(page.getByText("Design review checklist")).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.screenshot({ path: "artifacts/ade-simple-confirmation-dark.png" });
  await page.getByLabel("Appearance").selectOption("light");
  await page.screenshot({
    path: "artifacts/ade-simple-confirmation-light.png",
  });
  await page
    .getByRole("button", { name: `Approve design v${design.number}` })
    .click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as any).__reviewCommands))
    .toEqual([
      {
        type: "review",
        featureId: feature.id,
        designId: design.id,
        decision: "approve",
        checked: [],
        confirmationBinding: "b".repeat(64),
      },
    ]);
  await axe(page);
});

test("local confirmation keeps blocker and old-version protections", async ({
  page,
}) => {
  const { snapshot, feature, design } = simpleApprovalState();
  const newer = { ...structuredClone(design), id: "newer-design", number: 2 };
  feature.designs.push(newer);
  feature.threads.push({
    id: "blocking-review",
    designId: newer.id,
    section: "예외 상황",
    quote: "",
    authorId: "owner",
    body: "차단 사유",
    blocking: true,
    status: "open",
    replies: [],
    at: new Date().toISOString(),
  });
  snapshot.gates[feature.id] = gate(snapshot, feature);
  await prepare(page, snapshot);
  await page.getByRole("tab", { name: /Plan/ }).click();
  await expect(
    page.getByRole("button", { name: `Approve design v${newer.number}` }),
  ).toBeDisabled();
  await page.getByLabel("Design version").selectOption(design.id);
  await expect(
    page.getByText(
      "This is an older version. Add approvals and comments to the latest design.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Approve design v1/ }),
  ).toHaveCount(0);
});

test("local confirmation shows a save error without losing the displayed report", async ({
  page,
}) => {
  const { snapshot, design } = simpleApprovalState();
  await prepare(page, snapshot);
  await page.evaluate(() => {
    (globalThis as any).roopre.command = async () => {
      throw Error("확인 정보가 변경되었습니다. 최신 설계를 다시 확인하세요.");
    };
  });
  await page.getByRole("tab", { name: /Plan/ }).click();
  await page
    .getByRole("button", { name: `Approve design v${design.number}` })
    .click();
  await expect(
    page.getByText("확인 정보가 변경되었습니다. 최신 설계를 다시 확인하세요."),
  ).toBeVisible();
  await expect(page.getByLabel("Design review brief")).toContainText(
    "Verification plan",
  );
});

test("run-specific diff rejects stale responses, checks retain attempt identity, artifacts dispatch", async ({
  page,
}) => {
  await prepare(page);
  await expect(page.getByText("Current attempt 2 · Result 1")).toBeVisible();
  await expect(
    page.getByText("Previous-attempt checks 1 · Not evidence for this attempt"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.getByRole("button", { name: "Load changes" }).click();
  await page.getByLabel("Select run").selectOption("ade-run-previous");
  await page.evaluate(() => {
    (globalThis as any).__diffResolvers["ade-run-current"](
      "WRONG CURRENT PATCH",
    );
  });
  await expect(page.getByText("WRONG CURRENT PATCH")).toHaveCount(0);
  await page.getByRole("button", { name: "Load changes" }).click();
  await page.evaluate((patch) => {
    (globalThis as any).__diffResolvers["ade-run-previous"](patch);
  }, patch);
  await expect(
    page.getByRole("navigation", { name: "Changed files" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /tests\/payment.test.ts/ }).click();
  await expect(
    page.getByRole("region", { name: "File changes" }),
  ).toContainText("duplicate payment is never retried");
  await page.getByRole("tab", { name: "Artifacts" }).click();
  await page.getByRole("button", { name: /tests\/report.txt/ }).click();
  expect(await page.evaluate(() => (globalThis as any).__revealed)).toEqual([
    ["ade-run-previous", 0],
  ]);
});

test("portfolio is read-only, separates queued work from active agents, and stays usable at 1024px", async ({
  page,
}) => {
  const portfolio = adeFixture();
  const current = portfolio.runs.at(-1)!;
  current.status = "queued";
  current.runtime!.costReported = false;
  await prepare(page, portfolio);
  await openPortfolio(page);
  await expect(
    page.getByRole("heading", { name: "Workspace overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Global occupied slots · queue in scope 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Active agents in scope", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/missing 1 runs/)).toBeVisible();
  await page
    .getByRole("button", { name: portfolio.features[0].title, exact: false })
    .last()
    .click();
  await expect(
    page.getByText("Evidence for this attempt", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Checks 1 · Artifacts 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Roles", exact: true }).click();
  await expect(
    page.getByText("No current run", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agent workspace", exact: true })
    .click();
  await expect(
    page.getByText("Only seats with execution records are shown.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No current run", { exact: true }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 700 });
  expect(
    await page.evaluate(
      () =>
        (globalThis as any).document.documentElement.scrollWidth <=
        (globalThis as any).innerWidth,
    ),
  ).toBe(true);
  await axe(page);
});

test("conversation scopes keep drafts and delayed replies with their selected feature", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const agentId = "00000000-0000-4000-8000-000000000099";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "상담 구현 에이전트",
      description: "fixture",
      capability: "implementation",
      connectionId: "00000000-0000-4000-8000-000000000001",
      connectionVersion: 1,
      markdown: "fixture",
      archived: false,
    },
  ];
  await prepare(page, state);
  await page.evaluate(() => {
    const threads = new Map<string, any>();
    const turns = new Map<string, any[]>();
    let resolveFirst: ((value: any) => void) | undefined;
    (globalThis as any).__resolveSlowConversation = () =>
      resolveFirst?.(undefined);
    (globalThis as any).roopre.conversations = {
      listThreads: async (scope: any) =>
        [threads.get(scope.featureId)].filter(Boolean),
      getThread: async (id: string) =>
        [...threads.values()].find((thread) => thread.id === id),
      listTurns: async ({ threadId }: any) => turns.get(threadId) || [],
      cancelTurn: async () => true,
      resetSummary: async ({ threadId }: any) =>
        [...threads.values()].find((thread) => thread.id === threadId),
      sendTurn: (input: any) =>
        new Promise((resolve) => {
          const id = `00000000-0000-4000-8000-${input.scope.featureId.endsWith("checkout") ? "000000000101" : "000000000102"}`;
          const thread = threads.get(input.scope.featureId) || {
            id,
            scope: input.scope,
            revision: 0,
            epoch: 0,
            archived: false,
            summary: null,
            summaryThrough: null,
            summaryRevision: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          threads.set(input.scope.featureId, thread);
          const turn = {
            id: `00000000-0000-4000-8000-000000000201`,
            threadId: id,
            ordinal: 1,
            requestId: input.requestId,
            input: input.message,
            answer: "늦은 A 답변",
            status: "completed",
            retryOf: null,
            error: null,
            contextManifest: {
              agentRevision: 1,
              memories: [],
              recentTurnIds: [],
              searchTurnIds: [],
              excluded: [],
            },
            usage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          resolveFirst = () => {
            turns.set(id, [turn]);
            resolve({ thread, turn });
          };
        }),
    };
  });
  await openPortfolio(page);
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await page.getByLabel("Consultation message").fill("A 초안");
  await page.getByRole("button", { name: "Send question" }).click();
  await page
    .getByRole("button", { name: state.features[1].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await page.getByLabel("Consultation message").fill("B 초안");
  await page.evaluate(() => (globalThis as any).__resolveSlowConversation());
  await expect(page.getByLabel("Consultation message")).toHaveValue("B 초안");
  await expect(page.getByText("늦은 A 답변", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(page.getByText("늦은 A 답변", { exact: true })).toBeVisible();
});

test("execution-seat consultation keeps the selected assignment when one agent has two stages", async ({
  page,
}) => {
  const state = adeFixture();
  const agentId = "00000000-0000-4000-8000-000000000111";
  const requirementsAssignment = "00000000-0000-4000-8000-000000000112";
  const designAssignment = "00000000-0000-4000-8000-000000000113";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "두 단계 상담 에이전트",
      description: "fixture",
      capability: "read-only",
      connectionId: "00000000-0000-4000-8000-000000000001",
      connectionVersion: 1,
      markdown: "fixture",
      archived: false,
    },
  ];
  state.projects[0].workflow = {
    revision: 1,
    instructions: {
      requirements: "requirements fixture",
      design: "design fixture",
      implementation: "implementation fixture",
      verification: "verification fixture",
      review: "review fixture",
    },
    assignments: [
      {
        id: requirementsAssignment,
        agentId,
        stage: "requirements",
        required: true,
      },
      {
        id: designAssignment,
        agentId,
        stage: "design",
        required: true,
      },
    ],
  };
  const run = state.runs.at(-1)!;
  const execution = run.runtime!.agents![0];
  run.runtime!.agents = [
    {
      ...execution,
      id: "requirements-execution",
      assignmentId: requirementsAssignment,
      name: "두 단계 상담 에이전트",
      stage: "requirements",
      status: "running",
    },
    {
      ...execution,
      id: "design-execution",
      assignmentId: designAssignment,
      name: "두 단계 상담 에이전트",
      stage: "design",
      status: "running",
    },
  ];
  await prepare(page, state);
  await page.evaluate(() => {
    const thread = {
      id: "00000000-0000-4000-8000-000000000114",
      revision: 1,
      epoch: 0,
      archived: false,
      summary: null,
      summaryThrough: null,
      summaryRevision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    (globalThis as any).__conversationInputs = [];
    (globalThis as any).roopre.conversations = {
      listThreads: async () => [],
      getThread: async () => thread,
      listTurns: async () => [],
      sendTurn: async (input: any) => {
        (globalThis as any).__conversationInputs.push(input);
        return {
          thread,
          turn: {
            id: "00000000-0000-4000-8000-000000000115",
            threadId: thread.id,
            ordinal: 1,
            requestId: input.requestId,
            input: input.message,
            answer: null,
            status: "pending",
            retryOf: null,
            error: null,
            contextManifest: {
              agentRevision: 1,
              memories: [],
              recentTurnIds: [],
              searchTurnIds: [],
              excluded: [],
            },
            usage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
      cancelTurn: async () => true,
      resetSummary: async () => thread,
      deleteThread: async () => {},
    };
  });
  await openPortfolio(page);
  await page.getByRole("button", { name: "Roles", exact: true }).click();
  await page
    .locator(".portfolio-role-map section")
    .filter({ hasText: "Design" })
    .getByRole("button")
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(page.getByLabel("Consultation assignment")).toHaveValue(
    designAssignment,
  );
  await page.getByLabel("Consultation message").fill("설계 문맥 질문");
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).__conversationInputs.length),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => (globalThis as any).__conversationInputs[0]),
  ).toMatchObject({
    assignmentId: designAssignment,
    execution: {
      runId: run.id,
      attempt: run.runtime!.attempt,
      executionId: "design-execution",
    },
  });
  await page
    .locator(".portfolio-role-map section")
    .filter({ hasText: "Requirements" })
    .getByRole("button")
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(page.getByLabel("Consultation assignment")).toHaveValue(
    requirementsAssignment,
  );
});

test("answer memory uses its conversation source and requires user confirmation", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const agentId = "00000000-0000-4000-8000-000000000099";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "상담 구현 에이전트",
      description: "fixture",
      capability: "implementation",
      connectionId: "00000000-0000-4000-8000-000000000001",
      connectionVersion: 1,
      markdown: "fixture",
      archived: false,
    },
  ];
  await prepare(page, state);
  await page.evaluate((agentId) => {
    const thread = {
      id: "00000000-0000-4000-8000-000000000401",
      scope: {
        workspaceId: "team-local",
        projectId: "commerce",
        agentDefinitionId: agentId,
        featureId: "feature-checkout",
      },
      revision: 1,
      epoch: 0,
      archived: false,
      summary: null,
      summaryThrough: null,
      summaryRevision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const turn = {
      id: "00000000-0000-4000-8000-000000000402",
      threadId: thread.id,
      ordinal: 1,
      requestId: "00000000-0000-4000-8000-000000000403",
      input: "질문",
      answer: "기억할 답변",
      status: "completed",
      retryOf: null,
      error: null,
      contextManifest: {
        agentRevision: 1,
        memories: [],
        recentTurnIds: [],
        searchTurnIds: [],
        excluded: [],
      },
      usage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const api = (globalThis as any).roopre;
    (globalThis as any).__commands = [];
    api.command = async (command: any) => {
      (globalThis as any).__commands.push(command);
      return {};
    };
    api.conversations = {
      listThreads: async () => [thread],
      getThread: async () => thread,
      listTurns: async () => [turn],
      sendTurn: async () => ({ thread, turn }),
      cancelTurn: async () => true,
      resetSummary: async () => thread,
      deleteThread: async () => {},
    };
  }, agentId);
  await openPortfolio(page);
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(page.getByText("기억할 답변", { exact: true })).toBeVisible();
  await axe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".conversation-turn").scrollIntoViewIfNeeded();
  await page
    .locator(".portfolio-inspector")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "artifacts/conversation-dark-1440.png" });
  await page
    .locator(".conversation-panel")
    .screenshot({ path: "artifacts/conversation-panel-dark-1440.png" });
  await page
    .getByRole("button", { name: "Save as memory", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Memory", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Memory content")).toHaveValue("기억할 답변");
  await expect(
    page.getByText(/conversation:00000000-0000-4000-8000-000000000401/),
  ).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.locator(".theme-select").selectOption("light");
  await page.getByLabel("Memory content").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/memory-light-1024.png" });
  await axe(page);
  await expect(
    page.getByRole("button", { name: "Save as memory", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /project approvals need review again/ })
    .check();
  await page
    .getByRole("button", { name: "Save as memory", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (globalThis as any).__commands[0].memory.sourceRefs[0],
    ),
  ).toEqual({
    type: "conversation",
    threadId: "00000000-0000-4000-8000-000000000401",
    turnId: "00000000-0000-4000-8000-000000000402",
  });
});

test("memory edit preserves source and shows revision conflicts", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const agentId = "00000000-0000-4000-8000-000000000099";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "상담 구현 에이전트",
      description: "fixture",
      capability: "implementation",
      connectionId: "00000000-0000-4000-8000-000000000001",
      connectionVersion: 1,
      markdown: "fixture",
      archived: false,
    },
  ];
  state.projects[0].memories = [
    {
      id: "memory-edit",
      agentDefinitionId: agentId,
      featureId: state.features[0].id,
      title: "기존 기억",
      body: "Previous",
      revision: 3,
      sourceRefs: [{ type: "manual", label: "사용자 결정" }],
      active: true,
      authorId: "owner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  await prepare(page, state);
  await page.evaluate(() => {
    (globalThis as any).roopre.command = async () => {
      throw Error("State changed. Check the latest memory.");
    };
  });
  await openPortfolio(page);
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Memory content").fill("변경 내용");
  await page
    .getByRole("checkbox", { name: /project approvals need review again/ })
    .check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("State changed");
  await expect(page.getByLabel("Memory content")).toHaveValue("변경 내용");
});

test("conversation deletion can atomically deactivate selected derived memories", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const agentId = "00000000-0000-4000-8000-000000000099";
  const threadId = "00000000-0000-4000-8000-000000000501";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "상담 구현 에이전트",
      description: "fixture",
      capability: "implementation",
      connectionId: "00000000-0000-4000-8000-000000000001",
      connectionVersion: 1,
      markdown: "fixture",
      archived: false,
    },
  ];
  state.projects[0].memories = [
    {
      id: "memory-derived",
      agentDefinitionId: agentId,
      featureId: state.features[0].id,
      title: "파생 기억",
      body: "본문",
      revision: 1,
      sourceRefs: [{ type: "conversation", threadId, turnId: "turn-derived" }],
      active: true,
      authorId: "owner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const thread = {
    id: threadId,
    scope: {
      workspaceId: "team-local",
      projectId: "commerce",
      agentDefinitionId: agentId,
      featureId: "feature-checkout",
    },
    revision: 1,
    epoch: 0,
    archived: false,
    summary: null,
    summaryThrough: null,
    summaryRevision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await prepare(page, state, { thread, turns: [] });
  await openPortfolio(page);
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await page.getByText("Summary & references", { exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /파생 기억/ }).check();
  await page
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as any).__deleteInputs.length))
    .toBe(1);
  expect(
    await page.evaluate(() => (globalThis as any).__deleteInputs[0]),
  ).toEqual({ threadId, deactivateDerivedMemoryIds: ["memory-derived"] });
});

test("archived agents retain readable consultation history but cannot send", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const agentId = "00000000-0000-4000-8000-000000000598";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "보관된 상담 에이전트",
      description: "historical fixture",
      capability: "read-only",
      connectionId: "00000000-0000-4000-8000-000000000001",
      connectionVersion: 1,
      markdown: "historical fixture",
      archived: true,
    },
  ];
  const thread = {
    id: "00000000-0000-4000-8000-000000000599",
    scope: {
      workspaceId: "team-local",
      projectId: "commerce",
      agentDefinitionId: agentId,
      featureId: state.features[0].id,
    },
    revision: 1,
    epoch: 0,
    archived: false,
    summary: null,
    summaryThrough: null,
    summaryRevision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const turn = {
    id: "00000000-0000-4000-8000-000000000600",
    threadId: thread.id,
    ordinal: 1,
    requestId: "00000000-0000-4000-8000-000000000601",
    input: "기존 질문",
    answer: "보관된 기록 답변",
    status: "completed",
    retryOf: null,
    error: null,
    contextManifest: {
      agentRevision: 1,
      memories: [],
      recentTurnIds: [],
      searchTurnIds: [],
      excluded: [],
    },
    usage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await prepare(page, state, { thread, turns: [turn] });
  await openPortfolio(page);
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(page.getByLabel("Agent to consult")).toHaveText(/Archived/);
  await expect(
    page.getByText("보관된 기록 답변", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/read its history/)).toBeVisible();
  await page.getByLabel("Consultation message").fill("새 질문");
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeDisabled();
});

test("portfolio command, view, exact historical run, and back navigation preserve context", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs[0].runtime!.agents![0].status = "running";
  state.runs[0].runtime!.agents![0].attempt = state.runs[0].runtime!.attempt;
  state.runs[0].runtime!.heartbeat = new Date().toISOString();
  await prepare(page, state);
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  await page
    .getByRole("combobox", { name: "Search commands and work" })
    .fill("Workspace overview");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Workspace overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Roles", exact: true }).click();
  const previousAgent = page
    .locator(".portfolio-agent")
    .filter({ hasText: "ade-run-previous" });
  await previousAgent.click();
  await expect(previousAgent).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Agent workspace", exact: true })
    .click();
  const workroomAgent = page
    .locator(".agent-workroom-seat")
    .filter({ hasText: "ade-run-previous" });
  await workroomAgent.click();
  await expect(workroomAgent).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1440, height: 940 });
  await axe(page);
  await page.screenshot({ path: "artifacts/workroom-dark-1440.png" });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Agent workspace", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const restoredWorkroomAgent = page
    .locator(".agent-workroom-seat")
    .filter({ hasText: "ade-run-previous" });
  await expect(restoredWorkroomAgent).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Search workspace features").fill("None");
  await expect(
    page
      .getByLabel("Selected work")
      .getByText(
        "Select a feature or run to inspect its status and open its workspace.",
        { exact: true },
      ),
  ).toBeVisible();
  await page.getByLabel("Search workspace features").fill("");
  await restoredWorkroomAgent.click();
  await page.getByLabel("Appearance").selectOption("light");
  await page.setViewportSize({ width: 1024, height: 700 });
  await axe(page);
  await page.screenshot({ path: "artifacts/workroom-light-1024.png" });
  await page
    .getByRole("button", { name: "Open execution and evidence" })
    .click();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-previous");
  await page.getByRole("button", { name: "Back to features" }).click();
  await expect(restoredWorkroomAgent).toBeFocused();
  await page.getByRole("button", { name: "Project flow", exact: true }).click();
  await page
    .getByRole("button", { name: state.features[0].title, exact: false })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Open execution and evidence" })
    .click();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-current");
  await page.getByLabel("Select run").selectOption("ade-run-previous");
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-previous");
  await page.locator(".detail-tabs").getByRole("tab", { name: /Plan/ }).click();
  await page
    .locator(".detail-tabs")
    .getByRole("tab", { name: /Build & verify/ })
    .click();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-previous");
  await page.keyboard.press("Meta+[");
  await expect(
    page.locator(".detail-tabs").getByRole("tab", { name: /Plan/ }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Meta+]");
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-previous");
  await page.getByRole("button", { name: "Back to features" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace overview", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Meta+[");
  await expect(
    page.getByRole("heading", { name: state.features[0].title, exact: true }),
  ).toBeVisible();
});

test("workroom labels stale, stopping and residual execution cards without active color", async ({
  page,
}) => {
  const state = adeFixture();
  const current = state.runs.at(-1)!;
  current.status = "implementing";
  current.runtime!.agents![0].status = "running";
  current.runtime!.heartbeat = new Date(Date.now() - 31_000).toISOString();
  const previous = state.runs[0];
  previous.runtime!.agents![0].status = "running";
  previous.runtime!.agents![0].attempt = previous.runtime!.attempt;
  const stopping = structuredClone(current);
  stopping.id = "ade-run-stopping";
  stopping.runtime!.cancelRequested = true;
  stopping.runtime!.heartbeat = new Date().toISOString();
  state.runs.push(stopping);
  await prepare(page, state);
  await openPortfolio(page);
  await page
    .getByRole("button", { name: "Agent workspace", exact: true })
    .click();
  await expect(page.locator(".agent-workroom-status.is-stale")).toContainText(
    "current state unavailable",
  );
  await expect(
    page.locator(".agent-workroom-status.is-stopping"),
  ).toContainText("Stopping");
  await expect(
    page.locator(".agent-workroom-status.is-residual"),
  ).toContainText("Residual records from a finished run");
  for (const selector of [
    ".agent-workroom-status.is-stale",
    ".agent-workroom-status.is-stopping",
    ".agent-workroom-status.is-residual",
  ])
    await expect(page.locator(selector)).not.toHaveCSS(
      "color",
      "rgb(122, 197, 169)",
    );
});

test("workroom keeps several real execution desks visible across stages", async ({
  page,
}) => {
  const state = adeFixture();
  const current = state.runs.at(-1)!;
  current.status = "implementing";
  current.runtime!.agents![0] = {
    ...current.runtime!.agents![0],
    id: "implementation-agent",
    name: "구현 담당",
    stage: "implementation",
    status: "running",
  };
  current.runtime!.agents!.push(
    {
      ...current.runtime!.agents![0],
      id: "implementation-agent-second",
      name: "구현 병렬 A",
    },
    {
      ...current.runtime!.agents![0],
      id: "implementation-agent-third",
      name: "구현 병렬 B",
    },
  );
  current.runtime!.heartbeat = new Date().toISOString();
  const execution = (
    id: string,
    featureId: string,
    stage: "verification" | "review",
  ) => {
    const run = structuredClone(current);
    run.id = id;
    run.featureId = featureId;
    run.status = stage === "verification" ? "verifying" : "reviewing";
    run.runtime!.agents = [
      {
        ...run.runtime!.agents![0],
        id: `${stage}-agent`,
        name: stage === "verification" ? "검증 담당" : "독립 리뷰",
        stage,
      },
    ];
    return run;
  };
  state.runs.push(
    execution("ade-run-verification", state.features[1].id, "verification"),
    execution("ade-run-review", state.features[2].id, "review"),
  );
  await prepare(page, state);
  await openPortfolio(page);
  await page
    .getByRole("button", { name: "Agent workspace", exact: true })
    .click();
  const desks = page.locator(".agent-workroom-seat");
  await expect(desks).toHaveCount(5);
  await expect(
    page.locator(".agent-workroom-room.has-three-or-more"),
  ).toHaveCount(1);
  await desks.filter({ hasText: "검증 담당" }).click();
  await expect(page.getByLabel("Selected work")).toContainText("검증 담당");
  await page.setViewportSize({ width: 1440, height: 940 });
  await page
    .locator(".agent-workroom-heading")
    .evaluate((element) => element.scrollIntoView());
  await axe(page);
  await page.screenshot({ path: "artifacts/workroom-active-dark-1440.png" });
  await page.getByLabel("Appearance").selectOption("light");
  await page.setViewportSize({ width: 1024, height: 700 });
  await page
    .locator(".agent-workroom-heading")
    .evaluate((element) => element.scrollIntoView());
  await expect(desks.filter({ hasText: "구현 담당" })).toBeInViewport();
  await expect(desks.filter({ hasText: "검증 담당" })).toBeInViewport();
  await axe(page);
  await page.screenshot({ path: "artifacts/workroom-active-light-1024.png" });
});
test("keyboard commands trap and restore focus, project search, no background filter mutation", async ({
  page,
}) => {
  await prepare(page);
  const opener = page.getByRole("button", { name: /Search commands and work/ });
  await opener.click();
  const search = page.getByRole("combobox", {
    name: "Search commands and work",
  });
  await expect(search).toBeFocused();
  expect((await search.boundingBox())!.width).toBeGreaterThan(400);
  await expect(
    page
      .getByRole("dialog", { name: "Search work" })
      .getByRole("option")
      .first()
      .locator("small"),
  ).toHaveCSS("display", "block");
  await search.fill("Commerce");
  await search.press("ArrowDown");
  await search.press("ArrowUp");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Commerce", exact: true }),
  ).toBeVisible();
  await opener.click();
  await search.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Close search" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.getByPlaceholder("Search features")).toHaveValue("");
  await opener.click();
  await search.fill("New project");
  await search.press("Enter");
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("pane keyboard controls, accessible light/dark layouts and compact viewport", async ({
  page,
}) => {
  await prepare(page);
  const width = page.getByRole("separator", { name: "Agent inspector width" });
  await width.focus();
  await width.press("End");
  await expect(width).toHaveAttribute("aria-valuenow", "360");
  await width.press("Home");
  await expect(width).toHaveAttribute("aria-valuenow", "240");
  const height = page.getByRole("separator", {
    name: "Execution output height",
  });
  await height.focus();
  await height.press("Home");
  await expect(height).toHaveAttribute("aria-valuenow", "120");
  await page.setViewportSize({ width: 1440, height: 940 });
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-execution-dark.png" });
  await page.getByLabel("Appearance").selectOption("light");
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-execution-light.png" });
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(
    page.getByRole("button", { name: "Start implementation", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (globalThis as any).document.documentElement.scrollWidth <=
        (globalThis as any).innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/ade-execution-compact.png" });
  await axe(page);
  await page
    .getByRole("button", { name: "Agent inspector", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Agent status" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Plan/ }).click();
  await page.getByRole("separator", { name: "Review panel width" }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("separator", { name: "Review panel width" }),
  ).toHaveAttribute("aria-valuenow", "280");
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-design-compact.png" });
  await page.getByRole("tab", { name: /Plan/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Edit requirements", exact: true }),
  ).toBeFocused();
});

test("review presents real acceptance evidence, overview preserves selected historical run", async ({
  page,
}) => {
  const reviewState = adeFixture();
  const run = reviewState.runs.at(-1)!;
  run.status = "ready_for_merge";
  run.runtime!.terminationConfirmed = true;
  const report = JSON.stringify({
    passed: true,
    acceptance: [
      {
        id: "AC01",
        passed: true,
        evidence:
          "src/payment.ts and tests/payment.test.ts cover retryable and duplicate responses",
      },
    ],
    findings: [],
  });
  run.runtime!.agents!.push({
    ...run.runtime!.agents![0],
    id: "review-agent",
    name: "독립 리뷰 에이전트",
    stage: "review",
    output: report,
  });
  run.runtime!.review = `독립 리뷰 에이전트\n${report}`;
  await prepare(page, reviewState);
  await page.getByRole("tab", { name: "AI review", exact: true }).click();
  await expect(page.getByText("AC01 · Met", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No blocking findings recorded.", { exact: true }),
  ).toBeVisible();
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-review-dark.png" });
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await page
    .locator(".run-table-row")
    .filter({ has: page.locator(".work-state", { hasText: /^Failed$/ }) })
    .click();
  await expect(page.getByLabel("Select run")).toHaveValue("ade-run-previous");
  await page.getByRole("button", { name: /^Work$/ }).click();
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-overview-dark.png" });
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-commands-dark.png" });
});

test("global commands cannot stack a second dialog over a draft creation form", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await prepare(page);
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  const search = page.getByRole("combobox", {
    name: "Search commands and work",
  });
  await search.fill("New project");
  await search.press("Enter");
  const name = page.getByLabel("Project name", { exact: true });
  await name.fill("Preserved draft");
  await name.press("Control+k");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(name).toHaveValue("Preserved draft");
  await expect(name).toBeFocused();
  await name.press("Meta+k");
  await name.press("Control+2");
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  expect(errors).toEqual([]);
});
test("retry review history cannot masquerade as current acceptance evidence", async ({
  page,
}) => {
  const state = adeFixture(),
    run = state.runs.at(-1)!;
  run.status = "repairing";
  const old = JSON.stringify({
    passed: true,
    acceptance: [
      { id: "OLD-AC", passed: true, evidence: "Only old attempt was checked" },
    ],
    findings: [],
  });
  run.runtime!.agents!.push({
    ...run.runtime!.agents![0],
    id: "old-review",
    name: "과거 리뷰",
    stage: "review",
    attempt: 1,
    output: old,
  });
  run.runtime!.review = old;
  await prepare(page, state);
  await page.getByRole("tab", { name: "AI review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No AI review for this attempt yet" }),
  ).toBeVisible();
  await expect(page.getByText("OLD-AC · Met", { exact: true })).toBeHidden();
  const history = page.locator(".review-history");
  await history.locator(":scope > summary").click();
  await history
    .getByText("Attempt 1 · 과거 리뷰 v2 · Required · passed", { exact: true })
    .click();
  await expect(history).toContainText("Not current verification evidence");
  await expect(
    history.getByText("OLD-AC · Met", { exact: true }),
  ).toBeVisible();
  await expect(history).toContainText("Input tree");
  await expect(history).toContainText("d".repeat(40));
});

test("execution graph preserves inspection selection and shows current attempt only", async ({
  page,
}) => {
  const state = adeFixture(),
    run = state.runs.at(-1)!;
  run.status = "implementing";
  const first = run.runtime!.agents![0];
  first.status = "running";
  run.runtime!.agents!.push(
    {
      ...first,
      id: "parallel-second",
      name: "API 구현 에이전트",
      status: "running",
    },
    {
      ...first,
      id: "historical-running",
      name: "과거 에이전트",
      attempt: 1,
      status: "running",
    },
  );
  await prepare(page, state);
  await page.getByRole("tab", { name: "Workflow", exact: true }).click();
  const graph = page.getByRole("region", { name: "Execution workflow graph" });
  await expect(graph.getByText("2 running · 0/2 complete")).toBeVisible();
  const heading = await graph
    .locator(".flow-stage-node.is-running > span")
    .boundingBox();
  const firstWorker = await graph
    .locator(".flow-agent-node.state-running")
    .first()
    .boundingBox();
  expect(heading).toBeTruthy();
  expect(firstWorker).toBeTruthy();
  expect(heading!.y + heading!.height).toBeLessThanOrEqual(firstWorker!.y);

  await expect(graph.getByText("과거 에이전트")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 940 });
  const inspector = page.getByRole("region", {
    name: "Selected execution evidence",
  });
  const inspectorBox = (await inspector.boundingBox())!;
  const graphBox = (await graph.boundingBox())!;
  expect(inspectorBox.x).toBeGreaterThan(graphBox.x);
  expect(Math.abs(inspectorBox.y - graphBox.y)).toBeLessThan(2);
  expect(inspectorBox.y + inspectorBox.height).toBeLessThanOrEqual(940);
  await page.getByTestId("rf__node-design").focus();
  await expect(page.getByTestId("rf__node-design")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("region", { name: "Selected execution evidence" })
      .getByRole("heading"),
  ).toHaveText("Design");
  await expect(graph.locator(".state-running")).toHaveCount(2);
  await page.getByRole("button", { name: "Select current activity" }).click();
  await expect(
    page.getByRole("region", { name: "Selected execution evidence" }),
  ).toContainText("Applied instructions");
  await axe(page);
  await page.screenshot({ path: "artifacts/graph-execution-dark.png" });
  await page.getByLabel("Appearance").selectOption("light");
  await axe(page);
  await page.screenshot({ path: "artifacts/graph-execution-light.png" });
  await page.getByLabel("Select run").selectOption("ade-run-previous");
  await expect(graph.locator(".state-running")).toHaveCount(0);
});

test("graph editing supports stage moves, undo, draft recovery and accessible compact layout", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const project = state.projects[0];
  const stages = [
    "requirements",
    "design",
    "implementation",
    "verification",
    "review",
  ] as const;
  state.agents = stages.map((stage, i) => ({
    id: `00000000-0000-4000-8000-00000000001${i}`,
    revision: 1,
    name: `${stage} 역할`,
    description: "테스트 역할",
    capability: stage === "implementation" ? "implementation" : "read-only",
    markdown: "# 검토 기준\n검사 근거 기록",
    archived: false,
  }));
  project.workflow = {
    revision: 1,
    instructions: {
      requirements: "",
      design: "",
      implementation: "",
      verification: "",
      review: "",
    },
    assignments: stages.map((stage, i) => ({
      id: `00000000-0000-4000-8000-00000000002${i}`,
      stage,
      agentId: state.agents![i].id,
      required: true,
    })),
  };
  await prepare(page, state);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 940 });
  const source = page.getByTestId(
    "rf__node-00000000-0000-4000-8000-000000000023",
  );
  const target = page.getByTestId("rf__node-review");
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!,
    to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("Review stage");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await source.click();
  await page.getByLabel("Agent stage").selectOption("review");
  await expect(page.getByRole("status")).toContainText("Review stage");
  await expect(
    page.getByLabel("Agent stage").locator('option[value="implementation"]'),
  ).toHaveJSProperty("disabled", true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Agent stage")).toHaveValue("verification");
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await page
    .getByLabel("Verification Stage instructions")
    .fill("이 초안은 새로고침 후에도 유지됩니다.");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await expect(page.getByLabel("Verification Stage instructions")).toHaveValue(
    "이 초안은 새로고침 후에도 유지됩니다.",
  );
  const addFromGraph = page
    .getByTestId("rf__node-verification")
    .getByRole("button", {
      name: "Add agent to Verification",
      exact: true,
    });
  await addFromGraph.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", {
    name: "Add agent to Verification",
  });
  await expect(dialog.getByLabel("Search existing agents")).toBeFocused();
  await dialog.getByLabel("Search existing agents").fill("없는역할123");
  await expect(dialog.getByRole("status")).toContainText("No agents match");
  await dialog.getByLabel("Search existing agents").fill("");
  await page.screenshot({
    path: "artifacts/english-workspace/agent-picker-dark.png",
  });
  await page.keyboard.press("Escape");
  await expect(addFromGraph).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByLabel("Search existing agents").fill("review");
  await dialog.getByRole("button", { name: /review 역할/ }).click();
  await expect(page.getByLabel("Agent stage")).toHaveValue("verification");
  await page.setViewportSize({ width: 1440, height: 940 });
  await axe(page);
  await page.screenshot({
    path: "artifacts/graph-editor-dark.png",
    fullPage: true,
  });
  await page.getByLabel("Appearance").selectOption("light");
  await axe(page);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.screenshot({
    path: "artifacts/graph-editor-compact.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        (globalThis as any).document.documentElement.scrollWidth <=
        (globalThis as any).innerWidth,
    ),
  ).toBe(true);
});

test("AI refinement preserves input on failure and applies only a reviewed proposal", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  await prepare(page, state);
  await page.evaluate(() => {
    const api = (globalThis as any).roopre;
    api.connections = async () => [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "검증용 연결",
        model: "fixture",
        hasKey: true,
      },
    ];
    let attempt = 0;
    api.refineAgent = async () => {
      if (++attempt === 1) throw Error("검증용 연결 실패");
      return {
        name: "접근성 검토",
        description: "키보드와 대비 검증",
        markdown: "# 역할\n근거를 기록한다.",
      };
    };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit agent" });
  await dialog
    .getByText("Describe the role, then refine with AI", { exact: true })
    .click();
  await dialog
    .getByLabel("Agent purpose")
    .fill("접근성이랑 키보드 사용성 확인해줘");
  await dialog
    .getByRole("button", { name: "Refine with AI", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText("검증용 연결 실패");
  await expect(dialog.getByLabel("Agent purpose")).toHaveValue(
    "접근성이랑 키보드 사용성 확인해줘",
  );
  await dialog
    .getByRole("button", { name: "Refine with AI", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Suggested agent" }),
  ).toContainText("접근성 검토");
  await expect(dialog.getByLabel("Agent name", { exact: true })).toHaveValue(
    "",
  );
  await dialog.getByRole("button", { name: "Apply to editor" }).click();
  await expect(dialog.getByLabel("Agent name", { exact: true })).toHaveValue(
    "접근성 검토",
  );
  await expect(
    dialog.getByLabel("Markdown instructions", { exact: true }),
  ).toHaveValue("# 역할\n근거를 기록한다.");
  await axe(page);
  await page.screenshot({ path: "artifacts/graph-agent-refinement.png" });
  await dialog.getByRole("button", { name: "Save agent", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "No mutation in ADE display fixture",
  );
  await expect(dialog.getByLabel("Agent name", { exact: true })).toHaveValue(
    "접근성 검토",
  );
  await expect(
    dialog.getByRole("button", { name: "Save agent", exact: true }),
  ).toBeEnabled();
});

test("active project locks workflow changes while graph remains inspectable", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save workflow", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Use default workflow", exact: true }),
  ).toBeDisabled();
  await page.getByTestId("rf__node-review").locator("strong").first().click();
  await expect(page.getByLabel("Review Execution mode")).toBeDisabled();
  await expect(
    page
      .getByTestId("rf__node-review")
      .getByRole("button", { name: "Add agent to Review", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("complementary", { name: "Selected workflow settings" }),
  ).toContainText("Selected stage · Review");
});

test("fixed-check execution has a visible active stage and direct navigation", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("tab", { name: "Workflow", exact: true }).click();
  await expect(
    page.getByTestId("rf__node-verification").locator(".flow-stage-node"),
  ).toHaveClass(/is-running/);
  await expect(page.locator(".flow-agent-node.state-running")).toHaveCount(0);
  await page.getByRole("button", { name: "Select current activity" }).click();
  await expect(
    page
      .getByRole("region", { name: "Selected execution evidence" })
      .getByRole("heading"),
  ).toHaveText("Verification");
  await page
    .getByRole("button", { name: "View verification results", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: /^Verification/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Current attempt 2 · Result 1")).toBeVisible();
});

test("cancelled stage creation never leaks into library duplication", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  state.agents = [
    {
      id: "00000000-0000-4000-8000-000000000030",
      revision: 1,
      name: "독립 검토 역할",
      description: "",
      capability: "read-only",
      markdown: "# 근거\n직접 확인한다.",
      archived: false,
    },
  ];
  await prepare(page, state);
  await page.evaluate(() => {
    (globalThis as any).roopre.command = async () => ({});
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  for (const close of ["button", "escape", "backdrop"]) {
    await page.getByTestId("rf__node-review").locator("strong").first().click();
    await page
      .getByTestId("rf__node-review")
      .getByRole("button", { name: "Add agent to Review", exact: true })
      .click();
    await page.getByRole("button", { name: "Create role · Markdown" }).click();
    if (close === "button")
      await page.getByRole("button", { name: "Close editor" }).click();
    else if (close === "escape") await page.keyboard.press("Escape");
    else
      await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const library = page.locator(".agent-library-section");
    if ((await library.getAttribute("open")) === null)
      await library.locator(":scope > summary").click();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.getByRole("button", { name: "Save agent", exact: true }).click();
    await expect(
      page.getByText("Agent version saved.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              (globalThis as any).localStorage.getItem(
                "roopre:flow-draft:team-local:commerce",
              ),
            ).flow.assignments.length,
        ),
      )
      .toBe(0);
  }
});

test("dense workflows keep readable nodes and recover all agents through scroll", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const agentId = "00000000-0000-4000-8000-000000000099";
  state.agents = [
    {
      id: agentId,
      revision: 1,
      name: "검증 에이전트",
      description: "",
      capability: "read-only",
      markdown: "실제 근거 확인",
      archived: false,
    },
  ];
  state.projects[0].workflow = {
    revision: 1,
    instructions: {
      requirements: "",
      design: "",
      implementation: "",
      verification: "",
      review: "",
    },
    assignments: Array.from({ length: 12 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      agentId,
      stage: "verification",
      required: true,
    })),
  };
  await prepare(page, state);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  const last = page.getByTestId(
    "rf__node-00000000-0000-4000-8000-000000000011",
  );
  const label = last.locator("strong");
  await expect(label).toHaveCSS("font-size", "14px");
  await expect
    .poll(async () => (await last.boundingBox())!.height)
    .toBeGreaterThanOrEqual(58);
  const canvas = page.locator(".graph-canvas");
  await canvas.hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() => canvas.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await last.click();
  await expect(page.getByLabel("Agent stage")).toHaveValue("verification");
  expect(
    await page.locator(".graph-canvas").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(100);
  await expect
    .poll(
      async () =>
        (await page.getByTestId("rf__node-verification").boundingBox())!.width,
    )
    .toBeLessThan(180);
  await page
    .getByRole("button", { name: "Collapse agents", exact: true })
    .click();
  await expect(last).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand agents", exact: true })
    .click();
  await expect(last).toHaveCount(1);
});

test("execution setup keeps the feature project across settings and returns to the task", async ({
  page,
}) => {
  const state = adeFixture();
  state.runs = [];
  const project = state.projects[1];
  state.features[0].projectId = project.id;
  state.features[0].title = "두 번째 프로젝트의 기능";
  await prepare(page, state);
  const setup = page.getByRole("region", { name: "Execution readiness" });
  await expect(setup).toContainText(`Check settings for ${project.name}`);
  await expect(setup).toContainText("Add an API key and endpoint in the app.");
  await expect(
    page.getByRole("button", {
      name: "Run planning agents",
      exact: true,
    }),
  ).toBeDisabled();
  await axe(page);
  await page.screenshot({ path: "artifacts/setup-dark.png" });
  await page
    .getByRole("button", { name: "Configure execution profile", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Projects", exact: true }),
  ).toHaveValue(project.id);
  await expect(
    page.getByRole("region", {
      name: "Project execution profiles",
      exact: true,
    }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Agents & workflow", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Workflow project", exact: true }),
  ).toHaveValue(project.id);
  // A deliberate project change carries across settings tabs, not back to project[0].
  const changedProject = state.projects[2];
  await page
    .getByRole("combobox", { name: "Workflow project", exact: true })
    .selectOption(changedProject.id);
  await page
    .getByRole("button", {
      name: "Standards, connections & runtime",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Projects", exact: true }),
  ).toHaveValue(changedProject.id);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Projects", exact: true }),
  ).toHaveValue(changedProject.id);
  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "두 번째 프로젝트의 기능", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Build & verify", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Configure workflow", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Workflow project", exact: true }),
  ).toHaveValue(project.id);
  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  // Global shortcuts open quality and live agent work while history returns to the task.
  await page.keyboard.press("Control+3");
  await expect(
    page.getByRole("heading", { name: "Standards backed by results" }),
  ).toBeVisible();
  await page.keyboard.press("Meta+[");
  await expect(
    page.getByRole("heading", { name: "두 번째 프로젝트의 기능", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+4");
  await expect(
    page.getByRole("heading", { name: "Execution", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Meta+[");
  await expect(
    page.getByRole("heading", { name: "두 번째 프로젝트의 기능", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.getByLabel("Appearance").selectOption("light");
  await axe(page);
  await page.screenshot({ path: "artifacts/setup-light-compact.png" });
  expect(
    await page.evaluate(
      () =>
        (globalThis as any).document.documentElement.scrollWidth <=
        (globalThis as any).innerWidth,
    ),
  ).toBe(true);
});

test("setup connection metadata can recover from failure and identifies a stale profile", async ({
  page,
}) => {
  const state = adeFixture();
  const profile = state.runs.at(-1)!.runtime!.profile;
  state.projects[0].executionProfile = profile;
  state.runs = [];
  await prepare(page, state);
  await page.evaluate(() => {
    (globalThis as any).roopre.connections = async () => {
      throw Error("metadata unavailable");
    };
  });
  await page
    .getByRole("button", { name: "Recheck AI connections", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Execution readiness" }),
  ).toContainText("Unable to load connections");
  await page.evaluate((profile) => {
    (globalThis as any).roopre.connections = async () => [
      {
        id: profile.connectionId,
        version: profile.connectionVersion + 1,
        name: "새 연결 버전",
        model: "test-model",
        hasKey: true,
      },
    ];
  }, profile);
  await page
    .getByRole("button", { name: "Recheck AI connections", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Execution readiness" }),
  ).toContainText("Connection version changed");
  await page
    .getByRole("button", { name: "Refresh connection version", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Project execution profiles",
      exact: true,
    }),
  ).toBeFocused();
});

test("interrupted work explains cleanup and enables retry only after termination is confirmed", async ({
  page,
}) => {
  const state = adeFixture();
  const run = state.runs.at(-1)!;
  run.status = "interrupted";
  run.runtime!.terminationConfirmed = false;
  for (const agent of run.runtime!.agents ?? [])
    if (agent.status === "running") {
      agent.status = "failed";
      agent.error = "실행 중단";
    }
  await prepare(page, state);
  await page.getByRole("tab", { name: "Workflow", exact: true }).click();
  await expect(
    page.getByText("Confirming termination", { exact: true }).first(),
  ).toBeVisible();
  const retry = page.getByRole("button", {
    name: "Retry latest changes",
    exact: true,
  });
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveAttribute(
    "title",
    "Retry after the previous container's termination is confirmed.",
  );
  await axe(page);
  await page.screenshot({ path: "artifacts/recovery-pending.png" });
  run.runtime!.terminationConfirmed = true;
  await page.evaluate((state) => {
    (globalThis as any).roopre.snapshot = async () => state;
  }, state);
  await expect(retry).toBeEnabled();
  await expect(
    page.getByText("Confirming termination", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "artifacts/recovery-ready.png" });
  run.runtime!.kind = "planning";
  await page.evaluate((state) => {
    (globalThis as any).roopre.snapshot = async () => state;
  }, state);
  await expect(retry).toHaveCount(0);
});

test("workspace history restores filters and feature context without hijacking input or dialogs", async ({
  page,
}) => {
  const snapshot = adeFixture();
  await prepare(page, snapshot);
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await page.getByPlaceholder("Search features").fill("remember this filter");
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  const search = page.getByRole("combobox", {
    name: "Search commands and work",
  });
  await search.fill(snapshot.features[1].title);
  await search.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: snapshot.features[1].title,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByPlaceholder("Search features")).toHaveValue(
    "remember this filter",
  );
  await page.getByPlaceholder("Search features").press("Control+BracketLeft");
  await expect(page.getByPlaceholder("Search features")).toBeVisible();
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: snapshot.features[1].title,
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Control+BracketLeft");
  await expect(page.getByPlaceholder("Search features")).toHaveValue(
    "remember this filter",
  );
  await page.getByRole("button", { name: /^Agent/ }).click();
  await expect(
    page.getByRole("button", { name: "Go forward", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  await expect(
    page.getByRole("button", { name: "Go back", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+BracketLeft");
  await expect(page.getByRole("dialog", { name: "Search work" })).toBeVisible();
  await page.keyboard.press("Escape");
  await axe(page);
});

test("Korean IME composition never executes the selected command", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: /Search commands and work/ }).click();
  const search = page.getByRole("combobox", {
    name: "Search commands and work",
  });
  await search.fill("New project");
  await search.evaluate((input) =>
    input.dispatchEvent(
      new (globalThis as any).KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  await expect(page.getByRole("dialog", { name: "Search work" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New project" })).toHaveCount(
    0,
  );
  await search.press("Enter");
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
});

test("diff refresh preserves file identity; file search, hunk navigation and wrapping stay usable", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.getByRole("button", { name: "Load changes" }).click();
  await page.evaluate(
    (patch) => (globalThis as any).__diffResolvers["ade-run-current"](patch),
    patch,
  );
  await page.getByRole("button", { name: /tests\/payment.test.ts/ }).click();
  await page.getByRole("button", { name: "Load changes" }).click();
  await expect(
    page.getByRole("button", { name: "Execution output", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  const updated = `diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+new\n${patch}\n@@ -100,1 +100,1 @@\n-old\n+${"long line ".repeat(100)}`;
  await page.evaluate(
    (patch) => (globalThis as any).__diffResolvers["ade-run-current"](patch),
    updated,
  );
  await expect(
    page.getByRole("button", { name: /tests\/payment.test.ts/ }),
  ).toHaveAttribute("aria-current", "true");
  await page
    .getByRole("textbox", { name: "Search changed files" })
    .fill(" tests/ ");
  await expect(
    page.getByRole("navigation", { name: "Changed files" }).getByRole("button"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Next hunk", exact: true }).click();
  await expect(
    page.getByText("1 / 2 Change hunks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next hunk", exact: true }).click();
  await expect(
    page.getByText("2 / 2 Change hunks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Wrap diff lines" }).click();
  await expect(page.locator(".diff-scroll")).toHaveClass(/wrapped/);
  await page
    .getByRole("button", { name: "Previous hunk", exact: true })
    .click();
  await expect(
    page.getByText("1 / 2 Change hunks", { exact: true }),
  ).toBeVisible();
  await axe(page);
  await page.screenshot({ path: "artifacts/orca-diff-dark.png" });
  await page.getByLabel("Appearance").selectOption("light");
  await page.setViewportSize({ width: 1024, height: 700 });
  await axe(page);
  await page.screenshot({ path: "artifacts/orca-diff-compact.png" });
  await page
    .getByRole("textbox", { name: "Search changed files" })
    .fill("missing-file");
  await expect(
    page.getByRole("heading", { name: "No search results" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next hunk", exact: true }),
  ).toHaveCount(0);
});

test("live logs follow output until the reader scrolls away, preserve anchors across trimming and resume explicitly", async ({
  page,
}) => {
  const snapshot = adeFixture();
  const run = snapshot.runs.at(-1)!;
  run.runtime!.events = Array.from({ length: 80 }, (_, i) => ({
    at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    message: `Operation ${i}`,
  }));
  await prepare(page, snapshot);
  const log = page.getByLabel("Activity log", { exact: true });
  await expect(log).toBeVisible();
  const atBottom = () =>
    log.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop < 3);
  await expect.poll(atBottom).toBe(true);
  await log.evaluate((e) => {
    e.scrollTop = 320;
  });
  await expect(
    page.getByText("Reading earlier activity", { exact: true }),
  ).toBeVisible();
  const firstVisible = () =>
    log.evaluate((e) => {
      const top = e.getBoundingClientRect().top;
      return (Array.from(e.querySelectorAll("[data-event]")) as any[]).find(
        (row) => row.getBoundingClientRect().bottom > top,
      )?.dataset.event;
    });
  const anchor = await firstVisible();
  run.runtime!.events = [
    ...run.runtime!.events.slice(5),
    { at: new Date(1_700_000_100_000).toISOString(), message: "New output" },
  ];
  snapshot.revision++;
  await page.evaluate((snapshot) => {
    (globalThis as any).roopre.snapshot = async () => snapshot;
  }, snapshot);
  await expect(
    page.getByRole("button", { name: "Jump to latest activity" }),
  ).toHaveText(/New activity/);
  await expect.poll(firstVisible).toBe(anchor);
  await page.screenshot({ path: "artifacts/orca-log-paused.png" });
  run.runtime!.events = run.runtime!.events.slice(-4);
  snapshot.revision++;
  await page.evaluate((snapshot) => {
    (globalThis as any).roopre.snapshot = async () => snapshot;
  }, snapshot);
  await expect(
    page.getByText("Some earlier records are outside the retained history"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Jump to latest activity" }).click();
  await expect.poll(atBottom).toBe(true);
  await expect(
    page.getByText("Following latest activity", { exact: true }),
  ).toBeVisible();
  await axe(page);
});

for (const [screen, label] of [
  ["Harness standards", "Standards project"],
  ["Agents & workflow", "Workflow project"],
  ["Standards, connections & runtime", "Projects"],
  ["Instructions & team", "Project to configure"],
]) {
  test(`same-screen history restores project forms and operation targets: ${screen}`, async ({
    page,
  }) => {
    const snapshot = adeFixture();
    const profile = snapshot.runs.at(-1)!.runtime!.profile;
    snapshot.runs = [];
    snapshot.features[0].projectId = snapshot.projects[1].id;
    const stages = [
      "requirements",
      "design",
      "implementation",
      "verification",
      "review",
    ] as const;
    snapshot.agents = stages.map((stage, i) => ({
      id: `00000000-0000-4000-8000-00000000001${i}`,
      revision: 1,
      name: `${stage} role`,
      description: "",
      archived: false,
      capability: stage === "implementation" ? "implementation" : "read-only",
      markdown: "# Evidence\nCheck the result.",
    }));
    for (const project of snapshot.projects) {
      project.instructions = `${project.id} policy`;
      project.executionProfile = {
        ...profile,
        repositoryPath: `/workspace/${project.id}`,
        baseBranch: project.id,
      };
      project.workflow = {
        revision: 1,
        instructions: {
          requirements: "",
          design: "",
          implementation: "",
          verification: `${project.id} checks`,
          review: "",
        },
        assignments: stages.map((stage, i) => ({
          id: `00000000-0000-4000-8000-00000000002${i}`,
          stage,
          agentId: snapshot.agents![i].id,
          required: true,
        })),
      };
    }
    await prepare(page, snapshot);
    await page.evaluate((connectionId) => {
      const w = globalThis as any;
      w.__settingsOperations = [];
      w.roopre.connections = async () => [
        { id: connectionId, name: "Fixture", model: "fixture", hasKey: true },
      ];
      w.roopre.configureProject = async (
        projectId: string,
        profile: unknown,
      ) => {
        w.__settingsOperations.push({ projectId, profile });
      };
      w.roopre.command = async (command: unknown) => {
        w.__settingsOperations.push(command);
        return {};
      };
      w.roopre.harnessCandidate = async (input: unknown) => {
        w.__settingsOperations.push(input);
        return null;
      };
    }, profile.connectionId);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: screen, exact: true }).click();
    const select = page.getByRole("combobox", { name: label, exact: true });
    await expect(select).toHaveValue("platform");
    if (screen === "Agents & workflow") {
      await page
        .getByTestId("rf__node-verification")
        .locator("strong")
        .first()
        .click();
      await page
        .getByLabel("Verification Stage instructions")
        .fill("platform unsaved checks");
    }
    await select.selectOption("portal");
    await expect(select).toHaveValue("portal");
    if (screen === "Agents & workflow") {
      await page
        .getByTestId("rf__node-verification")
        .locator("strong")
        .first()
        .click();
      await page
        .getByLabel("Verification Stage instructions")
        .fill("portal unsaved checks");
    }
    for (const [direction, projectId] of [
      ["Go back", "platform"],
      ["Go forward", "portal"],
    ]) {
      await page.getByRole("button", { name: direction, exact: true }).click();
      await expect(select).toHaveValue(projectId);
      if (screen === "Standards, connections & runtime") {
        await expect(
          page.getByLabel("Base branch", { exact: true }),
        ).toHaveValue(projectId);
        await page
          .getByRole("button", { name: "Save execution profile", exact: true })
          .click();
      } else if (screen === "Instructions & team") {
        await expect(
          page.getByRole("textbox", {
            name: "Project instructions",
            exact: true,
          }),
        ).toHaveValue(`${projectId} policy`);
        await page
          .getByRole("button", { name: "Save project standards", exact: true })
          .click();
      } else if (screen === "Agents & workflow") {
        await page
          .getByTestId("rf__node-verification")
          .locator("strong")
          .first()
          .click();
        await expect(
          page.getByLabel("Verification Stage instructions"),
        ).toHaveValue(`${projectId} unsaved checks`);
        await page
          .getByRole("button", { name: "Save workflow", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: "Load current settings", exact: true })
          .click();
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis as any).__settingsOperations.at(-1)?.projectId,
          ),
        )
        .toBe(projectId);
    }
    const operations = await page.evaluate(
      () => (globalThis as any).__settingsOperations,
    );
    expect(operations.map((op: any) => op.projectId)).toEqual([
      "platform",
      "portal",
    ]);
    if (screen === "Standards, connections & runtime")
      expect(operations.map((op: any) => op.profile.repositoryPath)).toEqual([
        "/workspace/platform",
        "/workspace/portal",
      ]);
    if (screen === "Instructions & team")
      expect(operations.map((op: any) => op.instructions)).toEqual([
        "platform policy",
        "portal policy",
      ]);
    if (screen === "Agents & workflow")
      expect(
        operations.map((op: any) => op.workflow.instructions.verification),
      ).toEqual(["platform unsaved checks", "portal unsaved checks"]);
  });
}

test("home attention queue keeps decisions beyond the five-row preview reachable", async ({
  page,
}) => {
  const state = adeFixture();
  for (let index = 0; index < 7; index++) {
    const feature = structuredClone(state.features[1]);
    feature.id = `attention-${index}`;
    feature.title = `Decision ${index + 1}`;
    state.features.push(feature);
    state.gates[feature.id] = gate(state, feature);
  }
  await prepareHome(page, state);
  const decisions = page.getByRole("region", { name: "Needs your attention" });
  await expect(decisions.locator(".home-work-row")).toHaveCount(5);
  await decisions.getByRole("button", { name: /View all/ }).click();
  await expect(
    page.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Decision 7", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Approve design/ }),
  ).toHaveCount(0);
});
