import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type {
  ConversationScope,
  ConversationThread,
  ConversationTurn,
  ContextManifest,
} from "../shared/conversations.ts";

export const NO_FEATURE = "__project__";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const scopeValues = (s: ConversationScope) => [
  s.workspaceId,
  s.projectId,
  s.agentDefinitionId,
  s.featureId || NO_FEATURE,
];
const iso = (x: Date) => x.toISOString();
export async function initConversationTables(pool: Pick<pg.Pool, "query">) {
  await pool.query(`CREATE TABLE IF NOT EXISTS conversation_threads (
    id uuid PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), project_id text NOT NULL, agent_definition_id text NOT NULL, feature_key text NOT NULL,
    revision integer NOT NULL DEFAULT 0, epoch integer NOT NULL DEFAULT 0, archived boolean NOT NULL DEFAULT false,
    summary text, summary_through integer, summary_sources jsonb NOT NULL DEFAULT '[]', summary_revision integer NOT NULL DEFAULT 0, reserved_bytes bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(workspace_id,project_id,agent_definition_id,feature_key));
    CREATE TABLE IF NOT EXISTS conversation_turns (
    id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE, ordinal integer NOT NULL,
    request_id uuid NOT NULL, input text NOT NULL, answer text, status text NOT NULL CHECK(status IN ('pending','completed','failed','interrupted','cancelled')),
    input_digest text NOT NULL, retry_of uuid, error text, warning text, context_manifest jsonb NOT NULL, usage jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(thread_id,ordinal), UNIQUE(thread_id,request_id));
    CREATE TABLE IF NOT EXISTS conversation_tombstones (thread_id uuid PRIMARY KEY, workspace_id text NOT NULL, project_id text NOT NULL, agent_definition_id text NOT NULL, feature_key text NOT NULL, epoch integer NOT NULL, request_digests jsonb NOT NULL DEFAULT '[]', deleted_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS conversation_turns_page ON conversation_turns(thread_id,ordinal DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_one_pending_per_thread ON conversation_turns(thread_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS conversation_threads_scope ON conversation_threads(workspace_id,project_id,agent_definition_id,feature_key);`);
  await pool.query(
    "ALTER TABLE conversation_threads ADD COLUMN IF NOT EXISTS summary_sources jsonb NOT NULL DEFAULT '[]'",
  );
  await pool.query(
    "ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS warning text",
  );
  await pool.query(
    "ALTER TABLE conversation_tombstones ADD COLUMN IF NOT EXISTS workspace_id text",
  );
  await pool.query(
    "ALTER TABLE conversation_tombstones ADD COLUMN IF NOT EXISTS project_id text",
  );
  await pool.query(
    "ALTER TABLE conversation_tombstones ADD COLUMN IF NOT EXISTS agent_definition_id text",
  );
  await pool.query(
    "ALTER TABLE conversation_tombstones ADD COLUMN IF NOT EXISTS feature_key text",
  );
  await pool.query(
    "ALTER TABLE conversation_tombstones ADD COLUMN IF NOT EXISTS request_digests jsonb NOT NULL DEFAULT '[]'",
  );
}
function thread(row: any): ConversationThread {
  return {
    id: row.id,
    scope: {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      agentDefinitionId: row.agent_definition_id,
      ...(row.feature_key === NO_FEATURE ? {} : { featureId: row.feature_key }),
    },
    revision: row.revision,
    epoch: row.epoch,
    archived: row.archived,
    summary: row.summary,
    summaryThrough: row.summary_through,
    summarySourceTurnIds: row.summary_sources || [],
    summaryRevision: row.summary_revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function turn(row: any): ConversationTurn {
  return {
    id: row.id,
    threadId: row.thread_id,
    ordinal: row.ordinal,
    requestId: row.request_id,
    input: row.input,
    answer: row.answer,
    status: row.status,
    retryOf: row.retry_of,
    error: row.error,
    warning: row.warning,
    contextManifest: row.context_manifest,
    usage: row.usage,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
export async function listConversationThreads(
  pool: pg.Pool,
  scope: ConversationScope,
) {
  return (
    await pool.query(
      "SELECT * FROM conversation_threads WHERE workspace_id=$1 AND project_id=$2 AND agent_definition_id=$3 AND feature_key=$4 ORDER BY updated_at DESC",
      scopeValues(scope),
    )
  ).rows.map(thread);
}
export async function getConversationThread(pool: pg.Pool, id: string) {
  const r = await pool.query("SELECT * FROM conversation_threads WHERE id=$1", [
    id,
  ]);
  return r.rows[0] ? thread(r.rows[0]) : undefined;
}
export async function listConversationTurns(
  pool: pg.Pool,
  id: string,
  before?: number,
  limit = 30,
) {
  const r = await pool.query(
    `SELECT * FROM conversation_turns WHERE thread_id=$1 ${before ? "AND ordinal<$2" : ""} ORDER BY ordinal DESC LIMIT $${before ? 3 : 2}`,
    before ? [id, before, limit] : [id, limit],
  );
  return r.rows.map(turn).reverse();
}
export async function searchConversationTurns(
  pool: pg.Pool,
  threadId: string,
  query: string,
) {
  const terms = [
    ...new Set(
      query
        .normalize("NFC")
        .toLowerCase()
        .split(/\s+/)
        .filter((x) => x.length > 1),
    ),
  ].slice(0, 8);
  if (!terms.length) return [];
  const rows = await pool.query(
    "SELECT * FROM conversation_turns WHERE thread_id=$1 AND status='completed' AND (input ILIKE ANY($2) OR COALESCE(answer,'') ILIKE ANY($2)) ORDER BY ordinal DESC LIMIT 4",
    [threadId, terms.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`)],
  );
  return rows.rows.map(turn).reverse();
}
export async function listSummarySourceTurns(
  pool: pg.Pool,
  threadId: string,
  afterOrdinal: number,
) {
  return (
    await pool.query(
      "SELECT * FROM conversation_turns WHERE thread_id=$1 AND ordinal>$2 AND status IN ('completed','failed','interrupted','cancelled') ORDER BY ordinal ASC LIMIT 12",
      [threadId, afterOrdinal],
    )
  ).rows.map(turn);
}
export type Pending = {
  thread: ConversationThread;
  turn: ConversationTurn;
  epoch: number;
  connectionVersion: number;
  created: boolean;
};
export type ExpectedConversationContext =
  | { threadId: string; revision: number; summaryRevision: number }
  | { threadId: null };
export async function createPending(
  pool: pg.Pool,
  scope: ConversationScope,
  requestId: string,
  input: string,
  connectionId: string,
  connectionVersion: number,
  manifest: ContextManifest,
  retryOf?: string,
  requestPayload?: unknown,
  expectedContext?: ExpectedConversationContext,
): Promise<Pending> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      scope.workspaceId,
    ]);
    const existing = await client.query(
      "SELECT t.*, c.input_digest FROM conversation_turns c JOIN conversation_threads t ON t.id=c.thread_id WHERE t.workspace_id=$1 AND t.project_id=$2 AND t.agent_definition_id=$3 AND t.feature_key=$4 AND c.request_id=$5 FOR UPDATE",
      [...scopeValues(scope), requestId],
    );
    const inputDigest = digest(
      requestPayload ?? { scope, input, connectionId, retryOf },
    );
    const deleted = await client.query(
      "SELECT 1 FROM conversation_tombstones WHERE workspace_id=$1 AND project_id=$2 AND agent_definition_id=$3 AND feature_key=$4 AND request_digests @> $5::jsonb",
      [...scopeValues(scope), JSON.stringify([{ requestId }])],
    );
    if (deleted.rows[0])
      throw Error(
        "삭제된 대화의 요청은 다시 사용할 수 없습니다. 새 요청으로 다시 시도하세요.",
      );
    if (existing.rows[0]) {
      if (existing.rows[0].input_digest !== inputDigest)
        throw Error("이미 사용된 요청 ID입니다.");
      const tr = thread(existing.rows[0]);
      const row = (
        await client.query(
          "SELECT * FROM conversation_turns WHERE thread_id=$1 AND request_id=$2",
          [tr.id, requestId],
        )
      ).rows[0];
      await client.query("COMMIT");
      return {
        thread: tr,
        turn: turn(row),
        epoch: tr.epoch,
        connectionVersion,
        created: false,
      };
    }
    let found = await client.query(
      "SELECT * FROM conversation_threads WHERE workspace_id=$1 AND project_id=$2 AND agent_definition_id=$3 AND feature_key=$4 FOR UPDATE",
      scopeValues(scope),
    );
    if (
      expectedContext &&
      ((expectedContext.threadId === null && found.rows[0]) ||
        (expectedContext.threadId !== null &&
          (!found.rows[0] ||
            found.rows[0].id !== expectedContext.threadId ||
            Number(found.rows[0].revision) !== expectedContext.revision ||
            Number(found.rows[0].summary_revision) !==
              expectedContext.summaryRevision)))
    )
      throw Error("상담 맥락이 변경되었습니다. 다시 시도하세요.");
    if (!found.rows[0]) {
      const id = randomUUID();
      await client.query(
        "INSERT INTO conversation_threads(id,workspace_id,project_id,agent_definition_id,feature_key) VALUES($1,$2,$3,$4,$5)",
        [id, ...scopeValues(scope)],
      );
      found = await client.query(
        "SELECT * FROM conversation_threads WHERE id=$1 FOR UPDATE",
        [id],
      );
    }
    const tr = thread(found.rows[0]);
    if (tr.archived) throw Error("보관된 대화에는 새 질문을 보낼 수 없습니다.");
    const threadPending = await client.query(
      "SELECT 1 FROM conversation_turns WHERE thread_id=$1 AND status='pending'",
      [tr.id],
    );
    if (threadPending.rows[0])
      throw Error("같은 대화에서 진행 중인 상담이 있습니다.");
    if (retryOf) {
      const prior = (
        await client.query(
          "SELECT status FROM conversation_turns WHERE id=$1 AND thread_id=$2 FOR UPDATE",
          [retryOf, tr.id],
        )
      ).rows[0];
      if (
        !prior ||
        !["failed", "interrupted", "cancelled"].includes(prior.status)
      )
        throw Error(
          "재요청은 같은 대화의 실패·중단·취소된 질문만 대상으로 합니다.",
        );
    }
    const activeCount = Number(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM conversation_turns c JOIN conversation_threads t ON t.id=c.thread_id WHERE t.workspace_id=$1 AND c.status='pending'",
          [scope.workspaceId],
        )
      ).rows[0].n,
    );
    if (activeCount >= 2)
      throw Error("동시에 상담할 수 있는 요청은 두 개까지입니다.");
    // Reserve the input plus the largest accepted provider body, a bounded
    // summary, manifest/usage metadata, and a small row-format margin.
    const reserve = bytes(input) + 128 * 1024 + 16 * 1024 + 16 * 1024;
    const used = Number(
      (
        await client.query(
          "SELECT COALESCE((SELECT sum(octet_length(input)+COALESCE(octet_length(answer),0)+octet_length(context_manifest::text)) FROM conversation_turns WHERE thread_id=$1),0)+COALESCE((SELECT octet_length(summary)+octet_length(summary_sources::text) FROM conversation_threads WHERE id=$1),0) AS n",
          [tr.id],
        )
      ).rows[0].n,
    );
    const workspaceUsed = Number(
      (
        await client.query(
          "SELECT (SELECT COALESCE(sum(octet_length(c.input)+COALESCE(octet_length(c.answer),0)+octet_length(c.context_manifest::text)),0) FROM conversation_turns c JOIN conversation_threads t ON t.id=c.thread_id WHERE t.workspace_id=$1) + (SELECT COALESCE(sum(COALESCE(octet_length(summary),0)+octet_length(summary_sources::text)),0) FROM conversation_threads WHERE workspace_id=$1) + (SELECT COALESCE(sum(reserved_bytes),0) FROM conversation_threads WHERE workspace_id=$1) AS n",
          [scope.workspaceId],
        )
      ).rows[0].n,
    );
    if (
      used + reserve > 5 * 1024 * 1024 ||
      workspaceUsed + reserve > 100 * 1024 * 1024
    )
      throw Error(
        "대화 저장 공간 한도를 넘었습니다. 기존 대화를 정리한 뒤 다시 시도하세요.",
      );
    const ordinal = Number(
      (
        await client.query(
          "SELECT COALESCE(max(ordinal),0)+1 AS n FROM conversation_turns WHERE thread_id=$1",
          [tr.id],
        )
      ).rows[0].n,
    );
    const id = randomUUID();
    const row = (
      await client.query(
        "INSERT INTO conversation_turns(id,thread_id,ordinal,request_id,input,status,input_digest,retry_of,context_manifest) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8) RETURNING *",
        [
          id,
          tr.id,
          ordinal,
          requestId,
          input,
          inputDigest,
          retryOf || null,
          JSON.stringify({ ...manifest, connectionId, connectionVersion }),
        ],
      )
    ).rows[0];
    await client.query(
      "UPDATE conversation_threads SET revision=revision+1,reserved_bytes=reserved_bytes+$2,updated_at=now() WHERE id=$1",
      [tr.id, reserve],
    );
    const fresh = thread(
      (
        await client.query("SELECT * FROM conversation_threads WHERE id=$1", [
          tr.id,
        ])
      ).rows[0],
    );
    await client.query("COMMIT");
    return {
      thread: fresh,
      turn: turn(row),
      epoch: fresh.epoch,
      connectionVersion,
      created: true,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function finishPending(
  pool: pg.Pool,
  pending: Pending,
  answer: string,
  summary: { text: string; through: number; sourceIds: string[] } | undefined,
  usage: unknown,
  warning?: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      pending.thread.scope.workspaceId,
    ]);
    const current = (
      await client.query(
        "SELECT * FROM conversation_threads WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [pending.thread.id, pending.thread.scope.workspaceId],
      )
    ).rows[0];
    if (!current || current.epoch !== pending.epoch) {
      await client.query("ROLLBACK");
      return false;
    }
    const row = (
      await client.query(
        "SELECT * FROM conversation_turns WHERE id=$1 FOR UPDATE",
        [pending.turn.id],
      )
    ).rows[0];
    if (!row || row.status !== "pending") {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE conversation_turns SET answer=$2,status='completed',usage=$3,warning=$4,updated_at=now() WHERE id=$1",
      [row.id, answer, usage ? JSON.stringify(usage) : null, warning || null],
    );
    if (summary && current.summary_revision === pending.thread.summaryRevision)
      await client.query(
        "UPDATE conversation_threads SET summary=$2,summary_through=$3,summary_sources=$4,summary_revision=summary_revision+1,revision=revision+1,reserved_bytes=0,updated_at=now() WHERE id=$1",
        [
          current.id,
          summary.text,
          summary.through,
          JSON.stringify(summary.sourceIds),
        ],
      );
    else
      await client.query(
        "UPDATE conversation_threads SET revision=revision+1,reserved_bytes=0,updated_at=now() WHERE id=$1",
        [current.id],
      );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function failPending(
  pool: pg.Pool,
  pending: Pending,
  status: "failed" | "interrupted" | "cancelled",
  error: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      pending.thread.scope.workspaceId,
    ]);
    const threadRow = (
      await client.query(
        "SELECT * FROM conversation_threads WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [pending.thread.id, pending.thread.scope.workspaceId],
      )
    ).rows[0];
    if (!threadRow || threadRow.epoch !== pending.epoch) {
      await client.query("ROLLBACK");
      return false;
    }
    const updated = await client.query(
      "UPDATE conversation_turns SET status=$2,error=$3,updated_at=now() WHERE id=$1 AND thread_id=$4 AND status='pending' RETURNING id",
      [pending.turn.id, status, error, pending.thread.id],
    );
    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE conversation_threads SET reserved_bytes=0,revision=revision+1,updated_at=now() WHERE id=$1",
      [pending.thread.id],
    );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function cancelConversationTurn(
  pool: pg.Pool,
  workspaceId: string,
  threadId: string,
  turnId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ]);
    const threadRow = (
      await client.query(
        "SELECT id FROM conversation_threads WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [threadId, workspaceId],
      )
    ).rows[0];
    if (!threadRow) {
      await client.query("ROLLBACK");
      return false;
    }
    const r = await client.query(
      "UPDATE conversation_turns SET status='cancelled',error='사용자가 요청을 취소했습니다.',updated_at=now() WHERE id=$1 AND thread_id=$2 AND status='pending' RETURNING *",
      [turnId, threadId],
    );
    if (r.rows[0])
      await client.query(
        "UPDATE conversation_threads SET reserved_bytes=0,revision=revision+1,updated_at=now() WHERE id=$1",
        [threadId],
      );
    await client.query("COMMIT");
    return !!r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function resetConversationSummary(
  pool: pg.Pool,
  id: string,
  expected: number,
) {
  const r = await pool.query(
    "UPDATE conversation_threads SET summary=NULL,summary_through=NULL,summary_sources='[]',summary_revision=summary_revision+1,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *",
    [id, expected],
  );
  if (!r.rows[0])
    throw Error("대화가 변경되었습니다. 새로고침 후 다시 시도하세요.");
  return thread(r.rows[0]);
}
export async function interruptPendingConversations(
  pool: pg.Pool,
  workspaceId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ]);
    await client.query(
      "UPDATE conversation_turns c SET status='interrupted',error='앱이 종료되어 답변을 중단했습니다.',updated_at=now() FROM conversation_threads t WHERE c.thread_id=t.id AND t.workspace_id=$1 AND c.status='pending'",
      [workspaceId],
    );
    await client.query(
      "UPDATE conversation_threads SET reserved_bytes=0 WHERE workspace_id=$1 AND reserved_bytes>0",
      [workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
