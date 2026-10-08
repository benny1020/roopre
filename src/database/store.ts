import pg from "pg";
import { assertHandoffContractsUnchanged } from "../domain/handoff.ts";
import { createHash } from "node:crypto";
import { apply, DomainError, reconcileRunContracts } from "../domain/index.ts";
import { emptyWorkspace } from "./initial.ts";
import { initConversationTables } from "./conversations.ts";
import { canonicalSourceRef } from "../shared/memory.ts";
import { assertMemoryMutationAllowed } from "../domain/memory.ts";
import { approvalBinding } from "../domain/runtime.ts";
import {
  gate,
  type Workspace,
  type Command,
  type Snapshot,
  type Event,
} from "../shared/contracts.ts";

export const databaseUrl =
  process.env.DEVFLOW_DATABASE_URL ||
  "postgres://devflow:devflow-local-only@127.0.0.1:55441/devflow";
export class Store {
  pool: pg.Pool;
  constructor(
    public key = "team-local",
    url = databaseUrl,
    public mode: "development-fixture" | "local-owner" = "development-fixture",
    private initialize: typeof emptyWorkspace = emptyWorkspace,
  ) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
    });
    // pg emits background errors when Docker/DB restarts. An unhandled event
    // would terminate the app; failed foreground operations still reject.
    this.pool.on("error", () => {
      console.error(
        "PostgreSQL disconnected. The next request will reconnect.",
      );
    });
  }
  async init() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext(coalesce(current_schema(), 'public') || ':roopre-schema'))",
      );
      await client.query(
        "CREATE TABLE IF NOT EXISTS roopre_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const migrated = await client.query(
        "SELECT 1 FROM roopre_schema_migrations WHERE version=1",
      );
      if (!migrated.rows[0]) {
        await client.query(`CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, state jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS events (sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), type text NOT NULL, actor_id text NOT NULL, feature_id text, at timestamptz NOT NULL DEFAULT now(), revision integer NOT NULL);
      CREATE INDEX IF NOT EXISTS events_workspace ON events(workspace_id, sequence);
      CREATE TABLE IF NOT EXISTS commands (workspace_id text NOT NULL REFERENCES workspaces(id), request_id text NOT NULL, actor_id text NOT NULL, digest text NOT NULL, command jsonb NOT NULL, response jsonb NOT NULL, PRIMARY KEY(workspace_id,request_id));`);
        await initConversationTables(client);
        await client.query(
          "INSERT INTO roopre_schema_migrations(version) VALUES(1)",
        );
      }
      const initial = this.initialize(this.key, this.mode);
      await client.query(
        "INSERT INTO workspaces(id,state) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [this.key, JSON.stringify(initial)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  authorize(state: Workspace, actorId: string) {
    if (
      !state.people.some((p) => p.id === actorId && p.teamId === state.teamId)
    )
      throw new DomainError(
        "forbidden",
        "You do not have access to this workspace.",
        403,
      );
  }
  async read(actorId: string): Promise<Snapshot> {
    // Read state and sequence in the same statement snapshot to avoid missing an event during subscription.
    const row = (
      await this.pool.query(
        "SELECT state, (SELECT COALESCE(MAX(sequence),0) FROM events WHERE workspace_id=$1) AS sequence FROM workspaces WHERE id=$1",
        [this.key],
      )
    ).rows[0];
    const state = row.state as Workspace;
    this.authorize(state, actorId);
    return {
      ...state,
      sequence: Number(row.sequence),
      gates: Object.fromEntries(
        state.features.map((f) => [
          f.id,
          gate(
            state,
            f,
            f.designs.length ? approvalBinding(state, f) : undefined,
          ),
        ]),
      ),
      approvalBindings: Object.fromEntries(
        state.features
          .filter((f) => f.designs.length > 0)
          .map((f) => [f.id, approvalBinding(state, f)]),
      ),
      mode: this.mode,
      runnerConnected: this.mode === "local-owner",
    };
  }
  async execute(
    actorId: string,
    requestId: string,
    command: Command,
    proof?: {
      binding: string;
      authentication: "app-confirmation" | "macos-owner";
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const state = (
        await client.query(
          "SELECT state FROM workspaces WHERE id=$1 FOR UPDATE",
          [this.key],
        )
      ).rows[0].state as Workspace;
      this.authorize(state, actorId);
      const digest = createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex");
      const prior = (
        await client.query(
          "SELECT * FROM commands WHERE workspace_id=$1 AND request_id=$2",
          [this.key, requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.actor_id !== actorId || prior.digest !== digest)
          throw new DomainError(
            "idempotency_conflict",
            "This request ID has already been used.",
          );
        await client.query("COMMIT");
        return prior.response;
      }
      if (command.type === "save_memory")
        await this.validateMemorySources(client, state, command);
      const before = structuredClone(state);
      const result = apply(state, actorId, command, proof);
      assertHandoffContractsUnchanged(before, state);
      await client.query("UPDATE workspaces SET state=$2 WHERE id=$1", [
        this.key,
        JSON.stringify(state),
      ]);
      const event = (
        await client.query(
          "INSERT INTO events(workspace_id,type,actor_id,feature_id,revision) VALUES($1,$2,$3,$4,$5) RETURNING sequence,at",
          [
            this.key,
            command.type,
            actorId,
            result.featureId || null,
            state.revision,
          ],
        )
      ).rows[0];
      const response = {
        ...result,
        revision: state.revision,
        sequence: Number(event.sequence),
      };
      await client.query(
        "INSERT INTO commands(workspace_id,request_id,actor_id,digest,command,response) VALUES($1,$2,$3,$4,$5,$6)",
        [
          this.key,
          requestId,
          actorId,
          digest,
          JSON.stringify(command),
          JSON.stringify(response),
        ],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async validateMemorySources(
    client: pg.PoolClient,
    state: Workspace,
    command: Extract<Command, { type: "save_memory" }>,
  ) {
    const project = state.projects.find((p) => p.id === command.projectId);
    if (!project) throw new DomainError("not_found", "Project not found.", 404);
    const existing = (project.memories ?? []).find(
      (memory) => memory.id === command.memory.id,
    );
    // An existing memory's scope and source refs are immutable in the domain.
    // Its source may have been deleted after the user chose to retain it.
    if (
      existing &&
      existing.agentDefinitionId === command.memory.agentDefinitionId &&
      existing.featureId === command.memory.featureId &&
      existing.sourceRefs.map(canonicalSourceRef).sort().join("\n") ===
        command.memory.sourceRefs.map(canonicalSourceRef).sort().join("\n")
    )
      return;
    for (const ref of command.memory.sourceRefs) {
      if (ref.type === "manual") continue;
      if (ref.type === "conversation") {
        const featureKey = command.memory.featureId || "__project__";
        const row = (
          await client.query(
            `SELECT t.id FROM conversation_threads t JOIN conversation_turns c ON c.thread_id=t.id
           WHERE t.id=$1 AND c.id=$2 AND t.workspace_id=$3 AND t.project_id=$4 AND t.agent_definition_id=$5 AND t.feature_key=$6`,
            [
              ref.threadId,
              ref.turnId,
              this.key,
              project.id,
              command.memory.agentDefinitionId,
              featureKey,
            ],
          )
        ).rows[0];
        if (!row && !command.memory.featureId && command.promoteToProject) {
          const promoted = (
            await client.query(
              `SELECT t.id FROM conversation_threads t JOIN conversation_turns c ON c.thread_id=t.id
             WHERE t.id=$1 AND c.id=$2 AND t.workspace_id=$3 AND t.project_id=$4 AND t.agent_definition_id=$5 AND t.feature_key<>$6`,
              [
                ref.threadId,
                ref.turnId,
                this.key,
                project.id,
                command.memory.agentDefinitionId,
                "__project__",
              ],
            )
          ).rows[0];
          if (promoted) continue;
        }
        if (!row)
          throw new DomainError(
            "forbidden",
            "Conversation source does not match the memory scope.",
            403,
          );
        continue;
      }
      const run = state.runs.find((r) => r.id === ref.runId);
      const feature = run && state.features.find((f) => f.id === run.featureId);
      const executions = run?.runtime?.agents ?? [];
      const matching = ref.executionId
        ? executions.filter((a) => a.id === ref.executionId)
        : executions;
      const hasAgent = matching.some((a) => {
        const frozen = run!.runtime?.harness?.agents.find(
          (h) => h.id === a.assignmentId,
        );
        return frozen?.agent.id === command.memory.agentDefinitionId;
      });
      if (
        !run ||
        !feature ||
        feature.projectId !== project.id ||
        (command.memory.featureId && feature.id !== command.memory.featureId) ||
        (!command.memory.featureId && !command.promoteToProject) ||
        !hasAgent
      )
        throw new DomainError(
          "forbidden",
          "Run source does not match the memory scope.",
          403,
        );
    }
  }
  async events(actorId: string, after: number): Promise<Event[]> {
    const state = (
      await this.pool.query("SELECT state FROM workspaces WHERE id=$1", [
        this.key,
      ])
    ).rows[0].state as Workspace;
    this.authorize(state, actorId);
    return (
      await this.pool.query(
        "SELECT * FROM events WHERE workspace_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 200",
        [this.key, after],
      )
    ).rows.map((r) => ({
      sequence: Number(r.sequence),
      type: r.type,
      actorId: r.actor_id,
      featureId: r.feature_id || undefined,
      at: r.at.toISOString(),
      revision: r.revision,
    }));
  }
  async mutate(fn: (state: Workspace) => void) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const state = (
        await client.query(
          "SELECT state FROM workspaces WHERE id=$1 FOR UPDATE",
          [this.key],
        )
      ).rows[0].state as Workspace;
      const before = structuredClone(state);
      fn(state);
      assertHandoffContractsUnchanged(before, state);
      state.revision++;
      await client.query("UPDATE workspaces SET state=$2 WHERE id=$1", [
        this.key,
        JSON.stringify(state),
      ]);
      await client.query(
        "INSERT INTO events(workspace_id,type,actor_id,revision) VALUES($1,'runtime','runner',$2)",
        [this.key, state.revision],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async deleteConversation(
    threadId: string,
    deactivateMemoryIds: string[] = [],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const state = (
        await client.query(
          "SELECT state FROM workspaces WHERE id=$1 FOR UPDATE",
          [this.key],
        )
      ).rows[0].state as Workspace;
      const thread = (
        await client.query(
          "SELECT * FROM conversation_threads WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [threadId, this.key],
        )
      ).rows[0];
      if (!thread) throw Error("Conversation not found.");
      assertMemoryMutationAllowed(state, thread.project_id);
      const project = state.projects.find((p) => p.id === thread.project_id)!;
      const eligible = (project.memories ?? []).filter(
        (m) =>
          deactivateMemoryIds.includes(m.id) &&
          m.sourceRefs.some(
            (r: any) => r.type === "conversation" && r.threadId === threadId,
          ),
      );
      if (eligible.length !== deactivateMemoryIds.length)
        throw Error("Check the scope of derived memories to deactivate.");
      const pending = Number(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM conversation_turns WHERE thread_id=$1 AND status='pending'",
            [threadId],
          )
        ).rows[0].n,
      );
      if (pending)
        throw Error("Stop the active consultation before deleting it.");
      const digests = (
        await client.query(
          "SELECT request_id,input_digest FROM conversation_turns WHERE thread_id=$1",
          [threadId],
        )
      ).rows.map((r) => ({ requestId: r.request_id, digest: r.input_digest }));
      for (const memory of eligible) {
        memory.active = false;
        memory.revision++;
        memory.updatedAt = new Date().toISOString();
      }
      if (eligible.length)
        for (const feature of state.features.filter(
          (feature) => feature.projectId === project.id,
        )) {
          const latest = feature.designs.at(-1);
          if (latest) latest.decisions = [];
        }
      if (eligible.length) reconcileRunContracts(state);
      await client.query(
        "INSERT INTO conversation_tombstones(thread_id,workspace_id,project_id,agent_definition_id,feature_key,epoch,request_digests) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(thread_id) DO UPDATE SET epoch=EXCLUDED.epoch,request_digests=EXCLUDED.request_digests,deleted_at=now()",
        [
          threadId,
          this.key,
          thread.project_id,
          thread.agent_definition_id,
          thread.feature_key,
          thread.epoch + 1,
          JSON.stringify(digests),
        ],
      );
      await client.query("DELETE FROM conversation_threads WHERE id=$1", [
        threadId,
      ]);
      state.revision++;
      await client.query("UPDATE workspaces SET state=$2 WHERE id=$1", [
        this.key,
        JSON.stringify(state),
      ]);
      await client.query(
        "INSERT INTO events(workspace_id,type,actor_id,revision) VALUES($1,'conversation_delete','owner',$2)",
        [this.key, state.revision],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
