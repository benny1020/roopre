import type { Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
import { runNames } from "./RunPanel";

export default function RunOverview({
  snapshot,
  onSelect,
}: {
  snapshot: Snapshot;
  onSelect: (id: string) => void;
}) {
  const runs = snapshot.runs.slice().reverse();
  const counts = [
    ["진행 중", runs.filter((r) => activeStatuses.includes(r.status)).length],
    ["결과 확인", runs.filter((r) => r.status === "ready_for_merge").length],
    [
      "확인 필요",
      runs.filter((r) =>
        ["failed", "interrupted", "blocked"].includes(r.status),
      ).length,
    ],
  ];
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">전체 프로젝트</div>
          <h1>실행 현황</h1>
          <p>
            동시에 최대 2개 프로젝트를 실행합니다. 같은 프로젝트는 한 번에
            하나씩 진행합니다.
          </p>
        </div>
      </div>
      <div className="runtime-grid">
        {counts.map(([label, count]) => (
          <section className="runtime-card" key={label}>
            <small>{label}</small>
            <h2>{count}</h2>
          </section>
        ))}
      </div>
      {!runs.length && (
        <section className="runtime-card">
          <h2>아직 실행한 작업이 없습니다</h2>
          <p>
            프로젝트 환경을 설정하고, 기능의 설계를 승인한 뒤 개발을 시작하세요.
          </p>
        </section>
      )}
      {runs.map((run) => {
        const feature = snapshot.features.find((f) => f.id === run.featureId)!;
        const project = snapshot.projects.find(
          (p) => p.id === feature.projectId,
        )!;
        return (
          <section className="runtime-card" key={run.id}>
            <div className="button-row">
              <span className="version-badge">{runNames[run.status]}</span>
              <small>
                {project.name} · {run.id}
              </small>
            </div>
            <h2>
              <button className="soft" onClick={() => onSelect(feature.id)}>
                {feature.title}
              </button>
            </h2>
            <p>{run.reason}</p>
            <small>
              검사 통과{" "}
              {run.runtime?.evidence.filter((e) => e.status === "passed")
                .length ?? 0}
              건 · 최근 확인{" "}
              {new Date(run.runtime?.heartbeat ?? run.at).toLocaleTimeString()}
            </small>
          </section>
        );
      })}
    </div>
  );
}
