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
        ? `요약은 ${state.thread.summaryThrough || 0}번 turn까지 반영됨`
        : "아직 자동 요약이 없습니다.",
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

  if (!api) return <p className="muted">대화 서비스를 준비하는 중입니다.</p>;

  return (
    <section className="conversation-panel" aria-label="에이전트 상담">
      <p className="conversation-boundary">
        {agentName}와의 읽기 전용 상담 · 실행 CLI, 승인, 코드 변경과 분리됩니다.
      </p>
      {archived ? (
        <p className="conversation-warning">
          보관된 에이전트의 상담 기록입니다. 기존 기록은 읽을 수 있지만 새
          질문은 보낼 수 없습니다.
        </p>
      ) : !configured ? (
        <p className="conversation-warning">
          이 에이전트의 연결이 설정되지 않았습니다. 런타임 설정에서 연결을
          저장하고 검사하세요.
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
            이전 대화 더 보기 <ChevronUp size={13} />
          </button>
        )}
        {!state.turns.length && !loading && (
          <p className="muted">이 범위에 저장된 대화가 없습니다.</p>
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
            요약·참조 기록 <ChevronDown size={13} />
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
            요약 초기화 <RotateCcw size={13} />
          </button>
          <button className="soft" onClick={() => setDeleteOpen(true)}>
            대화 삭제
          </button>
          {deleteOpen && (
            <div
              className="conversation-delete"
              role="dialog"
              aria-label="대화 삭제 확인"
            >
              <p>
                대화 원문과 요약을 삭제합니다. 외부 제공자에 이미 전달된 사본은
                삭제되지 않습니다.
              </p>
              {!!derivedMemories.length && (
                <fieldset>
                  <legend>이 대화에서 파생된 기억도 사용 중지</legend>
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
                선택한 기억을 중지하면 이 프로젝트의 설계 승인을 다시 확인해야
                합니다. 대기·실행 중인 작업이 있으면 삭제와 중지가 모두
                거절됩니다.
              </p>
              <button className="soft" onClick={() => setDeleteOpen(false)}>
                취소
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
                삭제 확인
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
          <span className="sr-only">상담 메시지</span>
          <textarea
            aria-label="상담 메시지"
            maxLength={8000}
            placeholder="현재 기록을 바탕으로 질문하세요"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!canSend}>
          <Send size={14} /> {loading ? "요청 중" : "질문 보내기"}
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
    pending: "답변 준비 중",
    completed: "답변 완료",
    failed: "실패",
    interrupted: "중단됨",
    cancelled: "취소됨",
  }[turn.status];
  return (
    <article className={`conversation-turn ${turn.status}`}>
      <p className="conversation-input">{turn.input}</p>
      {turn.answer && <p className="conversation-answer">{turn.answer}</p>}
      <small>
        {statusLabel}
        {turn.usage &&
          ` · 입력 ${turn.usage.inputTokens ?? "미보고"} / 출력 ${turn.usage.outputTokens ?? "미보고"} tokens`}
      </small>
      <details>
        <summary>참조한 맥락</summary>
        <p>
          기억 {manifest.memories.length}개 · 최근 대화{" "}
          {manifest.recentTurnIds.length}개 · 이전 검색{" "}
          {manifest.searchTurnIds.length}개
        </p>
        {!!manifest.memories.length && (
          <p>
            기억:{" "}
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
            최근:{" "}
            {manifest.recentTurnIds
              .map((item) => `${item.ordinal}번 (${item.id})`)
              .join(", ")}
          </p>
        )}
        {!!manifest.searchTurnIds.length && (
          <p>
            검색:{" "}
            {manifest.searchTurnIds
              .map((item) => `${item.ordinal}번 (${item.id})`)
              .join(", ")}
          </p>
        )}
        {(manifest.connectionId || manifest.connectionVersion) && (
          <p>
            연결: {manifest.connectionId || "미기록"} · v
            {manifest.connectionVersion || "미기록"} · 에이전트 r
            {manifest.agentRevision}
          </p>
        )}
        {manifest.execution && (
          <p>
            실행: {manifest.execution.runId} · 시도 {manifest.execution.attempt}{" "}
            · {manifest.execution.executionId}
          </p>
        )}
        {!!manifest.excluded.length && (
          <p>제외: {manifest.excluded.join(", ")}</p>
        )}
      </details>
      {turn.error && <p className="conversation-error">{turn.error}</p>}
      {turn.warning && <p className="conversation-warning">{turn.warning}</p>}
      {turn.answer && turn.status === "completed" && (
        <button className="soft" onClick={onSave}>
          기억으로 저장
        </button>
      )}
      {(turn.status === "failed" ||
        turn.status === "interrupted" ||
        turn.status === "cancelled") && (
        <button className="soft" onClick={onRetry}>
          답변 재요청 <RotateCcw size={13} />
        </button>
      )}
      {turn.status === "pending" && (
        <button className="soft" onClick={onCancel}>
          요청 중단 <Square size={12} />
        </button>
      )}
    </article>
  );
}
