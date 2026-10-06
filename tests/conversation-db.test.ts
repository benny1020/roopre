import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { databaseUrl } from "../src/database/store.ts";
import pg from "pg";
import * as db from "../src/database/conversations.ts";

test("conversation DB lifecycle enforces idempotency, retry scope, pending limits and stale completion", async () => {
  const store = new Store(
    `conversation-db-${randomUUID()}`,
    undefined,
    "local-owner",
  );
  const defaultScope = {
    workspaceId: store.key,
    projectId: "project",
    agentDefinitionId: "agent",
    featureId: "feature",
  };
  const connectionId = randomUUID();
  const manifest = {
    agentRevision: 1,
    memories: [],
    recentTurnIds: [],
    searchTurnIds: [],
    excluded: [],
  };
  const create = (
    scope = defaultScope,
    retryOf?: string,
    requestId = randomUUID(),
  ) =>
    db.createPending(
      store.pool,
      scope,
      requestId,
      "same question",
      connectionId,
      1,
      manifest,
      retryOf,
    );
  try {
    await store.init();
    const requestId = randomUUID();
    const first = await create(defaultScope, undefined, requestId);
    const duplicate = await create(defaultScope, undefined, requestId);
    assert.equal(duplicate.created, false);
    await assert.rejects(
      db.createPending(
        store.pool,
        defaultScope,
        requestId,
        "different",
        connectionId,
        1,
        manifest,
      ),
      /already been used/,
    );
    await assert.rejects(create(), /consultation|response.*in progress/);
    const secondScope = { ...defaultScope, featureId: "other" };
    const second = await create(secondScope);
    await assert.rejects(
      create({ ...defaultScope, featureId: "third" }),
      /two consultation/,
    );
    assert.equal(
      await db.cancelConversationTurn(
        store.pool,
        store.key,
        first.thread.id,
        first.turn.id,
      ),
      true,
    );
    assert.equal(
      await db.finishPending(store.pool, first, "late", undefined, null),
      false,
    );
    assert.equal(
      await db.failPending(store.pool, first, "failed", "late"),
      false,
    );
    const retry = await create(defaultScope, first.turn.id);
    assert.equal(retry.turn.retryOf, first.turn.id);
    await assert.rejects(
      create(defaultScope, retry.turn.id),
      /consultation|response.*in progress/,
    );
    assert.equal(
      await db.cancelConversationTurn(
        store.pool,
        store.key,
        second.thread.id,
        second.turn.id,
      ),
      true,
    );
    await assert.rejects(
      create(secondScope, first.turn.id),
      /failed, interrupted or cancelled/,
    );
    await db.interruptPendingConversations(store.pool, store.key);
    const interrupted = await db.listConversationTurns(
      store.pool,
      retry.thread.id,
    );
    assert.equal(
      interrupted.find((turn) => turn.id === retry.turn.id)!.status,
      "interrupted",
    );
    assert.equal(
      Number(
        (
          await store.pool.query(
            "SELECT sum(reserved_bytes)::int AS n FROM conversation_threads WHERE workspace_id=$1",
            [store.key],
          )
        ).rows[0].n,
      ),
      0,
    );
    await db.finishPending(
      store.pool,
      retry,
      "answer",
      {
        text: "summary",
        through: retry.turn.ordinal,
        sourceIds: [retry.turn.id],
      },
      null,
    );
    const thread = await db.getConversationThread(store.pool, retry.thread.id);
    await db.resetConversationSummary(store.pool, thread!.id, thread!.revision);
    assert.equal(
      (await db.getConversationThread(store.pool, thread!.id))!.summary,
      null,
    );
  } finally {
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
  }
});

test("conversation DB rejects quota without partial state and tombstones reject only replayed ids", async () => {
  const store = new Store(
    `conversation-edge-${randomUUID()}`,
    undefined,
    "local-owner",
  );
  const scope = {
    workspaceId: store.key,
    projectId: "project",
    agentDefinitionId: "agent",
    featureId: "feature",
  };
  const manifest = {
    agentRevision: 1,
    memories: [],
    recentTurnIds: [],
    searchTurnIds: [],
    excluded: [],
  };
  try {
    await store.init();
    await assert.rejects(
      db.createPending(
        store.pool,
        scope,
        randomUUID(),
        "x".repeat(5 * 1024 * 1024 - 150 * 1024),
        randomUUID(),
        1,
        manifest,
      ),
      /storage limit/,
    );
    assert.equal(
      Number(
        (
          await store.pool.query(
            "SELECT count(*)::int AS n FROM conversation_threads WHERE workspace_id=$1",
            [store.key],
          )
        ).rows[0].n,
      ),
      0,
    );
    const requestId = randomUUID();
    const pending = await db.createPending(
      store.pool,
      scope,
      requestId,
      "same question",
      randomUUID(),
      1,
      manifest,
    );
    await db.failPending(store.pool, pending, "failed", "fixture");
    await store.pool.query(
      "INSERT INTO conversation_tombstones(thread_id,workspace_id,project_id,agent_definition_id,feature_key,epoch,request_digests) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        pending.thread.id,
        store.key,
        scope.projectId,
        scope.agentDefinitionId,
        scope.featureId,
        1,
        JSON.stringify([{ requestId }]),
      ],
    );
    await store.pool.query("DELETE FROM conversation_threads WHERE id=$1", [
      pending.thread.id,
    ]);
    await assert.rejects(
      db.createPending(
        store.pool,
        scope,
        requestId,
        "same question",
        randomUUID(),
        1,
        manifest,
      ),
      /deleted conversation/,
    );
    const fresh = await db.createPending(
      store.pool,
      scope,
      randomUUID(),
      "same question",
      randomUUID(),
      1,
      manifest,
    );
    assert.equal(fresh.created, true);
  } finally {
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
  }
});

test("Store.init serializes concurrent schema migrations", async () => {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const schema = `init_parallel_${randomUUID().replaceAll("-", "")}`;
  const stores: Store[] = [];
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    for (let i = 0; i < 5; i++)
      stores.push(new Store(`init-${i}`, url.href, "local-owner"));
    await Promise.all(stores.map((store) => store.init()));
    const late = new Store("init-late", url.href, "local-owner");
    stores.push(late);
    await Promise.all([
      late.init(),
      stores[0].execute("owner", randomUUID(), {
        type: "create_project",
        name: "concurrent write",
        description: "fixture",
        reviewerIds: ["owner"],
      }),
    ]);
    assert.equal(
      Number(
        (
          await stores[0].pool.query(
            "SELECT count(*)::int AS n FROM workspaces",
          )
        ).rows[0].n,
      ),
      6,
    );
  } finally {
    await Promise.all(stores.map((store) => store.close()));
    await admin
      .query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      .catch(() => {});
    await admin.end();
  }
});
