import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, databaseUrl } from "../src/database/store.ts";
import { transferWorkspace } from "../src/database/transfer.ts";
import * as conversations from "../src/database/conversations.ts";

test("conversation transfer round-trips turns, summaries and tombstones without overwriting targets", async () => {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const sourceSchema = `transfer_source_${randomUUID().replaceAll("-", "")}`;
  const targetSchema = `transfer_target_${randomUUID().replaceAll("-", "")}`;
  const key = `transfer-${randomUUID()}`;
  const root = await mkdtemp(join(tmpdir(), "roopre-conversation-transfer-"));
  let source: Store | undefined;
  let target: Store | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${sourceSchema}`);
    await admin.query(`CREATE SCHEMA ${targetSchema}`);
    const url = (schema: string) => {
      const value = new URL(databaseUrl);
      value.searchParams.set("options", `-c search_path=${schema}`);
      return value.href;
    };
    source = new Store(key, url(sourceSchema), "local-owner");
    target = new Store(key, url(targetSchema), "local-owner");
    await source.init();
    await target.init();
    const scope = {
      workspaceId: key,
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
    const pending = await conversations.createPending(
      source.pool,
      scope,
      randomUUID(),
      "persist this",
      randomUUID(),
      1,
      manifest,
    );
    await conversations.finishPending(
      source.pool,
      pending,
      "persisted answer",
      { text: "summary survives", through: 1, sourceIds: [pending.turn.id] },
      { inputTokens: 3, outputTokens: 2 },
    );
    await source.pool.query(
      "UPDATE conversation_turns SET warning=$2 WHERE id=$1",
      [pending.turn.id, "summary warning"],
    );
    const deleted = await conversations.createPending(
      source.pool,
      { ...scope, featureId: undefined },
      randomUUID(),
      "deleted turn",
      randomUUID(),
      1,
      manifest,
    );
    await conversations.finishPending(
      source.pool,
      deleted,
      "deleted answer",
      undefined,
      null,
    );
    // This transfer fixture seeds a tombstone directly to exercise round-trip
    // persistence. Production atomic deletion is covered by memory-store tests.
    await source.pool.query(
      "INSERT INTO conversation_tombstones(thread_id,workspace_id,project_id,agent_definition_id,feature_key,epoch,request_digests) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        deleted.thread.id,
        key,
        scope.projectId,
        scope.agentDefinitionId,
        "__project__",
        1,
        JSON.stringify([{ requestId: deleted.turn.requestId }]),
      ],
    );
    await source.pool.query("DELETE FROM conversation_threads WHERE id=$1", [
      deleted.thread.id,
    ]);
    const before = await source.pool.query(
      "SELECT count(*)::int AS n FROM conversation_threads WHERE workspace_id=$1",
      [key],
    );
    const result = await transferWorkspace(
      source,
      target,
      join(root, "backup"),
    );
    assert.equal(result.hash.length, 64);
    const threads = await conversations.listConversationThreads(
      target.pool,
      scope,
    );
    const turns = await conversations.listConversationTurns(
      target.pool,
      threads[0].id,
    );
    assert.equal(threads[0].summary, "summary survives");
    assert.deepEqual(threads[0].summarySourceTurnIds, [pending.turn.id]);
    assert.equal(turns[0].answer, "persisted answer");
    assert.deepEqual(turns[0].usage, { inputTokens: 3, outputTokens: 2 });
    assert.equal(
      (
        await target.pool.query(
          "SELECT warning FROM conversation_turns WHERE id=$1",
          [pending.turn.id],
        )
      ).rows[0].warning,
      "summary warning",
    );
    assert.equal(
      Number(
        (
          await target.pool.query(
            "SELECT count(*)::int AS n FROM conversation_tombstones WHERE workspace_id=$1",
            [key],
          )
        ).rows[0].n,
      ),
      1,
    );
    assert.equal(Number(before.rows[0].n), 1, "source remains preserved");
    const targetState = await target.read("owner");
    await assert.rejects(
      transferWorkspace(source, target, join(root, "second-backup")),
      /contains conversations|contains events|contains work/,
    );
    assert.deepEqual(
      await target.read("owner"),
      targetState,
      "failed retry is atomic",
    );
  } finally {
    await source?.close();
    await target?.close();
    await admin
      .query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`)
      .catch(() => {});
    await admin
      .query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`)
      .catch(() => {});
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
});

test("transfer rejects a tombstone-only target without changing it", async () => {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const sourceSchema = `transfer_empty_source_${randomUUID().replaceAll("-", "")}`;
  const targetSchema = `transfer_tombstone_target_${randomUUID().replaceAll("-", "")}`;
  const key = `transfer-${randomUUID()}`;
  let source: Store | undefined;
  let target: Store | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${sourceSchema}`);
    await admin.query(`CREATE SCHEMA ${targetSchema}`);
    const url = (schema: string) => {
      const value = new URL(databaseUrl);
      value.searchParams.set("options", `-c search_path=${schema}`);
      return value.href;
    };
    source = new Store(key, url(sourceSchema), "local-owner");
    target = new Store(key, url(targetSchema), "local-owner");
    await source.init();
    await target.init();
    await target.pool.query(
      "INSERT INTO conversation_tombstones(thread_id,workspace_id,project_id,agent_definition_id,feature_key,epoch,request_digests) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), key, "project", "agent", "__project__", 1, "[]"],
    );
    const before = await target.pool.query(
      "SELECT * FROM conversation_tombstones WHERE workspace_id=$1",
      [key],
    );
    await assert.rejects(
      transferWorkspace(
        source,
        target,
        join(tmpdir(), `transfer-backup-${randomUUID()}`),
      ),
      /contains conversation deletion records/,
    );
    assert.deepEqual(
      (
        await target.pool.query(
          "SELECT * FROM conversation_tombstones WHERE workspace_id=$1",
          [key],
        )
      ).rows,
      before.rows,
    );
  } finally {
    await source?.close();
    await target?.close();
    await admin
      .query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`)
      .catch(() => {});
    await admin
      .query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`)
      .catch(() => {});
    await admin.end();
  }
});
