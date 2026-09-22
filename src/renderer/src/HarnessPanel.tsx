import AgentRefinement from "./workspace/AgentRefinement";
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
  workflowSchema,
  workflowIssues,
} from "../../shared/harness";
import type { ConnectionInfo } from "../../shared/runtime";
import MarkdownPreview from "./MarkdownPreview";
import WorkflowEditor from "./workspace/WorkflowEditor";
import { Dialog } from "./workspace/Controls";
import type { Stage } from "./workspace/WorkflowGraph";
import { activeStatuses } from "../../shared/runtime";
import { stageConcurrency } from "../../shared/stage-execution";
const instructions = {
  requirements: "",
  design: "",
  implementation: "",
  verification: "",
  review: "",
};
export default function HarnessPanel({
  snapshot,
  initialProjectId,
  onProjectChange,
  send,
  onSaved,
}: {
  snapshot: Snapshot;
  initialProjectId?: string;
  onProjectChange?: (id: string) => void;
  send: (c: Command) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}) {
  const [projectId, setProjectId] = useState(
    initialProjectId && snapshot.projects.some((p) => p.id === initialProjectId)
      ? initialProjectId
      : (snapshot.projects[0]?.id ?? ""),
  );
  const project = snapshot.projects.find((p) => p.id === projectId);
  const [pendingStage, setPendingStage] = useState<Stage>();
  const [editing, setEditing] = useState<AgentDefinition>();
  const draftKey = (id: string) => `roopre:flow-draft:${snapshot.teamId}:${id}`;
  const readDraft = (id: string) => {
    try {
      const raw = JSON.parse(localStorage.getItem(draftKey(id)) || "null");
      if (!raw || !Number.isInteger(raw.base) || raw.base < 0) return undefined;
      return {
        base: raw.base as number,
        flow: workflowSchema
          .extend({ assignments: workflowSchema.shape.assignments.min(0) })
          .parse(raw.flow),
      };
    } catch {
      return undefined;
    }
  };
  const [flow, setFlow] = useState<Workflow>(
    readDraft(projectId)?.flow ??
      project?.workflow ?? {
        revision: 1,
        assignments: [],
        instructions: { ...instructions },
      },
  );
  const [flowBase, setFlowBase] = useState(
    readDraft(projectId)?.base ?? project?.workflow?.revision ?? 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [preview, setPreview] = useState(false);
  const [composed, setComposed] = useState("");
  const agents = latestAgents(snapshot);
  const activeProject = snapshot.runs.some(
    (r) =>
      snapshot.features.find((f) => f.id === r.featureId)?.projectId ===
        projectId &&
      (activeStatuses.includes(r.status) ||
        r.runtime?.terminationConfirmed === false),
  );
  const locked = busy || activeProject || !!project?.harness;
  const content = (value?: Workflow) =>
    value
      ? JSON.stringify([
          value.revision,
          stages.map((stage) => [
            value.instructions[stage],
            value.execution?.[stage] ?? "parallel",
          ]),
          value.assignments.map((a) => [a.id, a.agentId, a.stage, a.required]),
        ])
      : "";
  const dirty = content(flow) !== content(project?.workflow);
  const flowIssues = project ? workflowIssues(snapshot, project, flow) : [];
  const [discard, setDiscard] = useState(false);
  const [resetDefault, setResetDefault] = useState(false);
  const editingProjects = snapshot.projects.filter((p) =>
    p.workflow?.assignments.some((a) => a.agentId === editing?.id),
  );
  const editingLocked =
    !!editing &&
    (snapshot.projects.some((p) =>
      Object.values(p.harness?.agents ?? {}).includes(editing.id),
    ) ||
      snapshot.runs.some(
        (r) =>
          editingProjects.some(
            (p) =>
              p.id ===
              snapshot.features.find((f) => f.id === r.featureId)?.projectId,
          ) &&
          (activeStatuses.includes(r.status) ||
            r.runtime?.terminationConfirmed === false),
      ));

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(
        draftKey(projectId),
        JSON.stringify({ base: flowBase, flow }),
      );
    } catch {
      setError(
        "편집 초안을 이 기기에 보관하지 못했습니다. 화면을 닫기 전에 개발 흐름을 저장하세요.",
      );
    }
  }, [flow, flowBase, projectId, snapshot.teamId]);
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
    onProjectChange?.(id);
    setFlow(
      readDraft(id)?.flow ??
        p?.workflow ?? {
          revision: 1,
          assignments: [],
          instructions: { ...instructions },
        },
    );
    setFlowBase(readDraft(id)?.base ?? p?.workflow?.revision ?? 0);
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
  const applyDefault = () =>
    act(async () => {
      if (locked) return;
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
      setResetDefault(false);
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
            setPendingStage(undefined);
            setEditing(fresh());
            setPreview(false);
          }}
        >
          에이전트 만들기
        </button>
      </div>
      {error && !editing && !resetDefault && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {editing && (
        <Dialog
          label="에이전트 편집"
          onClose={() => {
            if (!busy) {
              setEditing(undefined);
              setPendingStage(undefined);
            }
          }}
          className="command-dialog graph-picker"
        >
          <section
            className="runtime-card agent-editor"
            aria-label="에이전트 편집"
          >
            <h2>{editing.name || "새 에이전트"}</h2>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <AgentRefinement
              key={editing.id}
              stage={
                pendingStage ??
                (editing.capability === "implementation"
                  ? "implementation"
                  : "review")
              }
              connections={connections}
              onApply={(draft) =>
                setEditing((current) =>
                  current ? { ...current, ...draft } : current,
                )
              }
            />
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
                      capability: e.target
                        .value as AgentDefinition["capability"],
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
            {editingLocked && (
              <p className="error-banner">
                공유 표준에서 관리하거나 실행 중인 역할은 여기서 저장할 수
                없습니다. 실행을 종료하거나 하네스 표준에서 수정하세요.
              </p>
            )}
            <p className="muted">
              사용 중인 정의를 변경하면 관련 설계의 승인이 해제되고 실행이
              중단됩니다.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={
                  busy ||
                  editingLocked ||
                  !editing.name.trim() ||
                  !editing.markdown.trim()
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
                    if (
                      pendingStage &&
                      isNew &&
                      (!editing.projectId || editing.projectId === projectId) &&
                      (pendingStage === "implementation") ===
                        (editing.capability === "implementation")
                    ) {
                      setFlow((current) => ({
                        ...current,
                        assignments: [
                          ...current.assignments,
                          {
                            id: crypto.randomUUID(),
                            agentId: editing.id,
                            stage: pendingStage,
                            required: true,
                          },
                        ],
                      }));
                      setNotice(
                        "에이전트를 저장하고 초안에 배치했습니다. 개발 흐름을 저장해 적용하세요.",
                      );
                    } else setNotice("에이전트 버전을 저장했습니다.");
                    setPendingStage(undefined);
                    setEditing(undefined);
                  })
                }
              >
                에이전트 저장
              </button>
              <button
                onClick={() => {
                  setEditing(undefined);
                  setPendingStage(undefined);
                }}
              >
                편집 닫기
              </button>
            </div>
          </section>
        </Dialog>
      )}
      <section className="runtime-card workflow-settings">
        <div className="workflow-project-toolbar">
          <label className="field">
            개발 흐름 프로젝트
            <select
              value={projectId}
              onChange={(e) => selectProject(e.target.value)}
              disabled={busy || !snapshot.projects.length}
            >
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {project && (
            <button
              disabled={locked}
              onClick={() =>
                flow.assignments.length
                  ? setResetDefault(true)
                  : void applyDefault()
              }
            >
              기본 흐름 적용
            </button>
          )}
        </div>
        {!project && (
          <p>
            프로젝트를 먼저 만드세요. 전역 에이전트는 지금 작성할 수 있습니다.
          </p>
        )}
        {project && (
          <>
            {activeProject && (
              <p className="error-banner">
                이 프로젝트의 실행이 종료될 때까지 흐름 편집을 잠급니다. 종료 후
                새 버전을 저장하세요.
              </p>
            )}
            {project.harness && (
              <p className="muted">
                공유 표준으로 관리하는 흐름입니다. 하네스 설정에서 새 버전을
                가져오거나 편집하세요.
              </p>
            )}
            <WorkflowEditor
              key={projectId}
              flow={flow}
              onChange={setFlow}
              agents={available}
              locked={locked}
              onCreate={(stage) => {
                setPendingStage(stage);
                setEditing({
                  ...fresh(),
                  projectId,
                  capability:
                    stage === "implementation" ? "implementation" : "read-only",
                });
                setPreview(false);
              }}
            />
            <details className="workflow-policy-hint">
              <summary>병렬 실행과 승인 규칙</summary>{" "}
              <p className="muted">
                단계 안에서는 기본 병렬로 최대 {stageConcurrency}개씩 실행하며,
                모두 끝나면 다음 단계로 넘어갑니다. 이전 에이전트 결과가 필요한
                단계는 순차를 선택하세요. 구현 파일이 겹치면 통합을 중단하고
                결과를 보존합니다. 실행 방식을 저장하면 설계를 재승인해야
                합니다.
              </p>
            </details>
            <div className="workflow-savebar">
              <p className="muted">
                {dirty
                  ? "저장하지 않은 초안 · 이 기기에 자동 보관됨"
                  : "저장된 흐름과 동일"}{" "}
                · 기준 v{flowBase}
              </p>
              {flowIssues.length > 0 && (
                <p className="muted" role="status">
                  저장 전 확인: {flowIssues.join(" ")}
                </p>
              )}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={locked || !dirty || flowIssues.length > 0}
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
                <button
                  onClick={() => {
                    if (dirty) setDiscard(true);
                    else {
                      localStorage.removeItem(draftKey(projectId));
                      selectProject(projectId);
                    }
                  }}
                >
                  최신 저장본 불러오기
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {resetDefault && (
        <Dialog
          label="기본 흐름으로 교체"
          onClose={() => {
            if (!busy) setResetDefault(false);
          }}
          className="command-dialog graph-picker"
        >
          <h2>현재 흐름을 기본 역할 5개로 교체할까요?</h2>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <p>
            현재 배치와 단계 지침을 바꾸고 관련 설계의 승인을 해제합니다. 기존
            에이전트 정의와 실행 기록은 유지됩니다.
          </p>
          <div className="button-row">
            <button disabled={busy} onClick={() => setResetDefault(false)}>
              계속 편집
            </button>
            <button disabled={locked} onClick={() => void applyDefault()}>
              기본 흐름으로 교체
            </button>
          </div>
        </Dialog>
      )}
      {discard && (
        <Dialog
          label="편집 초안 버리기"
          onClose={() => setDiscard(false)}
          className="command-dialog graph-picker"
        >
          <h2>저장하지 않은 흐름 변경을 버릴까요?</h2>
          <p>
            현재 프로젝트의 로컬 초안을 지우고 최신 저장본을 불러옵니다. 다른
            프로젝트의 초안은 유지됩니다.
          </p>
          <div className="button-row">
            <button onClick={() => setDiscard(false)}>계속 편집</button>
            <button
              onClick={() => {
                localStorage.removeItem(draftKey(projectId));
                selectProject(projectId);
                setDiscard(false);
              }}
            >
              초안 버리고 불러오기
            </button>
          </div>
        </Dialog>
      )}
      <details className="agent-library-section">
        <summary>에이전트 라이브러리 · {agents.length}개</summary>
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
                    setPendingStage(undefined);
                    setEditing({ ...a });
                    setPreview(false);
                  }}
                >
                  편집
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setPendingStage(undefined);
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
      </details>
      {composed && (
        <section className="runtime-card">
          <h2>현재 편집 중인 흐름의 지침 미리보기</h2>
          <MarkdownPreview text={composed} />
        </section>
      )}
    </div>
  );
}
