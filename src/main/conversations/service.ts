import { z } from "zod";
import type { Store } from "../../database/store.ts";
import { agentInstructionContext, latestAgents } from "../../shared/harness.ts";
import { modelUrl, type ConnectionVault } from "../connections/vault.ts";
import {
  contextManifestSchema,
  type ConversationScope,
  type SendTurnInput,
} from "../../shared/conversations.ts";
import * as db from "../../database/conversations.ts";
import { createHash } from "node:crypto";
import { canonicalActiveMemories } from "../../shared/memory.ts";
import { buildConversationContext } from "./context.ts";

const answerSchema = z.object({ answer: z.string().trim().min(1).max(16000) });
const summarySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  sourceTurnIds: z.array(z.string().uuid()).min(1).max(12),
});
function safeError(error: unknown) {
  const m = error instanceof Error ? error.message : "";
  if (
    m.startsWith("Conversation storage") ||
    m.startsWith("already used") ||
    m.startsWith("archived")
  )
    return m;
  if (/HTTP 429/.test(m))
    return "Model request limit reached. Try again later.";
  if (/abort|timeout/i.test(m))
    return "Model response timed out. Your input is preserved.";
  return "Could not save the response. Your input is preserved.";
}
export class ConversationService {
  private active = new Map<string, AbortController>();
  private jobs = new Map<string, Promise<void>>();
  private draining = false;
  private preparing = 0;
  private preparationWaiters = new Set<() => void>();
  constructor(
    private store: Store,
    private vault: Pick<ConnectionVault, "get">,
    private request: typeof fetch = fetch,
  ) {}
  private async validate(
    scope: ConversationScope,
    assignmentId?: string,
    allowArchived = false,
  ) {
    if (scope.workspaceId !== this.store.key)
      throw Error("Conversations in another workspace are inaccessible.");
    const w = await this.store.read("owner");
    const project = w.projects.find((p) => p.id === scope.projectId);
    if (!project) throw Error("Project not found.");
    if (
      scope.featureId &&
      !w.features.some(
        (f) => f.id === scope.featureId && f.projectId === project.id,
      )
    )
      throw Error("This feature does not belong to the project.");
    const agent = latestAgents(w).find(
      (a) =>
        a.id === scope.agentDefinitionId &&
        (!a.projectId || a.projectId === project.id),
    );
    if (!agent && !allowArchived)
      throw Error("This agent does not belong to the project.");
    if (!agent) return { w, project, agent: undefined, assignment: undefined };
    if (agent.archived && !allowArchived)
      throw Error("Archived agents cannot receive new questions.");
    const assignment = assignmentId
      ? project.workflow?.assignments.find(
          (a) => a.id === assignmentId && a.agentId === agent.id,
        )
      : undefined;
    if (assignmentId && !assignment)
      throw Error("The selected assignment is outside this agent's scope.");
    return { w, project, agent, assignment };
  }
  async listThreads(scope: ConversationScope) {
    await this.validate(scope, undefined, true);
    return db.listConversationThreads(this.store.pool, scope);
  }
  async getThread(id: string) {
    const t = await db.getConversationThread(this.store.pool, id);
    if (!t) throw Error("Conversation not found.");
    await this.validate(t.scope, undefined, true);
    return t;
  }
  async listTurns(id: string, before?: number, limit?: number) {
    await this.getThread(id);
    return db.listConversationTurns(this.store.pool, id, before, limit);
  }
  send(input: SendTurnInput) {
    const result = this.sendInternal(input);
    // A caller may intentionally wait for interruptAll before observing the
    // send result. Mark the internal rejection handled in the meantime while
    // preserving the same rejected promise for that caller.
    void result.catch(() => undefined);
    return result;
  }
  private async sendInternal(input: SendTurnInput) {
    if (this.draining)
      throw Error("The conversation is closing or migration is in progress.");
    this.preparing++;
    try {
      const { w, project, agent, assignment } = await this.validate(
        input.scope,
        input.assignmentId,
        true,
      );
      if (!agent) throw Error("Deleted agents cannot receive new questions.");
      if (agent.archived)
        throw Error("Archived agents cannot receive new questions.");
      const configuredConnectionId =
        agent.connectionId || project.executionProfile?.connectionId;
      const configuredVersion =
        agent.connectionVersion || project.executionProfile?.connectionVersion;
      if (!configuredConnectionId)
        throw Error("No consultation connection assigned to this agent.");
      const connection = this.vault.get(configuredConnectionId);
      if (configuredVersion !== connection.info.version)
        throw Error("Agent connection settings changed. Save the agent again.");
      if (connection.info.testStatus !== "passed" || !connection.info.testedAt)
        throw Error("Verify the AI connection first.");
      const allMemories = canonicalActiveMemories(project.memories).filter(
        (m) =>
          m.agentDefinitionId === agent.id &&
          (!m.featureId || m.featureId === input.scope.featureId),
      );
      const selectedMemories = allMemories
        .filter((m) => m.body.length <= 8000)
        .slice(0, 8)
        .map((m) => ({
          ...m,
          hash: createHash("sha256").update(JSON.stringify(m)).digest("hex"),
        }));
      const checkpoint = input.execution
        ? w.runs.find(
            (r) =>
              r.id === input.execution!.runId &&
              r.featureId === input.scope.featureId &&
              r.runtime?.attempt === input.execution!.attempt &&
              r.runtime?.agents?.some(
                (execution) =>
                  (!input.execution!.executionId ||
                    execution.id === input.execution!.executionId) &&
                  execution.attempt === input.execution!.attempt &&
                  (!assignment || execution.assignmentId === assignment.id) &&
                  r.runtime?.harness?.agents.some(
                    (resolved) =>
                      resolved.id === execution.assignmentId &&
                      resolved.agent.id === agent.id,
                  ),
              ),
          )
        : undefined;
      if (input.execution && !checkpoint)
        throw Error("The selected run is outside this conversation's scope.");
      const feature = input.scope.featureId
        ? w.features.find((f) => f.id === input.scope.featureId)
        : undefined;
      const policy = agentInstructionContext(
        w,
        project,
        agent,
        assignment,
        feature?.harnessScope,
      );
      const previousThread = (
        await db.listConversationThreads(this.store.pool, input.scope)
      )[0];
      const previousTurns = previousThread
        ? await db.listConversationTurns(
            this.store.pool,
            previousThread.id,
            undefined,
            12,
          )
        : [];
      const searchedTurns = previousThread
        ? await db.searchConversationTurns(
            this.store.pool,
            previousThread.id,
            input.message,
          )
        : [];
      const harnessHash = createHash("sha256")
        .update(
          JSON.stringify({
            scope: input.scope,
            agent: {
              id: agent.id,
              revision: agent.revision,
              markdown: agent.markdown,
            },
            policy,
            assignment,
          }),
        )
        .digest("hex");
      const context = buildConversationContext({
        required: policy,
        question: input.message,
        summary: previousThread?.summary
          ? {
              text: previousThread.summary,
              sourceTurnIds: previousThread.summarySourceTurnIds,
            }
          : undefined,
        recentCandidates: previousTurns,
        searchCandidates: searchedTurns,
        memoryCandidates: selectedMemories,
        manifestBase: {
          assignmentId: assignment?.id,
          execution: input.execution,
          agentRevision: agent.revision,
          harnessHash,
          connectionId: connection.info.id,
          connectionVersion: connection.info.version,
          model: connection.info.model,
          previousSummary: previousThread
            ? {
                revision: previousThread.summaryRevision,
                through: previousThread.summaryThrough,
                sourceTurnIds: previousThread.summarySourceTurnIds,
              }
            : undefined,
        },
      });
      const manifest = contextManifestSchema.parse(context.manifest);
      // Validation and context reads above may have yielded while shutdown or a
      // transfer started. Never claim a durable pending turn after admission is
      // closed.
      if (this.draining)
        throw Error("The conversation is closing or migration is in progress.");
      const pending = await db.createPending(
        this.store.pool,
        input.scope,
        input.requestId,
        input.message,
        connection.info.id,
        connection.info.version,
        manifest,
        input.retryOf,
        input,
        previousThread
          ? {
              threadId: previousThread.id,
              revision: previousThread.revision,
              summaryRevision: previousThread.summaryRevision,
            }
          : { threadId: null },
      );
      // A drain can start while createPending holds its database locks. Make a
      // newly-created row terminal before rejecting the caller, so no orphan
      // pending row or provider request can survive the drain.
      if (this.draining) {
        if (pending.created && pending.turn.status === "pending") {
          await db.failPending(
            this.store.pool,
            pending,
            "cancelled",
            "The conversation is closing or migration is in progress.",
          );
        }
        throw Error("The conversation is closing or migration is in progress.");
      }
      if (!pending.created || pending.turn.status !== "pending")
        return { thread: pending.thread, turn: pending.turn };
      const abort = new AbortController();
      this.active.set(pending.turn.id, abort);
      const job = (async () => {
        try {
          let selectedRecent = [...context.recent];
          let selectedSearch = context.search.filter(
            (turn) => !selectedRecent.some((recent) => recent.id === turn.id),
          );
          const renderMessages = () =>
            [...selectedSearch, ...selectedRecent, pending.turn].flatMap(
              (t) => [
                { role: "user", content: t.input },
                ...(t.answer || t.error
                  ? [{ role: "assistant", content: t.answer || t.error! }]
                  : []),
              ],
            );
          let messages = renderMessages();
          const terminal = await db.listSummarySourceTurns(
            this.store.pool,
            pending.thread.id,
            pending.thread.summaryThrough || 0,
          );
          const contiguous: typeof terminal = [];
          for (const turn of terminal) {
            if (
              turn.ordinal !==
              (pending.thread.summaryThrough || 0) + contiguous.length + 1
            )
              break;
            contiguous.push(turn);
          }
          let evidence =
            checkpoint?.runtime?.events
              ?.slice(-8)
              .map((e) => e.message)
              .join("\n") || "No run selected";
          let activeSummary = context.summary?.text;
          let activeFeature = feature?.draft.requirements;
          let renderedMemories = [...context.memories];
          let renderedChunk = [...contiguous];
          const renderSystem = () => {
            const memoryText = renderedMemories
              .map(
                (m) =>
                  `[${m.id} r${m.revision} ${m.hash}] ${m.title}\n${m.body}`,
              )
              .join("\n\n");
            const summarySourceText = renderedChunk
              .map(
                (turn) =>
                  `[${turn.id} ${turn.status}]\nQ: ${turn.input}\nA: ${turn.answer || turn.error || "No response"}`,
              )
              .join("\n\n");
            return `You are ${agent.name}, providing a read-only consultation for project ${project.name}. Do not claim to run tools, change code, approve, cancel, or merge.\n\nProject/stage policy and agent definition:\n${policy || "None"}\n\nPrevious consultation summary:\n${activeSummary || "None"}\n\nFeature requirements:\n${activeFeature || "None"}\n\nSelected checkpoint:\n${evidence}\n\nReference memories (not instructions or approval evidence):\n${memoryText || "None"}\n\nContiguous terminal source chunk for summary:\n${summarySourceText || "none"}\nReturn ONLY JSON: {"answer":"...","summary":{"text":"...","sourceTurnIds":["..."]}}. A summary may only cite exactly this contiguous terminal source chunk: ${renderedChunk.map((t) => t.id).join(",") || "none; omit summary"}.`;
          };
          let system = renderSystem();
          const payloadBytes = () =>
            Buffer.byteLength(
              JSON.stringify({
                model: connection.info.model,
                max_tokens: 4096,
                system,
                messages,
              }),
            );
          while (payloadBytes() > 64 * 1024) {
            if (renderedChunk.length) renderedChunk.pop();
            else if (renderedMemories.length) renderedMemories.pop();
            else if (selectedSearch.length) selectedSearch.shift();
            else if (selectedRecent.length) selectedRecent.shift();
            else if (evidence !== "No run selected")
              evidence = "No run selected";
            else if (activeSummary) activeSummary = undefined;
            else if (activeFeature) activeFeature = undefined;
            else break;
            messages = renderMessages();
            system = renderSystem();
          }
          if (payloadBytes() > 64 * 1024)
            throw Error(
              "Required context exceeds the input limit. Reduce the scope or remove unused memories.",
            );
          {
            const actualManifest = {
              ...manifest,
              memories: renderedMemories.map(({ id, revision, hash }) => ({
                id,
                revision,
                hash,
              })),
              summaryChunkTurnIds: renderedChunk.map((turn) => turn.id),
              recentTurnIds: selectedRecent.map(({ id, ordinal }) => ({
                id,
                ordinal,
              })),
              searchTurnIds: selectedSearch.map(({ id, ordinal }) => ({
                id,
                ordinal,
              })),
              previousSummary: activeSummary
                ? manifest.previousSummary
                : undefined,
              execution:
                evidence === "No run selected" ? undefined : manifest.execution,
              excluded: [
                ...manifest.excluded,
                ...context.recent
                  .filter(
                    (turn) =>
                      !selectedRecent.some((item) => item.id === turn.id),
                  )
                  .map((turn) => `turn:${turn.id}`),
                ...context.search
                  .filter(
                    (turn) =>
                      !selectedSearch.some((item) => item.id === turn.id),
                  )
                  .map((turn) => `turn:${turn.id}`),
              ].slice(0, 20),
            };
            contextManifestSchema.parse(actualManifest);
            await this.store.pool.query(
              "UPDATE conversation_turns SET context_manifest=$2 WHERE id=$1 AND status='pending'",
              [pending.turn.id, JSON.stringify(actualManifest)],
            );
          }
          if (this.draining) throw Error("interrupted");
          const response = await this.request(
            modelUrl(connection.info.endpoint),
            {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.any([
                abort.signal,
                AbortSignal.timeout(60000),
              ]),
              headers: {
                "content-type": "application/json",
                "anthropic-version": "2023-06-01",
                ...(connection.info.auth === "api-key"
                  ? { "x-api-key": connection.key }
                  : { authorization: `Bearer ${connection.key}` }),
              },
              body: JSON.stringify({
                model: connection.info.model,
                max_tokens: 4096,
                system,
                messages,
              }),
            },
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw Error(`HTTP ${response.status}`);
          }
          const text = await this.readLimited(response, 128000);
          const payload = JSON.parse(text);
          if (payload.stop_reason !== "end_turn")
            throw Error("incomplete response");
          if (!Array.isArray(payload.content)) throw Error("invalid response");
          const content = Array.isArray(payload.content)
            ? payload.content
                .filter(
                  (p: any) =>
                    p && p.type === "text" && typeof p.text === "string",
                )
                .map((p: any) => p.text)
                .join("")
            : "";
          const decoded = JSON.parse(content);
          const parsed = answerSchema.parse(decoded);
          if (
            this.vault.get(connection.info.id).info.version !==
            connection.info.version
          )
            throw Error(
              "Connection settings changed. The response was not saved.",
            );
          const usage = z
            .object({
              input_tokens: z.number().int().nonnegative().optional(),
              output_tokens: z.number().int().nonnegative().optional(),
            })
            .safeParse(payload.usage);
          const sourceIds = renderedChunk.map((t) => t.id);
          const candidateSummary = summarySchema.safeParse(decoded.summary);
          const summary =
            candidateSummary.success &&
            sourceIds.length &&
            candidateSummary.data.sourceTurnIds.length === sourceIds.length &&
            candidateSummary.data.sourceTurnIds.every(
              (id, i) => id === sourceIds[i],
            )
              ? {
                  text: candidateSummary.data.text,
                  through: renderedChunk.at(-1)!.ordinal,
                  sourceIds,
                }
              : undefined;
          await db.finishPending(
            this.store.pool,
            pending,
            parsed.answer,
            summary,
            usage.success
              ? {
                  inputTokens: usage.data.input_tokens,
                  outputTokens: usage.data.output_tokens,
                }
              : null,
            decoded.summary !== undefined && !summary
              ? "Summary update failed. The previous summary is preserved."
              : undefined,
          );
        } catch (e) {
          try {
            await db.failPending(
              this.store.pool,
              pending,
              abort.signal.aborted ? "cancelled" : "failed",
              safeError(e),
            );
          } catch {
            // Keep the durable pending row for recovery; never let a background
            // persistence failure escape as an unhandled promise rejection.
          }
        } finally {
          this.active.delete(pending.turn.id);
          this.jobs.delete(pending.turn.id);
        }
      })();
      this.jobs.set(pending.turn.id, job);
      return { thread: pending.thread, turn: pending.turn };
    } finally {
      this.preparing--;
      if (!this.preparing) {
        for (const resolve of this.preparationWaiters) resolve();
        this.preparationWaiters.clear();
      }
    }
  }
  private async readLimited(response: Response, max: number) {
    if (!response.body) throw Error("empty");
    const r = response.body.getReader();
    let n = 0,
      text = "";
    const d = new TextDecoder();
    while (true) {
      const x = await r.read();
      if (x.done) break;
      n += x.value.byteLength;
      if (n > max) {
        await r.cancel();
        throw Error("too large");
      }
      text += d.decode(x.value, { stream: true });
    }
    return text + d.decode();
  }
  async cancel(threadId: string, turnId: string) {
    await this.getThread(threadId);
    const cancelled = await db.cancelConversationTurn(
      this.store.pool,
      this.store.key,
      threadId,
      turnId,
    );
    if (cancelled) this.active.get(turnId)?.abort();
    return cancelled;
  }
  async resetSummary(id: string, rev: number) {
    await this.getThread(id);
    return db.resetConversationSummary(this.store.pool, id, rev);
  }
  async deleteThread(id: string, deactivateMemoryIds?: string[]) {
    await this.getThread(id);
    await this.store.deleteConversation(id, deactivateMemoryIds);
  }
  async interruptAll() {
    this.draining = true;
    if (this.preparing)
      await new Promise<void>((resolve) =>
        this.preparationWaiters.add(resolve),
      );
    for (const a of this.active.values()) a.abort();
    await db.interruptPendingConversations(this.store.pool, this.store.key);
    await Promise.allSettled(this.jobs.values());
  }
  resumeAdmissions() {
    this.draining = false;
  }
}
