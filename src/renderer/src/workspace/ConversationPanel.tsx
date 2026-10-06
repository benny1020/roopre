import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw, Send, Square } from "lucide-react";
import type {
  ConversationScope,
  ConversationThread,
  ConversationTurn,
} from "../../../shared/conversations";
import type { WorkMemory } from "../../../shared/memory";

type ScopeState = {
  thread?: ConversationThread;
  turns: ConversationTurn[];
  olderAvailable: boolean;
};

const keyFor = (scope: ConversationScope) =>
  JSON.stringify([
    scope.workspaceId,
    scope.projectId,
    scope.agentDefinitionId,
    scope.featureId ?? null,
  ]);
const storageKey = (prefix: string, scope: ConversationScope) =>
  `roopre:conversation:${prefix}:${keyFor(scope)}`;
const newRequestId = () => crypto.randomUUID();

export default function ConversationPanel({
  scope,
  agentName,
  assignmentId,
  execution,
  configured,
  archived,
  onSaveTurn,
  memories,
}: {
  scope: ConversationScope;
  agentName: string;
  assignmentId?: string;
  execution?: { runId: string; attempt: number; executionId?: string };
  configured: boolean;
  archived: boolean;
  onSaveTurn: (turn: ConversationTurn) => void;
  memories: WorkMemory[];
}) {
  const api = window.roopre?.conversations;
  const key = keyFor(scope);
  const [state, setState] = useState<ScopeState>({
    turns: [],
    olderAvailable: false,
  });
  const [draft, setDraft] = useState(
    () => localStorage.getItem(storageKey("draft", scope)) || "",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deactivateMemoryIds, setDeactivateMemoryIds] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const pollRevision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setState({ turns: [], olderAvailable: false });
    setError("");
    setDraft(localStorage.getItem(storageKey("draft", scope)) || "");
    const restore = async () => {
      if (!api) return;
      try {
        const threads = await api.listThreads(scope);
        if (!active) return;
        const thread = threads[0];
        if (!thread) return;
        const turns = await api.listTurns({ threadId: thread.id, limit: 30 });
        if (!active) return;
        setState({
          thread,
          turns,
          olderAvailable: turns.length === 30,
        });
        requestAnimationFrame(() => {
          if (list.current)
            list.current.scrollTop = Number(
              localStorage.getItem(storageKey("scroll", scope)) || 0,
            );
        });
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [api, key]);

  useEffect(() => {
    localStorage.setItem(storageKey("draft", scope), draft);
  }, [draft, key]);
  const pending = state.turns.find((turn) => turn.status === "pending");
  const canSend = !!api && configured && !!draft.trim() && !pending && !loading;
  useEffect(() => {
    if (!api || !state.thread || !pending) return;
    let active = true;
    const poll = async () => {
      const revision = ++pollRevision.current;
      try {
        const [thread, turns] = await Promise.all([
          api.getThread(state.thread!.id),
          api.listTurns({ threadId: state.thread!.id, limit: 30 }),
        ]);
        if (!active || !mounted.current || revision !== pollRevision.current)
          return;
        setState((current) => {
          const byId = new Map(current.turns.map((turn) => [turn.id, turn]));
          for (const turn of turns) byId.set(turn.id, turn);
          return {
            thread,
            turns: [...byId.values()].sort((a, b) => a.ordinal - b.ordinal),
            olderAvailable: current.olderAvailable || turns.length === 30,
          };
        });
      } catch (cause) {
        if (active && mounted.current) setError((cause as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 750);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, state.thread?.id, pending?.id]);
  const description = useMemo(
    () =>
      state.thread?.summary
        ? `Summary covers ${state.thread.summaryThrough || 0} turns`
        : "No automatic summary yet.",
    [state.thread],
  );
  const derivedMemories = state.thread
    ? memories.filter((memory) =>
        memory.sourceRefs.some(
          (source) =>
            source.type === "conversation" &&
            source.threadId === state.thread!.id,
        ),
      )
    : [];

  const append = async (retryOf?: string, message = draft) => {
    if (!api || !configured || !message.trim() || pending || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.sendTurn({
        scope,
        requestId: newRequestId(),
        message,
        assignmentId,
        execution,
        retryOf,
      });
      if (!mounted.current) return;
      setState((current) => ({
        thread: result.thread,
        turns: [
          ...current.turns.filter((turn) => turn.id !== result.turn.id),
          result.turn,
        ],
        olderAvailable: current.olderAvailable,
      }));
      setDraft("");
      requestAnimationFrame(() => {
        if (list.current) list.current.scrollTop = list.current.scrollHeight;
      });
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const loadOlder = async () => {
    if (!api || !state.thread || !state.turns.length) return;
    const first = state.turns[0];
    try {
      const older = await api.listTurns({
        threadId: state.thread.id,
        beforeOrdinal: first.ordinal,
        limit: 30,
      });
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        turns: [...older, ...current.turns],
        olderAvailable: older.length === 30,
      }));
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    }
  };

  if (!api) return <p className="muted">Preparing conversation service.</p>;

  return (
    <section className="conversation-panel" aria-label="Consult agent">
      <p className="conversation-boundary">
        {agentName} · Read-only consultation, separate from execution, approvals
        and code changes.
      </p>
      {archived ? (
        <p className="conversation-warning">
          This agent is archived. You can read its history but cannot send new
          questions.
        </p>
      ) : !configured ? (
        <p className="conversation-warning">
          This agent has no connection. Save and test one in runtime settings.
        </p>
      ) : null}
      <div
        className="conversation-turns"
        ref={list}
        onScroll={(event) =>
          localStorage.setItem(
            storageKey("scroll", scope),
            String(event.currentTarget.scrollTop),
          )
        }
      >
        {state.olderAvailable && (
          <button
            className="soft conversation-history"
            onClick={() => void loadOlder()}
          >
            Load earlier messages <ChevronUp size={13} />
          </button>
        )}
        {!state.turns.length && !loading && (
          <p className="muted">No saved conversation in this scope.</p>
        )}
        {state.turns.map((turn) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            onRetry={() => void append(turn.id, turn.input)}
            onCancel={() =>
              state.thread &&
              void api
                .cancelTurn({ threadId: state.thread.id, turnId: turn.id })
                .catch(
                  (cause) =>
                    mounted.current && setError((cause as Error).message),
                )
            }
            onSave={() => onSaveTurn(turn)}
          />
        ))}
      </div>
      {state.thread && (
        <details className="conversation-provenance">
          <summary>
            Summary & references <ChevronDown size={13} />
          </summary>
          <p>{description}</p>
          {state.thread.summary && <p>{state.thread.summary}</p>}
          <button
            className="soft"
            onClick={() =>
              void api
                .resetSummary({
                  threadId: state.thread!.id,
                  expectedRevision: state.thread!.revision,
                })
                .then(
                  (thread) =>
                    mounted.current &&
                    setState((current) => ({ ...current, thread })),
                )
                .catch(
                  (cause) =>
                    mounted.current && setError((cause as Error).message),
                )
            }
          >
            Reset summary <RotateCcw size={13} />
          </button>
          <button className="soft" onClick={() => setDeleteOpen(true)}>
            Delete conversation
          </button>
          {deleteOpen && (
            <div
              className="conversation-delete"
              role="dialog"
              aria-label="Delete this conversation?"
            >
              <p>
                Deletes local messages and summaries. Copies already sent to the
                provider are unaffected.
              </p>
              {!!derivedMemories.length && (
                <fieldset>
                  <legend>
                    Also deactivate memories derived from this conversation
                  </legend>
                  {derivedMemories.map((memory) => (
                    <label key={memory.id}>
                      <input
                        type="checkbox"
                        checked={deactivateMemoryIds.includes(memory.id)}
                        onChange={(event) =>
                          setDeactivateMemoryIds((ids) =>
                            event.target.checked
                              ? [...ids, memory.id]
                              : ids.filter((id) => id !== memory.id),
                          )
                        }
                      />{" "}
                      {memory.title} r{memory.revision}
                    </label>
                  ))}
                </fieldset>
              )}
              <p className="conversation-warning">
                Deactivating selected memories requires project designs to be
                reviewed again. Deletion and deactivation are blocked during
                queued or active runs.
              </p>
              <button className="soft" onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button
                onClick={() =>
                  void api
                    .deleteThread({
                      threadId: state.thread!.id,
                      ...(deactivateMemoryIds.length
                        ? { deactivateDerivedMemoryIds: deactivateMemoryIds }
                        : {}),
                    })
                    .then(() => {
                      setState({ turns: [], olderAvailable: false });
                      setDeleteOpen(false);
                    })
                    .catch(
                      (cause) =>
                        mounted.current && setError((cause as Error).message),
                    )
                }
              >
                Confirm deletion
              </button>
            </div>
          )}
        </details>
      )}
      {error && (
        <p className="conversation-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="conversation-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void append();
        }}
      >
        <label>
          <span className="sr-only">Consultation message</span>
          <textarea
            aria-label="Consultation message"
            maxLength={8000}
            placeholder="Ask about the current work"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!canSend}>
          <Send size={14} /> {loading ? "Sending" : "Send question"}
        </button>
      </form>
    </section>
  );
}

function TurnCard({
  turn,
  onRetry,
  onCancel,
  onSave,
}: {
  turn: ConversationTurn;
  onRetry: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const manifest = turn.contextManifest;
  const statusLabel = {
    pending: "Generating response",
    completed: "Response complete",
    failed: "Failed",
    interrupted: "Interrupted",
    cancelled: "Cancelled",
  }[turn.status];
  return (
    <article className={`conversation-turn ${turn.status}`}>
      <p className="conversation-input">{turn.input}</p>
      {turn.answer && <p className="conversation-answer">{turn.answer}</p>}
      <small>
        {statusLabel}
        {turn.usage &&
          ` · Input ${turn.usage.inputTokens ?? "Not reported"} / Output ${turn.usage.outputTokens ?? "Not reported"} tokens`}
      </small>
      <details>
        <summary>Referenced context</summary>
        <p>
          Memory {manifest.memories.length} · Recent messages{" "}
          {manifest.recentTurnIds.length} · Retrieved history{" "}
          {manifest.searchTurnIds.length}
        </p>
        {!!manifest.memories.length && (
          <p>
            Memory:{" "}
            {manifest.memories
              .map(
                (memory) =>
                  `${memory.id} r${memory.revision} ${memory.hash.slice(0, 12)}`,
              )
              .join(", ")}
          </p>
        )}
        {!!manifest.recentTurnIds.length && (
          <p>
            Recent:{" "}
            {manifest.recentTurnIds
              .map((item) => `${item.ordinal}(${item.id})`)
              .join(", ")}
          </p>
        )}
        {!!manifest.searchTurnIds.length && (
          <p>
            Retrieved:{" "}
            {manifest.searchTurnIds
              .map((item) => `${item.ordinal}(${item.id})`)
              .join(", ")}
          </p>
        )}
        {(manifest.connectionId || manifest.connectionVersion) && (
          <p>
            Connection: {manifest.connectionId || "Not recorded"} · v
            {manifest.connectionVersion || "Not recorded"} · Agent r
            {manifest.agentRevision}
          </p>
        )}
        {manifest.execution && (
          <p>
            Run: {manifest.execution.runId} · Attempt{" "}
            {manifest.execution.attempt} · {manifest.execution.executionId}
          </p>
        )}
        {!!manifest.excluded.length && (
          <p>Excluded: {manifest.excluded.join(", ")}</p>
        )}
      </details>
      {turn.error && <p className="conversation-error">{turn.error}</p>}
      {turn.warning && <p className="conversation-warning">{turn.warning}</p>}
      {turn.answer && turn.status === "completed" && (
        <button className="soft" onClick={onSave}>
          Save as memory
        </button>
      )}
      {(turn.status === "failed" ||
        turn.status === "interrupted" ||
        turn.status === "cancelled") && (
        <button className="soft" onClick={onRetry}>
          Regenerate response <RotateCcw size={13} />
        </button>
      )}
      {turn.status === "pending" && (
        <button className="soft" onClick={onCancel}>
          Stop response <Square size={12} />
        </button>
      )}
    </article>
  );
}
