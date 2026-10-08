import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { approvedRun } from "./fixtures/approved-run.ts";
import { Store } from "../src/database/store.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { publishableRun } from "../src/domain/handoff.ts";
import { assertMemoryMutationAllowed } from "../src/domain/memory.ts";
import * as conversations from "../src/database/conversations.ts";

test("PostgreSQL handoff guard rolls back contract mutations and releases only its own attempt", async () => {
  const key = `handoff-store-${randomUUID()}`;
  const fixture = approvedRun(key);
  const store = new Store(key, undefined, "local-owner", () => fixture.w);
  try {
    await store.init();
    await store.mutate((w) => {
      w.features[0].designs[0].decisions[0].binding = approvalBinding(
        w,
        w.features[0],
      );
      w.runs[0].runtime!.binding = approvalBinding(w, w.features[0]);
    });
    await store.mutate((w) => {
      const r = publishableRun(w, fixture.run.id);
      r.runtime.handoff = {
        attemptId: "current",
        binding: r.runtime.binding,
        startedAt: new Date().toISOString(),
      };
    });
    const before = await store.read("owner");
    await assert.rejects(
      store.execute("owner", randomUUID(), {
        type: "review",
        featureId: fixture.f.id,
        designId: fixture.f.designs[0].id,
        decision: "withdraw",
        checked: [],
      }),
      /publishing is in progress/,
    );
    await assert.rejects(
      store.mutate((w) => {
        w.projects[0].instructions = "changed";
      }),
      /publishing is in progress/,
    );
    assert.throws(
      () => assertMemoryMutationAllowed(before, fixture.f.projectId),
      /End.*first/,
    );
    assert.deepEqual(await store.read("owner"), before);
    await store.mutate((w) => {
      if (w.runs[0].runtime!.handoff?.attemptId === "stale")
        delete w.runs[0].runtime!.handoff;
    });
    assert.equal(
      (await store.read("owner")).runs[0].runtime!.handoff!.attemptId,
      "current",
    );
    await store.mutate((w) => {
      delete w.runs[0].runtime!.handoff;
    });
    await store.execute("owner", randomUUID(), {
      type: "review",
      featureId: fixture.f.id,
      designId: fixture.f.designs[0].id,
      decision: "withdraw",
      checked: [],
    });
    assert.equal((await store.read("owner")).runs[0].status, "blocked");
  } finally {
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [key]);
    await store.close();
  }
});

test("conversation memory deletion invalidates an actually publishable completed run atomically", async () => {
  const key = `handoff-memory-${randomUUID()}`;
  const fixture = approvedRun(key);
  const store = new Store(key, undefined, "local-owner", () => fixture.w);
  try {
    await store.init();
    const thread = await conversations.createPending(
      store.pool,
      {
        workspaceId: key,
        projectId: fixture.f.projectId,
        featureId: fixture.f.id,
        agentDefinitionId: "fixture-agent",
      },
      randomUUID(),
      "Fixture source",
      randomUUID(),
      1,
      {
        agentRevision: 1,
        memories: [],
        recentTurnIds: [],
        searchTurnIds: [],
        excluded: [],
      },
    );
    await conversations.finishPending(
      store.pool,
      thread,
      "Fixture answer",
      undefined,
      null,
    );
    await store.mutate((w) => {
      w.projects[0].memories = [
        {
          id: "derived",
          agentDefinitionId: "fixture-agent",
          featureId: fixture.f.id,
          title: "Fixture",
          body: "Reference",
          revision: 1,
          active: true,
          authorId: "owner",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceRefs: [
            {
              type: "conversation",
              threadId: thread.thread.id,
              turnId: thread.turn.id,
            },
          ],
        },
      ];
    });
    // Load canonical PostgreSQL order before generating disposable fixture proof.
    await store.mutate((w) => {
      w.features[0].designs[0].decisions[0].binding = approvalBinding(
        w,
        w.features[0],
      );
      w.runs[0].runtime!.binding = approvalBinding(w, w.features[0]);
    });
    const before = await store.read("owner");
    assert.doesNotThrow(() => publishableRun(before, fixture.run.id));
    await store.deleteConversation(thread.thread.id, ["derived"]);
    const after = await store.read("owner");
    assert.equal(after.runs[0].status, "blocked");
    assert.equal(after.features[0].designs[0].decisions.length, 0);
    assert.equal(after.projects[0].memories![0].active, false);
    assert.throws(
      () => publishableRun(after, fixture.run.id),
      /Current design approval/,
    );
  } finally {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [key]);
    await store.close();
  }
});
