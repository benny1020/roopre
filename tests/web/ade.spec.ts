import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adeFixture, patch } from "../fixtures/ade";
const state = adeFixture();
async function prepare(page: Page, state = adeFixture()) {
  await page.addInitScript(
    ({ state, patch }) => {
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
    { state, patch },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: state.features[0].title, exact: true }),
  ).toBeVisible();
  if (state.runs.length) await page.getByRole("tab", { name: /^검증/ }).click();
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
test("run-specific diff rejects stale responses, checks retain attempt identity, artifacts dispatch", async ({
  page,
}) => {
  await prepare(page);
  await expect(page.getByText("현재 시도 2 · 결과 1개")).toBeVisible();
  await expect(
    page.getByText("이전 시도 검사 1개 · 현재 시도의 통과 근거가 아닙니다"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "변경", exact: true }).click();
  await page.getByRole("button", { name: "변경 내용 보기" }).click();
  await page.getByLabel("실행 선택").selectOption("ade-run-previous");
  await page.evaluate(() => {
    (globalThis as any).__diffResolvers["ade-run-current"](
      "WRONG CURRENT PATCH",
    );
  });
  await expect(page.getByText("WRONG CURRENT PATCH")).toHaveCount(0);
  await page.getByRole("button", { name: "변경 내용 보기" }).click();
  await page.evaluate((patch) => {
    (globalThis as any).__diffResolvers["ade-run-previous"](patch);
  }, patch);
  await expect(
    page.getByRole("navigation", { name: "변경 파일" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /tests\/payment.test.ts/ }).click();
  await expect(
    page.getByRole("region", { name: "파일 변경 내용" }),
  ).toContainText("duplicate payment is never retried");
  await page.getByRole("tab", { name: "산출물" }).click();
  await page.getByRole("button", { name: /tests\/report.txt/ }).click();
  expect(await page.evaluate(() => (globalThis as any).__revealed)).toEqual([
    ["ade-run-previous", 0],
  ]);
});
test("keyboard commands trap and restore focus, project search, no background filter mutation", async ({
  page,
}) => {
  await prepare(page);
  const opener = page.getByRole("button", { name: /명령 · 작업 검색/ });
  await opener.click();
  const search = page.getByRole("combobox", { name: "명령과 작업 검색" });
  await expect(search).toBeFocused();
  expect((await search.boundingBox())!.width).toBeGreaterThan(400);
  await expect(
    page
      .getByRole("dialog", { name: "작업 검색" })
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
  await expect(page.getByRole("button", { name: "검색 닫기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.getByPlaceholder("기능 검색")).toHaveValue("");
  await opener.click();
  await search.fill("새 프로젝트");
  await search.press("Enter");
  await expect(page.getByRole("dialog", { name: "새 프로젝트" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("pane keyboard controls, accessible light/dark layouts and compact viewport", async ({
  page,
}) => {
  await prepare(page);
  const width = page.getByRole("separator", { name: "에이전트 패널 너비" });
  await width.focus();
  await width.press("End");
  await expect(width).toHaveAttribute("aria-valuenow", "360");
  await width.press("Home");
  await expect(width).toHaveAttribute("aria-valuenow", "240");
  const height = page.getByRole("separator", { name: "실행 출력 높이" });
  await height.focus();
  await height.press("Home");
  await expect(height).toHaveAttribute("aria-valuenow", "120");
  await page.setViewportSize({ width: 1440, height: 940 });
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-execution-dark.png" });
  await page.getByLabel("화면 테마").selectOption("light");
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-execution-light.png" });
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(
    page.getByRole("button", { name: "개발 시작", exact: true }),
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
    .getByRole("button", { name: "에이전트 패널", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "에이전트 상태" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /설계·리뷰/ }).click();
  await page.getByRole("separator", { name: "리뷰 패널 너비" }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("separator", { name: "리뷰 패널 너비" }),
  ).toHaveAttribute("aria-valuenow", "280");
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-design-compact.png" });
  await page.getByRole("tab", { name: /설계·리뷰/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "요구사항", exact: true }),
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
  await page.getByRole("tab", { name: "AI 리뷰", exact: true }).click();
  await expect(
    page.getByText("AC01 · 충족 의견", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("기록된 차단 지적이 없습니다.", { exact: true }),
  ).toBeVisible();
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-review-dark.png" });
  await page.getByRole("button", { name: /실행 현황/ }).click();
  await page
    .locator(".run-table-row")
    .filter({ has: page.locator(".work-state", { hasText: /^실패$/ }) })
    .click();
  await expect(page.getByLabel("실행 선택")).toHaveValue("ade-run-previous");
  await page.getByRole("button", { name: /전체 작업/ }).click();
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-overview-dark.png" });
  await page.getByRole("button", { name: /명령 · 작업 검색/ }).click();
  await axe(page);
  await page.screenshot({ path: "artifacts/ade-commands-dark.png" });
});

test("global commands cannot stack a second dialog over a draft creation form", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await prepare(page);
  await page.getByRole("button", { name: /명령 · 작업 검색/ }).click();
  const search = page.getByRole("combobox", { name: "명령과 작업 검색" });
  await search.fill("새 프로젝트");
  await search.press("Enter");
  const name = page.getByLabel("프로젝트 이름", { exact: true });
  await name.fill("Preserved draft");
  await name.press("Control+k");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(name).toHaveValue("Preserved draft");
  await expect(name).toBeFocused();
  await name.press("Meta+k");
  await name.press("Control+2");
  await expect(page.getByRole("dialog", { name: "새 프로젝트" })).toBeVisible();
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
  await page.getByRole("tab", { name: "AI 리뷰", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "현재 시도의 AI 리뷰가 아직 없습니다" }),
  ).toBeVisible();
  await expect(
    page.getByText("OLD-AC · 충족 의견", { exact: true }),
  ).toBeHidden();
  const history = page.locator(".review-history");
  await history.locator(":scope > summary").click();
  await history
    .getByText("시도 1 · 과거 리뷰 v2 · 필수 · passed", { exact: true })
    .click();
  await expect(history).toContainText("현재 검증 근거가 아닙니다");
  await expect(
    history.getByText("OLD-AC · 충족 의견", { exact: true }),
  ).toBeVisible();
  await expect(history).toContainText("입력 tree");
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
  await page.getByRole("tab", { name: "흐름", exact: true }).click();
  const graph = page.getByRole("region", { name: "실행 흐름 그래프" });
  await expect(graph.getByText("2 실행 · 0/2 완료")).toBeVisible();
  await expect(graph.getByText("과거 에이전트")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 940 });
  const inspector = page.getByRole("region", { name: "선택한 실행 근거" });
  const inspectorBox = (await inspector.boundingBox())!;
  const graphBox = (await graph.boundingBox())!;
  expect(inspectorBox.x).toBeGreaterThan(graphBox.x);
  expect(Math.abs(inspectorBox.y - graphBox.y)).toBeLessThan(2);
  expect(inspectorBox.y + inspectorBox.height).toBeLessThanOrEqual(940);
  await page.getByTestId("rf__node-design").focus();
  await expect(page.getByTestId("rf__node-design")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "선택한 실행 근거" }).getByRole("heading"),
  ).toHaveText("설계");
  await expect(graph.locator(".state-running")).toHaveCount(2);
  await page.getByRole("button", { name: "현재 작업 선택" }).click();
  await expect(
    page.getByRole("region", { name: "선택한 실행 근거" }),
  ).toContainText("실제로 적용한 지침");
  await axe(page);
  await page.screenshot({ path: "artifacts/graph-execution-dark.png" });
  await page.getByLabel("화면 테마").selectOption("light");
  await axe(page);
  await page.screenshot({ path: "artifacts/graph-execution-light.png" });
  await page.getByLabel("실행 선택").selectOption("ade-run-previous");
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
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
  await expect(page.getByRole("status")).toContainText("리뷰 단계로 이동");
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await source.click();
  await page.getByLabel("에이전트 담당 단계").selectOption("review");
  await expect(page.getByRole("status")).toContainText("리뷰 단계로 이동");
  await expect(
    page
      .getByLabel("에이전트 담당 단계")
      .locator('option[value="implementation"]'),
  ).toHaveJSProperty("disabled", true);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.getByLabel("에이전트 담당 단계")).toHaveValue(
    "verification",
  );
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await page
    .getByLabel("검증 단계 지침")
    .fill("이 초안은 새로고침 후에도 유지됩니다.");
  await page.reload();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
    .click();
  await page
    .getByTestId("rf__node-verification")
    .locator("strong")
    .first()
    .click();
  await expect(page.getByLabel("검증 단계 지침")).toHaveValue(
    "이 초안은 새로고침 후에도 유지됩니다.",
  );
  const addFromGraph = page.getByRole("button", {
    name: "검증에 에이전트 추가",
    exact: true,
  });
  await addFromGraph.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "검증 에이전트 추가" });
  await expect(dialog.getByLabel("기존 에이전트 검색")).toBeFocused();
  await dialog.getByLabel("기존 에이전트 검색").fill("없는역할123");
  await expect(dialog.getByRole("status")).toContainText(
    "맞는 에이전트가 없습니다",
  );
  await page.keyboard.press("Escape");
  await expect(addFromGraph).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByLabel("기존 에이전트 검색").fill("review");
  await dialog.getByRole("button", { name: /review 역할/ }).click();
  await expect(page.getByLabel("에이전트 담당 단계")).toHaveValue(
    "verification",
  );
  await page.setViewportSize({ width: 1440, height: 940 });
  await axe(page);
  await page.screenshot({
    path: "artifacts/graph-editor-dark.png",
    fullPage: true,
  });
  await page.getByLabel("화면 테마").selectOption("light");
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
    .click();
  await page
    .getByRole("button", { name: "에이전트 만들기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "에이전트 편집" });
  await dialog.getByText("간단히 적고 AI로 구체화", { exact: true }).click();
  await dialog
    .getByLabel("원하는 역할")
    .fill("접근성이랑 키보드 사용성 확인해줘");
  await dialog
    .getByRole("button", { name: "AI로 구체화", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText("검증용 연결 실패");
  await expect(dialog.getByLabel("원하는 역할")).toHaveValue(
    "접근성이랑 키보드 사용성 확인해줘",
  );
  await dialog
    .getByRole("button", { name: "AI로 구체화", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "AI 에이전트 제안" }),
  ).toContainText("접근성 검토");
  await expect(dialog.getByLabel("에이전트 이름", { exact: true })).toHaveValue(
    "",
  );
  await dialog.getByRole("button", { name: "제안을 편집기에 적용" }).click();
  await expect(dialog.getByLabel("에이전트 이름", { exact: true })).toHaveValue(
    "접근성 검토",
  );
  await expect(dialog.getByLabel("Markdown 지침", { exact: true })).toHaveValue(
    "# 역할\n근거를 기록한다.",
  );
  await axe(page);
  await page.screenshot({ path: "artifacts/graph-agent-refinement.png" });
  await dialog
    .getByRole("button", { name: "에이전트 저장", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "No mutation in ADE display fixture",
  );
  await expect(dialog.getByLabel("에이전트 이름", { exact: true })).toHaveValue(
    "접근성 검토",
  );
  await expect(
    dialog.getByRole("button", { name: "에이전트 저장", exact: true }),
  ).toBeEnabled();
});

test("active project locks workflow changes while graph remains inspectable", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "개발 흐름 저장", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "기본 흐름 적용", exact: true }),
  ).toBeDisabled();
  await page.getByTestId("rf__node-review").locator("strong").first().click();
  await expect(page.getByLabel("리뷰 실행 방식")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "리뷰에 에이전트 추가", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("complementary", { name: "선택한 흐름 설정" }),
  ).toContainText("선택한 단계 · 리뷰");
});

test("fixed-check execution has a visible active stage and direct navigation", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("tab", { name: "흐름", exact: true }).click();
  await expect(
    page.getByTestId("rf__node-verification").locator(".flow-stage-node"),
  ).toHaveClass(/is-running/);
  await expect(page.locator(".flow-agent-node.state-running")).toHaveCount(0);
  await page.getByRole("button", { name: "현재 작업 선택" }).click();
  await expect(
    page.getByRole("region", { name: "선택한 실행 근거" }).getByRole("heading"),
  ).toHaveText("검증");
  await page
    .getByRole("button", { name: "검증 결과 보기", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /^검증/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("현재 시도 2 · 결과 1개")).toBeVisible();
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
    .click();
  for (const close of ["button", "escape", "backdrop"]) {
    await page.getByTestId("rf__node-review").locator("strong").first().click();
    await page
      .getByRole("button", { name: "리뷰 에이전트 추가", exact: true })
      .click();
    await page
      .getByRole("button", { name: "새 역할 만들기 · Markdown" })
      .click();
    if (close === "button")
      await page.getByRole("button", { name: "편집 닫기" }).click();
    else if (close === "escape") await page.keyboard.press("Escape");
    else
      await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const library = page.locator(".agent-library-section");
    if ((await library.getAttribute("open")) === null)
      await library.locator(":scope > summary").click();
    await page.getByRole("button", { name: "복제", exact: true }).click();
    await page
      .getByRole("button", { name: "에이전트 저장", exact: true })
      .click();
    await expect(
      page.getByText("에이전트 버전을 저장했습니다.", { exact: true }),
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "에이전트 · 개발 흐름", exact: true })
    .click();
  const last = page.getByTestId(
    "rf__node-00000000-0000-4000-8000-000000000011",
  );
  const label = last.locator("strong");
  await expect(label).toHaveCSS("font-size", "14px");
  await expect
    .poll(async () => (await last.boundingBox())!.height)
    .toBeGreaterThanOrEqual(58);
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.getByLabel("에이전트 담당 단계")).toHaveValue(
    "verification",
  );
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
    .getByRole("button", { name: "에이전트 접기", exact: true })
    .click();
  await expect(last).toHaveCount(0);
  await page
    .getByRole("button", { name: "에이전트 펼치기", exact: true })
    .click();
  await expect(last).toHaveCount(1);
});
