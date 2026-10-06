import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { activeStatuses } from "../shared/runtime.ts";
function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
async function snapshot(store: Store) {
  const client = await store.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = (
      await client.query("SELECT state FROM workspaces WHERE id=$1", [
        store.key,
      ])
    ).rows[0].state;
    const events = (
      await client.query(
        "SELECT sequence::text,type,actor_id,feature_id,at,revision FROM events WHERE workspace_id=$1 ORDER BY sequence LIMIT 10001",
        [store.key],
      )
    ).rows;
    const commands = (
      await client.query(
        "SELECT request_id,actor_id,digest,command,response FROM commands WHERE workspace_id=$1 ORDER BY request_id LIMIT 10001",
        [store.key],
      )
    ).rows;
    const threads = (
      await client.query(
        "SELECT * FROM conversation_threads WHERE workspace_id=$1 ORDER BY id LIMIT 10001",
        [store.key],
      )
    ).rows;
    const turns = (
      await client.query(
        "SELECT c.* FROM conversation_turns c JOIN conversation_threads t ON t.id=c.thread_id WHERE t.workspace_id=$1 ORDER BY c.thread_id,c.ordinal LIMIT 10001",
        [store.key],
      )
    ).rows;
    const tombstones = (
      await client.query(
        "SELECT * FROM conversation_tombstones WHERE workspace_id=$1 ORDER BY thread_id LIMIT 10001",
        [store.key],
      )
    ).rows;
    if (
      events.length > 10000 ||
      commands.length > 10000 ||
      threads.length > 10000 ||
      turns.length > 10000 ||
      tombstones.length > 10000
    )
      throw Error("Automatic migration record limit exceeded.");
    await client.query("COMMIT");
    return { state, events, commands, threads, turns, tombstones };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function transferWorkspace(
  source: Store,
  target: Store,
  backupDirectory: string,
) {
  if (source.key !== target.key)
    throw Error("Source and target workspace IDs do not match.");
  const bundle = await snapshot(source);
  if (
    bundle.state.runs.some(
      (r: any) =>
        activeStatuses.includes(r.status) ||
        r.runtime?.terminationConfirmed === false,
    )
  )
    throw Error("End active runs and confirm termination before migrating.");
  if (bundle.turns.some((t: any) => t.status === "pending"))
    throw Error("A consultation is active. Try again after it finishes.");
  const bytes = JSON.stringify({
    version: 1,
    workspaceId: source.key,
    ...bundle,
  });
  if (Buffer.byteLength(bytes) > 50_000_000)
    throw Error("Workspace exceeds the automatic migration size limit.");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const digest = hash(bundle);
  const backup = join(backupDirectory, `workspace-${digest}.json`);
  await writeFile(backup, bytes, { mode: 0o600, flag: "wx" });
  const client = await target.pool.connect();
  try {
    await client.query("BEGIN");
    const state = (
      await client.query(
        "SELECT state FROM workspaces WHERE id=$1 FOR UPDATE",
        [target.key],
      )
    ).rows[0].state;
    if (
      state.projects.length ||
      state.features.length ||
      state.runs.length ||
      state.agents?.length
    )
      throw Error(
        "The target database contains work. It will not be overwritten.",
      );
    const count = (
      await client.query(
        "SELECT count(*)::int AS count FROM events WHERE workspace_id=$1",
        [target.key],
      )
    ).rows[0].count;
    if (count) throw Error("The target database contains events.");
    const commandCount = (
      await client.query(
        "SELECT count(*)::int AS count FROM commands WHERE workspace_id=$1",
        [target.key],
      )
    ).rows[0].count;
    if (commandCount)
      throw Error("The target database contains command history.");
    const conversationCount = (
      await client.query(
        "SELECT count(*)::int AS count FROM conversation_threads WHERE workspace_id=$1",
        [target.key],
      )
    ).rows[0].count;
    if (conversationCount)
      throw Error("The target database contains conversations.");
    const tombstoneCount = (
      await client.query(
        "SELECT count(*)::int AS count FROM conversation_tombstones WHERE workspace_id=$1",
        [target.key],
      )
    ).rows[0].count;
    if (tombstoneCount)
      throw Error(
        "The target database contains conversation deletion records.",
      );
    await client.query("UPDATE workspaces SET state=$2 WHERE id=$1", [
      target.key,
      JSON.stringify(bundle.state),
    ]);
    for (const e of bundle.events)
      await client.query(
        "INSERT INTO events(sequence,workspace_id,type,actor_id,feature_id,at,revision) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          e.sequence,
          target.key,
          e.type,
          e.actor_id,
          e.feature_id,
          e.at,
          e.revision,
        ],
      );
    for (const c of bundle.commands)
      await client.query(
        "INSERT INTO commands(workspace_id,request_id,actor_id,digest,command,response) VALUES($1,$2,$3,$4,$5,$6)",
        [
          target.key,
          c.request_id,
          c.actor_id,
          c.digest,
          JSON.stringify(c.command),
          JSON.stringify(c.response),
        ],
      );
    for (const t of bundle.threads)
      await client.query(
        "INSERT INTO conversation_threads(id,workspace_id,project_id,agent_definition_id,feature_key,revision,epoch,archived,summary,summary_through,summary_sources,summary_revision,reserved_bytes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        [
          t.id,
          t.workspace_id,
          t.project_id,
          t.agent_definition_id,
          t.feature_key,
          t.revision,
          t.epoch,
          t.archived,
          t.summary,
          t.summary_through,
          JSON.stringify(t.summary_sources || []),
          t.summary_revision,
          t.reserved_bytes,
          t.created_at,
          t.updated_at,
        ],
      );
    for (const c of bundle.turns)
      await client.query(
        "INSERT INTO conversation_turns(id,thread_id,ordinal,request_id,input,answer,status,input_digest,retry_of,error,warning,context_manifest,usage,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        [
          c.id,
          c.thread_id,
          c.ordinal,
          c.request_id,
          c.input,
          c.answer,
          c.status,
          c.input_digest,
          c.retry_of,
          c.error,
          c.warning,
          JSON.stringify(c.context_manifest),
          c.usage ? JSON.stringify(c.usage) : null,
          c.created_at,
          c.updated_at,
        ],
      );
    for (const tombstone of bundle.tombstones)
      await client.query(
        "INSERT INTO conversation_tombstones(thread_id,workspace_id,project_id,agent_definition_id,feature_key,epoch,request_digests,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          tombstone.thread_id,
          tombstone.workspace_id,
          tombstone.project_id,
          tombstone.agent_definition_id,
          tombstone.feature_key,
          tombstone.epoch,
          JSON.stringify(tombstone.request_digests || []),
          tombstone.deleted_at,
        ],
      );
    await client.query(
      "SELECT setval(pg_get_serial_sequence('events','sequence'),COALESCE((SELECT max(sequence) FROM events),1),EXISTS(SELECT 1 FROM events))",
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  if (hash(await snapshot(target)) !== digest)
    throw Error(
      "Restore verification failed. The source environment is preserved.",
    );
  if (hash(await snapshot(source)) !== digest)
    throw Error(
      "The source changed during migration. The source environment is preserved.",
    );
  return { backup, hash: digest };
}
