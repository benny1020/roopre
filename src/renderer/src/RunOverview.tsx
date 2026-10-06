import type { Snapshot } from "../../shared/contracts";
import { activeStatuses, executionCapacityOf } from "../../shared/runtime";
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
  const capacity = executionCapacityOf(snapshot.executionCapacity);
  return (
    <div className="content-page execution-overview">
      <div className="page-heading">
        <div>
          <div className="eyebrow">All projects · Runner</div>
          <h1>Execution</h1>
          <p>
            Up to {capacity.maxConcurrentRuns} runs · Up to{" "}
            {capacity.maxConcurrentRunsPerProject} per project · Up to{" "}
            {capacity.maxAgentsPerStage} parallel agents per stage
          </p>
        </div>
        <span className="work-state active">
          <i />
          {runs.filter((r) => activeStatuses.includes(r.status)).length} active
        </span>
      </div>
      {!runs.length ? (
        <Empty title="No runs yet">
          Review and approve a feature's design, then start implementation.
        </Empty>
      ) : (
        <div className="run-table">
          <div className="run-table-heading">
            <span>Project / Feature</span>
            <span>Status</span>
            <span>Current-attempt checks</span>
            <span>Last seen</span>
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
                    · {run.id.slice(0, 8)} · Attempt {run.runtime?.attempt ?? 1}
                  </small>
                </span>
                <span
                  className={`work-state ${run.status === "failed" ? "danger" : activeStatuses.includes(run.status) ? "active" : "quiet"}`}
                >
                  <i />
                  {runNames[run.status]}
                </span>
                <span>
                  {checks.filter((e) => e.status === "passed").length} passed /{" "}
                  {checks.filter((e) => e.status === "failed").length} Failed
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
