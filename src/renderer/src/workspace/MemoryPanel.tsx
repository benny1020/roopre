import { useEffect, useState } from "react";
import { Pause, Pencil, Save } from "lucide-react";
import type { Snapshot } from "../../../shared/contracts";
import {
  canonicalSourceRef,
  type MemorySourceRef,
  type WorkMemory,
} from "../../../shared/memory";

export type MemorySeed = {
  title: string;
  body: string;
  sourceRef: MemorySourceRef;
};

export default function MemoryPanel({
  snapshot,
  projectId,
  featureId,
  agentId,
  seed,
}: {
  snapshot: Snapshot;
  projectId: string;
  featureId?: string;
  agentId?: string;
  seed?: MemorySeed;
}) {
  const project = snapshot.projects.find((item) => item.id === projectId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [sourceRef, setSourceRef] = useState<MemorySourceRef>();
  const [editing, setEditing] = useState<WorkMemory>();
  const [projectWide, setProjectWide] = useState(!featureId);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!seed) return;
    setTitle(seed.title);
    setBody(seed.body);
    setSourceRef(seed.sourceRef);
    setEditing(undefined);
    setConfirmed(false);
  }, [seed]);
  const scopeFeatureId = projectWide ? undefined : featureId;
  const memories = (project?.memories || []).filter(
    (memory) =>
      memory.agentDefinitionId === agentId &&
      memory.featureId === scopeFeatureId,
  );
  const activeRun = snapshot.runs.some((run) => {
    const feature = snapshot.features.find((item) => item.id === run.featureId);
    return (
      feature?.projectId === projectId &&
      ([
        "queued",
        "preparing",
        "implementing",
        "verifying",
        "reviewing",
        "repairing",
      ].includes(run.status) ||
        run.runtime?.terminationConfirmed === false)
    );
  });
  const save = async () => {
    const sourceRefs =
      editing?.sourceRefs ||
      (sourceRef
        ? [sourceRef]
        : manualSource.trim()
          ? [{ type: "manual" as const, label: manualSource }]
          : []);
    if (
      !agentId ||
      !title.trim() ||
      !body.trim() ||
      !sourceRefs.length ||
      !confirmed
    )
      return;
    try {
      await window.roopre!.command({
        type: "save_memory",
        projectId,
        expectedRevision: snapshot.revision,
        promoteToProject: projectWide && !!featureId,
        memory: {
          id: editing?.id || crypto.randomUUID(),
          agentDefinitionId: agentId,
          ...(scopeFeatureId ? { featureId: scopeFeatureId } : {}),
          title,
          body,
          revision: editing ? editing.revision + 1 : 1,
          sourceRefs,
          active: true,
        },
      });
      setTitle("");
      setBody("");
      setManualSource("");
      setSourceRef(undefined);
      setEditing(undefined);
      setConfirmed(false);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const deactivate = async (memory: WorkMemory) => {
    try {
      await window.roopre!.command({
        type: "deactivate_memory",
        projectId,
        memoryId: memory.id,
        expectedRevision: snapshot.revision,
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const edit = (memory: WorkMemory) => {
    setEditing(memory);
    setTitle(memory.title);
    setBody(memory.body);
    setSourceRef(memory.sourceRefs[0]);
    setProjectWide(!memory.featureId);
    setManualSource(
      memory.sourceRefs[0]?.type === "manual" ? memory.sourceRefs[0].label : "",
    );
    setConfirmed(false);
    setError("");
  };
  if (!agentId)
    return <p className="muted">기억을 관리할 에이전트를 선택하세요.</p>;
  return (
    <section className="memory-panel" aria-label="작업 기억">
      <p className="conversation-boundary">
        기억은 다음 승인된 실행 입력에만 고정됩니다. 명령·승인·검증 근거가
        아니며, 저장하면 이 프로젝트의 설계 승인을 다시 확인해야 합니다.
      </p>
      {activeRun && (
        <p className="conversation-warning">
          대기·실행 중이거나 종료 확인 전인 작업이 있어 기억을 바꿀 수 없습니다.
        </p>
      )}
      {memories.map((memory) => (
        <article className="memory-item" key={memory.id}>
          <strong>{memory.title}</strong>{" "}
          <small>
            r{memory.revision} · {memory.active ? "사용 중" : "사용 중지"}
          </small>
          <p>{memory.body}</p>
          <small>
            출처: {memory.sourceRefs.map(canonicalSourceRef).join(", ")}
          </small>
          <button
            className="soft"
            disabled={activeRun}
            onClick={() => edit(memory)}
          >
            <Pencil size={13} /> 수정
          </button>
          {memory.active && (
            <button
              className="soft"
              disabled={activeRun}
              onClick={() => void deactivate(memory)}
            >
              <Pause size={13} /> 사용 중지
            </button>
          )}
        </article>
      ))}
      <div className="memory-form">
        <label>
          적용 범위
          <select
            aria-label="기억 적용 범위"
            disabled={!!editing || !featureId}
            value={projectWide ? "project" : "feature"}
            onChange={(event) =>
              setProjectWide(event.target.value === "project")
            }
          >
            <option value="feature">이 기능</option>
            <option value="project">프로젝트 전체</option>
          </select>
        </label>
        {projectWide && featureId && (
          <p className="conversation-warning">
            이 기능의 대화 출처를 프로젝트 전체 기억으로 승격합니다. 이
            프로젝트의 모든 설계 승인을 다시 확인해야 합니다.
          </p>
        )}
        <label>
          제목
          <input
            aria-label="기억 제목"
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          내용
          <textarea
            aria-label="기억 내용"
            value={body}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {sourceRef ? (
          <p className="memory-source">
            출처: {canonicalSourceRef(sourceRef)}{" "}
            {editing && "(기존 출처 고정)"}
          </p>
        ) : (
          <label>
            사용자 확인 출처
            <input
              aria-label="사용자 확인 출처"
              value={manualSource}
              maxLength={240}
              placeholder="예: 9월 28일 사용자 결정"
              onChange={(event) => setManualSource(event.target.value)}
            />
          </label>
        )}
        <label className="memory-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          이 내용과 범위를 확인했고, 프로젝트 승인 재확인 영향을 이해합니다.
        </label>
        {error && (
          <p className="conversation-error" role="alert">
            {error}
          </p>
        )}
        <button
          disabled={
            activeRun ||
            !confirmed ||
            !title.trim() ||
            !body.trim() ||
            (!sourceRef && !manualSource.trim())
          }
          onClick={() => void save()}
        >
          <Save size={14} /> {editing ? "수정 저장" : "기억으로 저장"}
        </button>
      </div>
    </section>
  );
}
