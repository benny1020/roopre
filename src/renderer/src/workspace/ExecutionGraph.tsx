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
        ? `${run.runtime.harness.execution?.[s] !== "sequential" ? "Parallel" : "Sequential"} · `
        : "";
      return [
        s,
        !relevant
          ? "View in design and approval history"
          : list.length
            ? `${mode}${list.filter((i) => i.state === "running").length} running · ${list.filter((i) => i.state === "passed").length}/${list.length} complete`
            : s === "verification"
              ? "Includes fixed system checks"
              : "No agent records",
      ];
    }),
  );
  return (
    <div className="execution-graph-layout">
      <WorkflowGraph
        label="Execution workflow graph"
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
            Select current activity
          </button>
        }
      />
      <section
        className="graph-run-detail"
        aria-label="Selected execution evidence"
      >
        <div className="graph-detail-heading">
          <span className="muted">
            {stage ? stageNames[stage] : "Run"} · Attempt{" "}
            {run.runtime?.attempt ?? 1}
          </span>
          <h3>
            {item?.name ?? (stage ? stageNames[stage] : "Run history")}
            {item && ` · ${item.detail}`}
          </h3>
        </div>
        {!connected && (
          <p role="status" className="error-banner">
            Disconnected. Showing the last received records.
          </p>
        )}
        {execution ? (
          <>
            <p className="graph-agent-meta">
              Agent v{execution.revision} ·{" "}
              {execution.required ? "Required" : "Optional"} · {execution.model}
            </p>
            {execution.error && (
              <p role="alert" className="error-banner">
                {execution.error}
              </p>
            )}
            {execution.output ? (
              <details open>
                <summary>Results</summary>
                <pre>{execution.output}</pre>
              </details>
            ) : (
              <p className="muted">
                No result recorded yet. Check execution output for current
                activity.
              </p>
            )}
            <details>
              <summary>Applied instructions</summary>
              <MarkdownPreview text={execution.instructions} />
            </details>
            <details>
              <summary>Input & output versions</summary>
              <p className="evidence-binding">
                Input tree <code>{execution.inputTree}</code>
                {execution.outputTree && (
                  <>
                    {" "}
                    · Output tree <code>{execution.outputTree}</code>
                  </>
                )}
              </p>
            </details>
          </>
        ) : item ? (
          <p className="muted">
            No start record for this attempt. Waiting for earlier stages and
            available parallel capacity. Finished runs do not resume
            automatically.
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
                  Fixed checks for this attempt {evidence.length} · Passed{" "}
                  {evidence.filter((e) => e.status === "passed").length} ·
                  Failed {evidence.filter((e) => e.status === "failed").length}
                </p>
                <button onClick={() => onNavigate("checks")}>
                  View verification results
                </button>
              </>
            ) : stage === "review" ? (
              <button onClick={() => onNavigate("review")}>
                View AI review
              </button>
            ) : (
              <p className="muted">
                {["requirements", "design"].includes(stage ?? "") &&
                run.runtime?.kind !== "planning"
                  ? "Review this run's design in the Plan tab. Design approval cannot be changed from the execution graph."
                  : "Select an agent to inspect its result and applied instructions."}
              </p>
            )}
          </>
        )}
        <footer className="graph-detail-footer">
          {run.runtime?.harness
            ? `Harness v${run.runtime.harness.workflowRevision}`
            : "No harness snapshot · records only"}
        </footer>
      </section>
    </div>
  );
}
