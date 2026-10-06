import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { seed } from "./fixtures/workspace.ts";
import { ConversationService } from "../src/main/conversations/service.ts";

const connectionId = "00000000-0000-4000-8000-000000000091";
const agentId = "00000000-0000-4000-8000-000000000092";
const vault = {
  get: () => ({
    info: {
      id: connectionId,
      name: "Fixture",
      version: 1,
      endpoint: "https://fixture.invalid",
      auth: "api-key" as const,
      model: "fixture",
      hasKey: true,
      testStatus: "passed" as const,
      testedAt: new Date().toISOString(),
    },
    key: "fixture",
  }),
};
async function eventually(fn: () => Promise<any>) {
  for (let n = 0; n < 80; n++) {
    const value = await fn();
    if (value?.status !== "pending") return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("pending did not settle");
}

test("service persists 30 turns, sends lexical raw source and preserves answer on invalid summary", async (t) => {
  const store = new Store(
    `conversation-service-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  t.after(async () => {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query("DELETE FROM commands WHERE workspace_id=$1", [
      store.key,
    ]);
    await store.pool.query("DELETE FROM events WHERE workspace_id=$1", [
      store.key,
    ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "consult",
        archived: false,
      },
    ];
  });
  const captured: any[] = [];
  let service: ConversationService | undefined;
  service = new ConversationService(store, vault, async (_url, init) => {
    captured.push(JSON.parse(String(init?.body)));
    if (captured.length === 3) return new Response("rate", { status: 429 });
    const sourceIds = [
      ...String(captured.at(-1).system).matchAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/g),
    ].map((m) => m[0]);
    const answer =
      captured.length === 1
        ? "EARLY_DECISION_REASON_719"
        : captured.length > 10
          ? `큰 한국어 인용문 \"${"가".repeat(7000)}\"`
          : "answer";
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answer,
              summary: sourceIds.length
                ? { text: "valid summary", sourceTurnIds: sourceIds.slice(-1) }
                : "invalid legacy summary",
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
  });
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  let threadId = "";
  for (let i = 0; i < 30; i++) {
    const sent = await service!.send({
      scope,
      requestId: randomUUID(),
      message: i === 0 ? "SQLite대신PostgreSQL 결정을 기록" : `일반 질문 ${i}`,
    });
    threadId = sent.thread.id;
    const done = await eventually(async () =>
      (await service!.listTurns(threadId, undefined, 30)).at(-1),
    );
    assert(["completed", "failed"].includes(done.status));
  }
  const final = await service!.send({
    scope,
    requestId: randomUUID(),
    message: "초기 결정 이유를 다시 알려줘",
  });
  await eventually(async () =>
    (await service!.listTurns(final.thread.id, undefined, 30)).at(-1),
  );
  assert.match(JSON.stringify(captured.at(-1)), /EARLY_DECISION_REASON_719/);
  assert(
    captured.every(
      (body) => Buffer.byteLength(JSON.stringify(body)) <= 64 * 1024,
    ),
  );
  const last = (await service!.listTurns(threadId, undefined, 30)).at(-1)!;
  assert(last.answer?.includes("큰 한국어 인용문") || last.answer === "answer");
  assert.equal(last.status, "completed");
  assert.equal((await service!.getThread(threadId)).summary, "valid summary");
  await store.mutate((workspace) => {
    workspace.agents = [];
  });
  assert.equal((await service!.getThread(threadId)).id, threadId);
  assert((await service!.listTurns(threadId, undefined, 30)).length > 0);
  await assert.rejects(
    service!.send({
      scope,
      requestId: randomUUID(),
      message: "삭제된 정의에 보내기",
    }),
    /Deleted agents/,
  );
  await store.mutate((workspace) => {
    workspace.agents = [
      {
        id: agentId,
        revision: 2,
        name: "Archived consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "consult",
        archived: true,
      },
    ];
  });
  await assert.rejects(
    service!.send({
      scope,
      requestId: randomUUID(),
      message: "보관된 정의에 보내기",
    }),
    /Archived agents/,
  );
});

test("service sends the selected role policy and feature-scoped package instructions", async (t) => {
  const store = new Store(
    `conversation-harness-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  t.after(async () => {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  const assignmentId = "00000000-0000-4000-8000-000000000093";
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "AGENT_DEFINITION_MARKER",
        archived: false,
      },
    ];
    const project = w.projects.find((p) => p.id === "commerce")!;
    project.instructions = "PROJECT_POLICY_MARKER";
    project.workflow = {
      revision: 1,
      assignments: [
        { id: assignmentId, agentId, stage: "implementation", required: true },
        {
          id: "00000000-0000-4000-8000-000000000094",
          agentId,
          stage: "review",
          required: true,
        },
      ],
      instructions: {
        requirements: "WORKFLOW_REQUIREMENTS_MARKER",
        design: "WORKFLOW_DESIGN_MARKER",
        implementation: "WORKFLOW_IMPLEMENTATION_MARKER",
        verification: "WORKFLOW_VERIFICATION_MARKER",
        review: "WORKFLOW_REVIEW_MARKER",
      },
    };
    project.harness = {
      package: {
        schema: "roopre.harness/v1",
        id: "fixture.harness",
        version: "1.0.0",
        name: "Fixture",
        instructions: "PACKAGE_GLOBAL_MARKER",
        agents: [],
        profiles: [
          {
            id: "fixture",
            name: "Fixture",
            instructions: "",
            stageInstructions: {
              requirements: "",
              design: "",
              implementation: "",
              verification: "",
              review: "",
            },
            assignments: [],
            checks: [],
            requiredChecks: ["review"],
            scopes: [
              {
                id: "checkout-scope",
                name: "Checkout",
                paths: ["src/"],
                instructions: "FEATURE_SCOPE_MARKER",
              },
            ],
          },
        ],
      },
      profileId: "fixture",
      digest: "fixture",
      source: { kind: "editor" },
      agents: {},
      assignments: {},
      bindings: {},
      revision: 1,
      appliedAt: new Date().toISOString(),
    } as any;
    w.features.find((f) => f.id === "feature-checkout")!.harnessScope =
      "checkout-scope";
    w.policies.at(-1)!.implementation = "ROLE_IMPLEMENTATION_MARKER";
  });
  let captured = "";
  const service = new ConversationService(store, vault, async (_url, init) => {
    captured = String(JSON.parse(String(init?.body)).system);
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ answer: "answer" }) }],
      }),
    );
  });
  const sent = await service.send({
    scope: {
      workspaceId: store.key,
      projectId: "commerce",
      agentDefinitionId: agentId,
      featureId: "feature-checkout",
    },
    assignmentId,
    requestId: randomUUID(),
    message: "policy markers",
  });
  await eventually(async () =>
    (await service.listTurns(sent.thread.id)).at(-1),
  );
  for (const marker of [
    "PACKAGE_GLOBAL_MARKER",
    "FEATURE_SCOPE_MARKER",
    "PROJECT_POLICY_MARKER",
    "ROLE_IMPLEMENTATION_MARKER",
    "WORKFLOW_IMPLEMENTATION_MARKER",
    "AGENT_DEFINITION_MARKER",
  ])
    assert.match(captured, new RegExp(marker));
  assert.doesNotMatch(captured, /WORKFLOW_REVIEW_MARKER/);
});
