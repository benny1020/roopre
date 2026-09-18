import { useEffect, useState } from "react";
import type { Command, Snapshot } from "../../shared/contracts";
import {
  latestAgents,
  resolveHarness,
  stageNames,
  stages,
  type AgentDefinition,
  type Workflow,
  importAgentMarkdown,
} from "../../shared/harness";
import type { ConnectionInfo } from "../../shared/runtime";
import MarkdownPreview from "./MarkdownPreview";
const instructions = {
  requirements: "",
  design: "",
  implementation: "",
  verification: "",
  review: "",
};
export default function HarnessPanel({
  snapshot,
  send,
  onSaved,
}: {
  snapshot: Snapshot;
  send: (c: Command) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}) {
  const [projectId, setProjectId] = useState(snapshot.projects[0]?.id ?? "");
  const project = snapshot.projects.find((p) => p.id === projectId);
  const [editing, setEditing] = useState<AgentDefinition>();
  const [flow, setFlow] = useState<Workflow>(
    project?.workflow ?? {
      revision: 1,
      assignments: [],
      instructions: { ...instructions },
    },
  );
  const [flowBase, setFlowBase] = useState(project?.workflow?.revision ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [preview, setPreview] = useState(false);
  const [composed, setComposed] = useState("");
  const agents = latestAgents(snapshot);
  const available = agents.filter(
    (a) => !a.archived && (!a.projectId || a.projectId === projectId),
  );
  useEffect(() => {
    void window.roopre
      ?.connections()
      .then(setConnections)
      .catch((e) => setError(e.message));
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectProject = (id: string) => {
    const p = snapshot.projects.find((p) => p.id === id);
    setProjectId(id);
    setFlow(
      p?.workflow ?? {
        revision: 1,
        assignments: [],
        instructions: { ...instructions },
      },
    );
    setFlowBase(p?.workflow?.revision ?? 0);
    setComposed("");
  };
  const fresh = (): AgentDefinition => ({
    id: crypto.randomUUID(),
    revision: 1,
    name: "",
    description: "",
    capability: "read-only",
    markdown: "# 역할\n\n# 검토 기준\n",
    archived: false,
  });
  return (
    <div className="content-page harness-panel">
      <div className="page-heading">
        <div>
          <h1>에이전트 · 개발 흐름</h1>
          <p>역할을 Markdown으로 정의하고 프로젝트의 각 단계에 배치하세요.</p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setEditing(fresh());
            setPreview(false);
          }}
        >
          에이전트 만들기
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="agent-library">
        {agents.map((a) => (
          <article className="runtime-card" key={a.id}>
            <div className="button-row">
              <h3>{a.name}</h3>
              <small>
                v{a.revision} ·{" "}
                {a.projectId
                  ? snapshot.projects.find((p) => p.id === a.projectId)?.name
                  : "전역"}{" "}
                ·{" "}
                {a.archived
                  ? "보관됨"
                  : a.capability === "implementation"
                    ? "코드 수정"
                    : "읽기 전용"}
              </small>
            </div>
            <p>{a.description}</p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => {
                  setEditing({ ...a });
                  setPreview(false);
                }}
              >
                편집
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing({
                    ...a,
                    id: crypto.randomUUID(),
                    revision: 1,
                    name: `${a.name} 복사`,
                    archived: false,
                  });
                  setPreview(false);
                }}
              >
                복제
              </button>
              {window.roopre?.exportAgent && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await window.roopre!.exportAgent(a.id);
                    })
                  }
                >
                  Markdown 내보내기
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!agents.length && (
        <p className="muted">
          아직 에이전트가 없습니다. 직접 만들거나 프로젝트에 기본 흐름을
          적용하세요.
        </p>
      )}
      {editing && (
        <section
          className="runtime-card agent-editor"
          aria-label="에이전트 편집"
        >
          <h2>{editing.name || "새 에이전트"}</h2>
          <div className="runtime-grid">
            <label className="field">
              에이전트 이름
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label className="field">
              공유 범위
              <select
                value={editing.projectId ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    projectId: e.target.value || undefined,
                  })
                }
              >
                <option value="">전역</option>
                {snapshot.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              권한
              <select
                value={editing.capability}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    capability: e.target.value as AgentDefinition["capability"],
                  })
                }
              >
                <option value="read-only">읽기 전용 · 설계/검증/리뷰</option>
                <option value="implementation">코드 수정 · 구현</option>
              </select>
            </label>
            <label className="field">
              모델 연결
              <select
                value={editing.connectionId ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    connectionId: e.target.value || undefined,
                    connectionVersion: connections.find(
                      (c) => c.id === e.target.value,
                    )?.version,
                  })
                }
              >
                <option value="">프로젝트 연결 상속</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.model}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            설명
            <input
              value={editing.description}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </label>
          <div className="button-row">
            <button onClick={() => setPreview(!preview)}>
              {preview ? "원문 편집" : "미리보기"}
            </button>
            {window.roopre?.readMarkdown && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const file = await window.roopre!.readMarkdown();
                    if (file) {
                      const parsed = importAgentMarkdown(file);
                      setEditing({ ...editing, ...parsed });
                    }
                  })
                }
              >
                Markdown 가져오기
              </button>
            )}
          </div>
          {preview ? (
            <MarkdownPreview text={editing.markdown} />
          ) : (
            <label className="field">
              Markdown 지침
              <textarea
                aria-label="Markdown 지침"
                className="instruction-editor"
                value={editing.markdown}
                onChange={(e) =>
                  setEditing({ ...editing, markdown: e.target.value })
                }
              />
            </label>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={editing.archived}
              onChange={(e) =>
                setEditing({ ...editing, archived: e.target.checked })
              }
            />
            보관 처리 · 과거 실행 기록은 유지
          </label>
          <p className="muted">
            사용 중인 정의를 변경하면 관련 설계의 승인이 해제되고 실행이
            중단됩니다.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={
                busy || !editing.name.trim() || !editing.markdown.trim()
              }
              onClick={() =>
                void act(async () => {
                  const isNew = !agents.some((a) => a.id === editing.id);
                  const revision = isNew ? 0 : editing.revision;
                  await send({
                    type: "save_agent",
                    expectedRevision: revision,
                    agent: { ...editing, revision: revision + 1 },
                  });
                  setEditing(undefined);
                  setNotice("에이전트 버전을 저장했습니다.");
                })
              }
            >
              에이전트 저장
            </button>
            <button onClick={() => setEditing(undefined)}>편집 닫기</button>
          </div>
        </section>
      )}
      <section className="runtime-card">
        <h2>프로젝트 개발 흐름</h2>
        <label className="field">
          개발 흐름 프로젝트
          <select
            value={projectId}
            onChange={(e) => selectProject(e.target.value)}
            disabled={!snapshot.projects.length}
          >
            {snapshot.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!project && (
          <p>
            프로젝트를 먼저 만드세요. 전역 에이전트는 지금 작성할 수 있습니다.
          </p>
        )}
        {project && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const definitions = stages.map((stage) => ({
                    ...fresh(),
                    name: `${stageNames[stage]} 에이전트`,
                    projectId,
                    capability:
                      stage === "implementation"
                        ? ("implementation" as const)
                        : ("read-only" as const),
                    description: `${stageNames[stage]} 단계의 기본 역할`,
                    markdown:
                      stage === "implementation"
                        ? "승인된 설계 범위에서 구현한다. 필수 검사와 승인 규칙을 변경하지 않는다."
                        : "요구사항·설계·지침과 실제 저장소 근거를 대조한다. 확인하지 못한 항목은 통과로 보고하지 않는다.",
                  }));
                  for (const agent of definitions)
                    await send({
                      type: "save_agent",
                      expectedRevision: 0,
                      agent,
                    });
                  const next: Workflow = {
                    revision: flowBase + 1,
                    instructions: { ...instructions },
                    assignments: definitions.map((a, i) => ({
                      id: crypto.randomUUID(),
                      agentId: a.id,
                      stage: stages[i],
                      required: true,
                    })),
                  };
                  await send({
                    type: "save_workflow",
                    projectId,
                    expectedRevision: flowBase,
                    workflow: next,
                  });
                  setFlow(next);
                  setFlowBase(next.revision);
                  setNotice("기본 흐름을 적용했습니다.");
                })
              }
            >
              기본 흐름 적용
            </button>
            {stages.map((stage) => (
              <div className="workflow-stage" key={stage}>
                <h3>{stageNames[stage]}</h3>
                <label className="field">
                  {stageNames[stage]} 단계 지침
                  <textarea
                    aria-label={`${stageNames[stage]} 단계 지침`}
                    value={flow.instructions[stage]}
                    onChange={(e) =>
                      setFlow({
                        ...flow,
                        instructions: {
                          ...flow.instructions,
                          [stage]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                {flow.assignments
                  .filter((a) => a.stage === stage)
                  .map((a) => (
                    <div className="assignment-row" key={a.id}>
                      <select
                        aria-label={`${stageNames[stage]} 에이전트`}
                        value={a.agentId}
                        onChange={(e) =>
                          setFlow({
                            ...flow,
                            assignments: flow.assignments.map((x) =>
                              x.id === a.id
                                ? { ...x, agentId: e.target.value }
                                : x,
                            ),
                          })
                        }
                      >
                        {!available.some((d) => d.id === a.agentId) && (
                          <option value={a.agentId}>사용할 수 없는 정의</option>
                        )}
                        {available
                          .filter(
                            (d) =>
                              (stage === "implementation") ===
                              (d.capability === "implementation"),
                          )
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} · v{d.revision}
                            </option>
                          ))}
                      </select>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={a.required}
                          onChange={(e) =>
                            setFlow({
                              ...flow,
                              assignments: flow.assignments.map((x) =>
                                x.id === a.id
                                  ? { ...x, required: e.target.checked }
                                  : x,
                              ),
                            })
                          }
                        />
                        필수
                      </label>
                      <button
                        aria-label={`${stageNames[stage]} 순서 올리기`}
                        onClick={() => {
                          const list = [...flow.assignments];
                          const index = list.findIndex((x) => x.id === a.id);
                          let previous = index - 1;
                          while (
                            previous >= 0 &&
                            list[previous].stage !== stage
                          )
                            previous--;
                          if (previous >= 0) {
                            [list[index], list[previous]] = [
                              list[previous],
                              list[index],
                            ];
                            setFlow({ ...flow, assignments: list });
                          }
                        }}
                      >
                        ↑
                      </button>
                      <button
                        onClick={() =>
                          setFlow({
                            ...flow,
                            assignments: flow.assignments.filter(
                              (x) => x.id !== a.id,
                            ),
                          })
                        }
                      >
                        제거
                      </button>
                    </div>
                  ))}
                <button
                  disabled={
                    !available.some(
                      (d) =>
                        (stage === "implementation") ===
                        (d.capability === "implementation"),
                    )
                  }
                  onClick={() => {
                    const d = available.find(
                      (d) =>
                        (stage === "implementation") ===
                        (d.capability === "implementation"),
                    )!;
                    setFlow({
                      ...flow,
                      assignments: [
                        ...flow.assignments,
                        {
                          id: crypto.randomUUID(),
                          agentId: d.id,
                          stage,
                          required: true,
                        },
                      ],
                    });
                  }}
                >
                  {stageNames[stage]} 에이전트 추가
                </button>
              </div>
            ))}
            <p className="muted">
              단계 안에서는 순서대로 실행합니다. 필수 구현자·리뷰어와 프로그램의
              고정 검사는 유지됩니다. 저장 후 설계를 재승인하세요.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const next = { ...flow, revision: flowBase + 1 };
                    await send({
                      type: "save_workflow",
                      projectId,
                      expectedRevision: flowBase,
                      workflow: next,
                    });
                    setFlow(next);
                    setFlowBase(next.revision);
                    setNotice("개발 흐름을 저장했습니다.");
                  })
                }
              >
                개발 흐름 저장
              </button>
              <button
                onClick={() => {
                  try {
                    setComposed(
                      resolveHarness(snapshot, { ...project, workflow: flow })
                        ?.agents.map(
                          (a) => `## ${a.agent.name}\n${a.instructions}`,
                        )
                        .join("\n\n") ?? "",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                적용 지침 확인
              </button>
              <button onClick={() => selectProject(projectId)}>
                최신 저장본 불러오기
              </button>
            </div>
          </>
        )}
      </section>
      {composed && (
        <section className="runtime-card">
          <h2>현재 편집 중인 흐름의 지침 미리보기</h2>
          <MarkdownPreview text={composed} />
        </section>
      )}
    </div>
  );
}
