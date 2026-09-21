import type { Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
import { runNames } from "./workspace/presentation";
import { Empty } from "./workspace/Controls";
import { ArrowUpRight } from "lucide-react";
export default function RunOverview({
  snapshot,
  onSelect,
}: {
  snapshot: Snapshot;
  onSelect: (id: string, runId: string) => void;
}) {
  const runs = snapshot.runs.slice().reverse();
  return (
    <div className="content-page execution-overview">
      <div className="page-heading">
        <div>
          <div className="eyebrow">전체 프로젝트 · 실행기</div>
          <h1>실행 현황</h1>
          <p>프로젝트 간 최대 2개 동시 실행 · 같은 프로젝트는 순차 실행</p>
        </div>
        <span className="work-state active">
          <i />
          {runs.filter((r) => activeStatuses.includes(r.status)).length}개 진행
          중
        </span>
      </div>
      {!runs.length ? (
        <Empty title="아직 실행한 작업이 없습니다">
          기능의 설계와 승인 조건을 확인하고 개발을 시작하세요.
        </Empty>
      ) : (
        <div className="run-table">
          <div className="run-table-heading">
            <span>프로젝트 / 기능</span>
            <span>상태</span>
            <span>현재 시도 검사</span>
            <span>최근 확인</span>
          </div>
          {runs.map((run) => {
            const f = snapshot.features.find((f) => f.id === run.featureId);
            if (!f) return null;
            const checks =
              run.runtime?.evidence.filter(
                (e) => e.attempt === run.runtime?.attempt,
              ) || [];
            return (
              <button
                key={run.id}
                onClick={() => onSelect(f.id, run.id)}
                className="run-table-row"
              >
                <span>
                  <strong>{f.title}</strong>
                  <small>
                    {snapshot.projects.find((p) => p.id === f.projectId)?.name}{" "}
                    · {run.id.slice(0, 8)} · 시도 {run.runtime?.attempt ?? 1}
                  </small>
                </span>
                <span
                  className={`work-state ${run.status === "failed" ? "danger" : activeStatuses.includes(run.status) ? "active" : "quiet"}`}
                >
                  <i />
                  {runNames[run.status]}
                </span>
                <span>
                  {checks.filter((e) => e.status === "passed").length} 통과 /{" "}
                  {checks.filter((e) => e.status === "failed").length} 실패
                </span>
                <span>
                  {new Date(
                    run.runtime?.heartbeat || run.at,
                  ).toLocaleTimeString()}
                  <ArrowUpRight size={13} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
