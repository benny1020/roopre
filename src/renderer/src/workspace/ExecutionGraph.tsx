import { useMemo, useState } from "react";
import type { Run } from "../../../shared/contracts";
import {
  executionGraph,
  activeGraphStage,
} from "../../../shared/execution-graph";
import { stages, stageNames } from "../../../shared/harness";
import WorkflowGraph from "./WorkflowGraph";
import MarkdownPreview from "../MarkdownPreview";
export default function ExecutionGraph({
  run,
  connected,
  onNavigate,
}: {
  run: Run;
  connected: boolean;
  onNavigate: (tab: string) => void;
}) {
  const items = useMemo(() => executionGraph(run, connected), [run, connected]);
  const activeStage = activeGraphStage(run, connected);
  const current = items.find((i) => i.state === "running");
  const [selected, setSelected] = useState(
    current?.id ?? activeStage ?? items[0]?.id ?? "implementation",
  );
  const item = items.find((i) => i.id === selected),
    execution = item?.execution;
  const stage = stages.find((s) => s === selected) ?? item?.stage;
  const stageItems = items.filter((i) => i.stage === stage);
  const evidence =
    run.runtime?.evidence.filter((e) => e.attempt === run.runtime?.attempt) ??
    [];
  const details = Object.fromEntries(
    stages.map((s) => {
      const relevant =
        run.runtime?.kind === "planning"
          ? ["requirements", "design"].includes(s)
          : !["requirements", "design"].includes(s);
      const list = items.filter((i) => i.stage === s);
      const mode = run.runtime?.harness
        ? `${run.runtime.harness.execution?.[s] === "parallel" ? "병렬" : "순차"} · `
        : "";
      return [
        s,
        !relevant
          ? "설계·승인 기록에서 확인"
          : list.length
            ? `${mode}${list.filter((i) => i.state === "running").length} 실행 · ${list.filter((i) => i.state === "passed").length}/${list.length} 완료`
            : s === "verification"
              ? "시스템 고정 검사 포함"
              : "에이전트 기록 없음",
      ];
    }),
  );
  return (
    <div className="execution-graph-layout">
      <WorkflowGraph
        label="실행 흐름 그래프"
        items={items}
        selected={selected}
        onSelect={setSelected}
        stageDetails={details}
        activeStage={activeStage}
        toolbarActions={
          <button
            disabled={!current && !activeStage}
            onClick={() => {
              const target = current?.id ?? activeStage;
              if (target) setSelected(target);
            }}
          >
            현재 작업 선택
          </button>
        }
      />
      <section className="graph-run-detail" aria-label="선택한 실행 근거">
        <div className="graph-detail-heading">
          <span className="muted">
            {stage ? stageNames[stage] : "실행"} · 시도{" "}
            {run.runtime?.attempt ?? 1}
          </span>
          <h3>
            {item?.name ?? (stage ? stageNames[stage] : "실행 기록")}
            {item && ` · ${item.detail}`}
          </h3>
        </div>
        {!connected && (
          <p role="status" className="error-banner">
            연결이 끊겼습니다. 마지막으로 받은 기록입니다.
          </p>
        )}
        {execution ? (
          <>
            <p className="graph-agent-meta">
              에이전트 v{execution.revision} ·{" "}
              {execution.required ? "필수" : "선택"} · {execution.model}
            </p>
            {execution.error && (
              <p role="alert" className="error-banner">
                {execution.error}
              </p>
            )}
            {execution.output ? (
              <details open>
                <summary>실행 결과</summary>
                <pre>{execution.output}</pre>
              </details>
            ) : (
              <p className="muted">
                아직 결과가 기록되지 않았습니다. 실행 출력에서 현재 활동을
                확인하세요.
              </p>
            )}
            <details>
              <summary>실제로 적용한 지침</summary>
              <MarkdownPreview text={execution.instructions} />
            </details>
            <details>
              <summary>입력·출력 버전</summary>
              <p className="evidence-binding">
                입력 tree <code>{execution.inputTree}</code>
                {execution.outputTree && (
                  <>
                    {" "}
                    · 출력 tree <code>{execution.outputTree}</code>
                  </>
                )}
              </p>
            </details>
          </>
        ) : item ? (
          <p className="muted">
            이 시도에서 시작 기록이 없습니다. 앞 단계 완료와 병렬 실행 묶음을
            기다립니다. 종료된 실행은 자동으로 이어지지 않습니다.
          </p>
        ) : (
          <>
            {!!stageItems.length && (
              <div className="graph-stage-agents">
                {stageItems.map((agent) => (
                  <button key={agent.id} onClick={() => setSelected(agent.id)}>
                    <strong>{agent.name}</strong>
                    <span>{agent.detail}</span>
                  </button>
                ))}
              </div>
            )}
            {stage === "verification" ? (
              <>
                <p className="muted">
                  현재 시도의 고정 검사 {evidence.length}개 · 통과{" "}
                  {evidence.filter((e) => e.status === "passed").length} · 실패{" "}
                  {evidence.filter((e) => e.status === "failed").length}
                </p>
                <button onClick={() => onNavigate("checks")}>
                  검증 결과 보기
                </button>
              </>
            ) : stage === "review" ? (
              <button onClick={() => onNavigate("review")}>
                AI 리뷰 결과 보기
              </button>
            ) : (
              <p className="muted">
                {["requirements", "design"].includes(stage ?? "") &&
                run.runtime?.kind !== "planning"
                  ? "이 실행의 설계는 상단 설계·리뷰에서 확인하세요. 설계 승인은 실행 그래프에서 변경되지 않습니다."
                  : "에이전트를 선택하면 실행 결과와 적용한 지침을 확인할 수 있습니다."}
              </p>
            )}
          </>
        )}
        <footer className="graph-detail-footer">
          {run.runtime?.harness
            ? `하네스 v${run.runtime.harness.workflowRevision}`
            : "하네스 스냅샷 없음 · 기록만 표시"}
        </footer>
      </section>
    </div>
  );
}
