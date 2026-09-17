import pg from "pg";
import { createHash } from "node:crypto";
import { apply, DomainError } from "../domain/index.ts";
import { seed } from "./seed.ts";
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
  ) {
    this.pool = new pg.Pool({ connectionString: url, max: 8 });
  }
  async init() {
    await this.pool
      .query(`CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, state jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS events (sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), type text NOT NULL, actor_id text NOT NULL, feature_id text, at timestamptz NOT NULL DEFAULT now(), revision integer NOT NULL);
      CREATE INDEX IF NOT EXISTS events_workspace ON events(workspace_id, sequence);
      CREATE TABLE IF NOT EXISTS commands (workspace_id text NOT NULL REFERENCES workspaces(id), request_id text NOT NULL, actor_id text NOT NULL, digest text NOT NULL, command jsonb NOT NULL, response jsonb NOT NULL, PRIMARY KEY(workspace_id,request_id));`);
    await this.pool.query(
      "INSERT INTO workspaces(id,state) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [this.key, JSON.stringify(seed())],
    );
  }
  authorize(state: Workspace, actorId: string) {
    if (
      !state.people.some((p) => p.id === actorId && p.teamId === state.teamId)
    )
      throw new DomainError("forbidden", "이 팀에 접근할 수 없습니다.", 403);
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
        state.features.map((f) => [f.id, gate(state, f)]),
      ),
      mode: "development-fixture",
      runnerConnected: false,
    };
  }
  async execute(actorId: string, requestId: string, command: Command) {
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
            "이미 사용된 요청 ID입니다.",
          );
        await client.query("COMMIT");
        return prior.response;
      }
      const result = apply(state, actorId, command);
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
  async close() {
    await this.pool.end();
  }
}
