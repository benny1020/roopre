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
    if (events.length > 10000 || commands.length > 10000)
      throw Error("자동 이전 기록 수 한도를 넘었습니다.");
    await client.query("COMMIT");
    return { state, events, commands };
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
    throw Error("이전할 워크스페이스 ID가 다릅니다.");
  const bundle = await snapshot(source);
  if (
    bundle.state.runs.some(
      (r: any) =>
        activeStatuses.includes(r.status) ||
        r.runtime?.terminationConfirmed === false,
    )
  )
    throw Error("실행을 종료하고 종료 확인 후 이전하세요.");
  const bytes = JSON.stringify({
    version: 1,
    workspaceId: source.key,
    ...bundle,
  });
  if (Buffer.byteLength(bytes) > 50_000_000)
    throw Error("워크스페이스가 자동 이전 크기 한도를 넘었습니다.");
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
        "대상 데이터베이스에 기존 작업이 있습니다. 덮어쓰지 않습니다.",
      );
    const count = (
      await client.query(
        "SELECT count(*)::int AS count FROM events WHERE workspace_id=$1",
        [target.key],
      )
    ).rows[0].count;
    if (count) throw Error("대상 데이터베이스에 기존 이벤트가 있습니다.");
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
    throw Error("복원 검증이 일치하지 않습니다. 원본 환경을 유지합니다.");
  if (hash(await snapshot(source)) !== digest)
    throw Error("이전 중 원본이 변경됐습니다. 원본 환경을 유지합니다.");
  return { backup, hash: digest };
}
