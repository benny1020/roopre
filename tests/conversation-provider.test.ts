import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { seed } from "./fixtures/workspace.ts";
import { ConversationService } from "../src/main/conversations/service.ts";

const connectionId = "00000000-0000-4000-8000-000000000291";
const agentId = "00000000-0000-4000-8000-000000000292";
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
    key: "provider-secret",
  }),
};
test("synthetic provider failures preserve input without leaking provider details or retrying", async (t) => {
  const store = new Store(
    `provider-${randomUUID()}`,
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
        name: "Fixture",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "fixture",
        archived: false,
      },
    ];
  });
  const cases: Array<() => Promise<Response>> = [
    async () => new Response("not-json"),
    async () =>
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "not-json" }],
        }),
      ),
    async () => new Response("provider-secret", { status: 429 }),
    async () => {
      throw Error("AbortError provider-secret");
    },
  ];
  let calls = 0;
  const service = new ConversationService(store, vault, async () =>
    cases[calls++](),
  );
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  for (let i = 0; i < cases.length; i++) {
    const sent = await service.send({
      scope,
      requestId: randomUUID(),
      message: `preserve ${i}`,
    });
    let turn: any;
    for (let n = 0; n < 100; n++) {
      turn = (await service.listTurns(sent.thread.id)).at(-1);
      if (turn.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(turn.status, "failed");
    assert.equal(turn.input, `preserve ${i}`);
    assert.doesNotMatch(turn.error || "", /provider-secret|not-json/);
  }
  assert.equal(calls, cases.length, "no automatic retry");
});
