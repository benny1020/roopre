import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executionGraph,
  activeGraphStage,
} from "../src/shared/execution-graph.ts";
import { adeFixture } from "./fixtures/ade.ts";
import { refineAgent } from "../src/main/connections/refine-agent.ts";
const connectionId = "00000000-0000-4000-8000-000000000001";
const vault = {
  get: () => ({
    key: "private-key",
    info: {
      id: connectionId,
      name: "test",
      version: 1,
      hasKey: true,
      endpoint: "https://model.example",
      auth: "api-key" as const,
      model: "test",
    },
  }),
};
const input = { connectionId, stage: "review", brief: "컨벤션 검토 에이전트" };
test("graph separates current attempt, terminal uncertainty and transport loss", () => {
  const run = adeFixture().runs.at(-1)!;
  const current = run.runtime!.agents![0];
  current.status = "running";
  run.runtime!.agents!.push({
    ...current,
    id: "previous",
    attempt: 1,
    status: "passed",
  });
  assert.equal(executionGraph(run, true).length, 1);
  assert.equal(executionGraph(run, true)[0].state, "running");
  assert.equal(executionGraph(run, false)[0].state, "unknown");
  run.status = "cancelled";
  assert.equal(executionGraph(run, true)[0].state, "unknown");
  assert.match(executionGraph(run, true)[0].detail, /종료 확인/);
  run.runtime!.terminationConfirmed = true;
  assert.match(executionGraph(run, true)[0].detail, /결과 미확인/);
});
test("graph includes frozen assignments only for this run kind", () => {
  const run = adeFixture().runs.at(-1)!;
  run.runtime!.harness = {
    version: 1,
    workflowRevision: 8,
    agents: ["design", "review"].map((stage, i) => ({
      id: `a${i}`,
      agentId: `d${i}`,
      stage: stage as "design" | "review",
      required: true,
      agent: {
        id: `d${i}`,
        revision: 3,
        name: `role${i}`,
        description: "",
        capability: "read-only",
        markdown: "instruction",
        archived: false,
      },
      instructions: "frozen",
      connectionId,
      connectionVersion: 1,
    })),
  };
  assert.deepEqual(
    executionGraph(run, true).map((i) => i.stage),
    ["implementation", "review"],
  );
  run.runtime!.kind = "planning";
  run.runtime!.agents = [];
  assert.deepEqual(
    executionGraph(run, true).map((i) => i.stage),
    ["design"],
  );
});
test("AI refinement is a bounded tool-free request returning an editable draft", async () => {
  let body: any;
  const draft = {
    name: "컨벤션 검토",
    description: "명명 규칙 검증",
    markdown: "# 검토 기준\n확인한 근거를 기록한다.",
  };
  const result = await refineAgent(vault, input, async (url, options) => {
    assert.equal(String(url), "https://model.example/v1/messages");
    assert.equal(options?.redirect, "error");
    body = JSON.parse(String(options?.body));
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(draft) }],
      }),
    );
  });
  assert.deepEqual(result, draft);
  assert.equal(body.tools, undefined);
  assert.equal(body.max_tokens, 4096);
  assert.equal(JSON.stringify(body).includes("private-key"), false);
  assert.match(body.system, /Read-only/);
});
test("AI refinement rejects invalid, truncated, oversized and provider-error responses without leaking bodies", async () => {
  const responses = [
    new Response("private-key provider diagnostic", { status: 401 }),
    new Response("x".repeat(128001)),
    new Response(JSON.stringify({ stop_reason: "max_tokens", content: [] })),
    new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              name: "x",
              description: "",
              markdown: "x",
              capability: "implementation",
            }),
          },
        ],
      }),
    ),
  ];
  for (const response of responses)
    await assert.rejects(
      () => refineAgent(vault, input, async () => response),
      (e) => e instanceof Error && !e.message.includes("private-key"),
    );
  let called = false;
  await assert.rejects(() =>
    refineAgent(vault, { ...input, brief: "" }, async () => {
      called = true;
      return new Response();
    }),
  );
  assert.equal(called, false);
});

test("system-only verification highlights the stage without inventing a running agent", () => {
  const run = adeFixture().runs.at(-1)!;
  assert.equal(activeGraphStage(run, true), "verification");
  assert.equal(
    executionGraph(run, true).some((i) => i.state === "running"),
    false,
  );
  assert.equal(activeGraphStage(run, false), undefined);
  run.runtime!.cancelRequested = true;
  assert.equal(activeGraphStage(run, true), undefined);
});
