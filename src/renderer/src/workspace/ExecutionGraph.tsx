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
}: {
  run: Run;
  connected: boolean;
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
  const details = Object.fromEntries(
    stages.map((s) => {
      const relevant =
        run.runtime?.kind === "planning"
          ? ["requirements", "design"].includes(s)
          : !["requirements", "design"].includes(s);
      const list = items.filter((i) => i.stage === s);
      return [
        s,
        !relevant
          ? "별도 설계 실행/승인 기록"
          : list.length
            ? `${list.filter((i) => i.state === "running").length} 실행 · ${list.filter((i) => i.state === "passed").length}/${list.length} 완료`
            : s === "verification"
              ? "시스템 고정 검사 포함"
              : "에이전트 기록 없음",
      ];
    }),
  );
  return (
    <>
      <div className="surface-toolbar">
        <span>
          하네스{" "}
          {run.runtime?.harness
            ? `v${run.runtime.harness.workflowRevision}`
            : "스냅샷 없음 · 기록만 표시"}{" "}
          · 시도 {run.runtime?.attempt ?? 1}
        </span>
        <button
          disabled={!current && !activeStage}
          onClick={() => {
            const target = current?.id ?? activeStage;
            if (target) setSelected(target);
          }}
        >
          현재 작업 선택
        </button>
      </div>
      {!connected && (
        <p role="status">
          연결이 끊겼습니다. 마지막으로 받은 실행 기록을 표시합니다.
        </p>
      )}
      <WorkflowGraph
        label="실행 흐름 그래프"
        items={items}
        selected={selected}
        onSelect={setSelected}
        modes={
          run.runtime?.harness?.execution ??
          Object.fromEntries(stages.map((s) => [s, "sequential"]))
        }
        stageDetails={details}
        activeStage={activeStage}
      />
      <section className="graph-run-detail" aria-label="선택한 실행 근거">
        <h3>
          {item?.name ?? (stage ? stageNames[stage] : "실행 기록")}{" "}
          {item && `· ${item.detail}`}
        </h3>
        {execution ? (
          <>
            <p>
              시도 {execution.attempt} · 에이전트 v{execution.revision} ·{" "}
              {execution.required ? "필수" : "선택"} · {execution.model}
            </p>
            <p className="evidence-binding">
              입력 tree <code>{execution.inputTree}</code>
              {execution.outputTree && (
                <>
                  {" "}
                  · 출력 tree <code>{execution.outputTree}</code>
                </>
              )}
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
                아직 결과가 기록되지 않았습니다. 현재 활동은 하단 실행 로그에서
                확인하세요.
              </p>
            )}
            <details>
              <summary>실제로 적용한 지침</summary>
              <MarkdownPreview text={execution.instructions} />
            </details>
          </>
        ) : (
          <p className="muted">
            {item
              ? "이 시도에서 시작 기록이 없습니다. 앞 단계 완료와 병렬 실행 묶음을 기다립니다. 종료된 실행은 자동으로 이어지지 않습니다."
              : "에이전트 노드를 선택하면 해당 시도의 입력·결과·지침을 확인할 수 있습니다. 고정 검사와 승인 근거는 각각 검증 탭과 설계 화면에서 확인하세요."}
          </p>
        )}
      </section>
    </>
  );
}
