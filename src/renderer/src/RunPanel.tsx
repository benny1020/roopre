import EventLog from "./workspace/EventLog";
import ExecutionSetup, {
  type SetupDestination,
} from "./workspace/ExecutionSetup";
import { workflowIssues } from "../../shared/harness";
import ExecutionGraph from "./workspace/ExecutionGraph";
import ReviewEvidence from "./workspace/ReviewEvidence";
import { stageNames } from "../../shared/harness";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  FileCode2,
  PanelRight,
  Play,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { Command, Feature, Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
import { runNames } from "./workspace/presentation";
import { Tabs, Empty, ResizeHandle } from "./workspace/Controls";
import DiffViewer from "./workspace/DiffViewer";
export { runNames } from "./workspace/presentation";

export default function RunPanel({
  snapshot,
  feature,
  send,
  connected = true,
  onDesign,
  onSetup,
  selectedRunId,
  onSelectRun,
}: {
  snapshot: Snapshot;
  feature: Feature;
  send: (c: Command) => Promise<unknown>;
  connected?: boolean;
  onDesign: () => void;
  onSetup: (destination: SetupDestination) => void;
  selectedRunId?: string | null;
  onSelectRun?: (runId: string | null) => void;
}) {
  const runs = snapshot.runs
    .filter((r) => r.featureId === feature.id)
    .slice()
    .reverse();
  const current = runs[0];
  const [selected, setSelected] = useState(
    () => localStorage.getItem(`ade:run:${feature.id}`) || "",
  );
  useEffect(() => {
    setSelected(
      selectedRunId || localStorage.getItem(`ade:run:${feature.id}`) || "",
    );
  }, [feature.id, selectedRunId]);
  const run = runs.find((r) => r.id === selected) || current;
  const runtime = run?.runtime;
  const gate = snapshot.gates[feature.id];
  const project = snapshot.projects.find((p) => p.id === feature.projectId)!;
  const planningConfigured =
    !!project.executionProfile &&
    !!project.workflow?.assignments.some(
      (a) => a.stage === "requirements" || a.stage === "design",
    ) &&
    !workflowIssues(snapshot, project).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("flow");
  const [inspector, setInspector] = useState(true);
  const [defaultOutput, setOutput] = useState(true);
  const [graphOutput, setGraphOutput] = useState(false);
  const [diffOutput, setDiffOutput] = useState(false);
  const output =
    tab === "flow"
      ? graphOutput
      : tab === "changes"
        ? diffOutput
        : defaultOutput;
  const [outputTab, setOutputTab] = useState("events");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(600);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setAvailableHeight(entry.contentRect.height),
    );
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, []);
  const outputLimit = Math.max(
    120,
    Math.min(320, Math.floor(availableHeight * 0.35)),
  );
  const [height, setHeight] = useState(() => {
    const n = Number(localStorage.getItem("ade:output-height"));
    return n ? Math.max(120, Math.min(320, n)) : 180;
  });
  const [width, setWidth] = useState(() => {
    const n = Number(localStorage.getItem("ade:inspector-width"));
    return n ? Math.max(240, Math.min(360, n)) : 280;
  });
  useEffect(() => {
    localStorage.setItem("ade:output-height", String(height));
  }, [height]);
  useEffect(() => {
    localStorage.setItem("ade:inspector-width", String(width));
  }, [width]);
  const [diff, setDiff] = useState<{
    runId: string;
    patch: string;
    at: string;
  }>();
  const [diffLoading, setDiffLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setDiff(undefined);
    setDiffLoading(false);
    setError("");
  }, [run?.id]);
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fetchDiff = async () => {
    if (!run || !window.roopre) return;
    const runId = run.id;
    const ticket = ++request.current;
    setDiffLoading(true);
    setError("");
    try {
      const patch = await window.roopre.runAction(runId, "diff");
      if (ticket === request.current)
        setDiff({ runId, patch, at: new Date().toLocaleTimeString() });
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    } finally {
      if (ticket === request.current) setDiffLoading(false);
    }
  };
  const working = runs.some(
    (r) =>
      activeStatuses.includes(r.status) ||
      r.runtime?.terminationConfirmed === false,
  );
  const attemptAgents =
    runtime?.agents?.filter((a) => a.attempt === runtime.attempt) || [];
  const liveAgent =
    run && activeStatuses.includes(run.status)
      ? attemptAgents.find((a) => a.status === "running")
      : undefined;
  const agent = liveAgent || attemptAgents.at(-1);
  const reviewers = attemptAgents.filter((a) => a.stage === "review");
  const pastReviewers =
    runtime?.agents?.filter(
      (a) => a.stage === "review" && a.attempt !== runtime.attempt,
    ) || [];
  const evidence =
    runtime?.evidence.filter((e) => e.attempt === runtime.attempt) || [];
  const history =
    runtime?.evidence.filter((e) => e.attempt !== runtime.attempt) || [];
  return (
    <div className="execution-workspace" ref={workspaceRef}>
      <div className="execution-toolbar">
        <label className="run-picker">
          Run
          <select
            aria-label="Select run"
            value={run?.id || ""}
            onChange={(e) => {
              setSelected(e.target.value);
              localStorage.setItem(`ade:run:${feature.id}`, e.target.value);
              onSelectRun?.(e.target.value || null);
            }}
          >
            {!runs.length && <option value="">No runs yet</option>}
            {runs.map((r, i) => (
              <option key={r.id} value={r.id}>
                {i === 0 ? "Latest ·" : ""}
                {runNames[r.status]} · {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {run && (
          <span className="run-attempt">
            Attempt {runtime?.attempt ?? 1}
            {run.id !== current?.id && <strong> · Previous run</strong>}
          </span>
        )}
        <div className="button-row">
          {run && (
            <button onClick={() => onSetup("profile")}>
              Execution settings
            </button>
          )}
          <button
            className="secondary"
            title={
              !planningConfigured
                ? "Configure an execution profile and planning agents first."
                : "Planning uses the currently saved draft."
            }
            disabled={!connected || busy || working || !planningConfigured}
            onClick={() =>
              void act(() =>
                send({
                  type: "queue_planning",
                  featureId: feature.id,
                  expectedRevision: feature.draft.revision,
                }),
              )
            }
          >
            <Bot size={14} />
            Run planning agents
          </button>
          <button
            className="primary"
            disabled={
              !connected ||
              busy ||
              !gate.eligible ||
              working ||
              runs.some((r) => ["blocked", "interrupted"].includes(r.status))
            }
            onClick={() =>
              void act(() =>
                send({
                  type: "queue_run",
                  featureId: feature.id,
                  designId: feature.designs.at(-1)!.id,
                }),
              )
            }
          >
            <Play size={13} />
            Start implementation
          </button>
          {tab === "flow" &&
            current &&
            (!["cancelled", "ready_for_merge", "completed"].includes(
              current.status,
            ) ||
              current.runtime?.terminationConfirmed === false) && (
              <button
                disabled={!connected || busy}
                onClick={() =>
                  void act(() =>
                    send({ type: "cancel_run", runId: current.id }),
                  )
                }
              >
                <Square size={12} />
                Cancel latest run
              </button>
            )}
          {tab === "flow" &&
            current &&
            ["failed", "interrupted"].includes(current.status) &&
            current.runtime?.kind !== "planning" && (
              <button
                disabled={
                  !connected ||
                  busy ||
                  current.runtime?.terminationConfirmed !== true
                }
                title={
                  current.runtime?.terminationConfirmed !== true
                    ? "Retry after the previous container's termination is confirmed."
                    : "Start a new run with preserved changes."
                }
                onClick={() =>
                  void act(() => window.roopre!.runAction(current.id, "retry"))
                }
              >
                <RefreshCw size={12} />
                Retry latest changes
              </button>
            )}
          {tab !== "flow" && (
            <button
              className="icon-button"
              aria-label="Agent inspector"
              title="Show agent inspector"
              aria-pressed={inspector}
              onClick={() => setInspector(!inspector)}
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {!gate.eligible && (
        <details className="execution-gate">
          <summary>
            Design approval gate · {gate.reasons.length} items to resolve
          </summary>
          <ul>
            {gate.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button onClick={onDesign}>Open design review</button>
        </details>
      )}
      {!run ? (
        <ExecutionSetup
          snapshot={snapshot}
          feature={feature}
          onSetup={onSetup}
          onDesign={onDesign}
        />
      ) : (
        <>
          <div
            className={`execution-split ${inspector && tab !== "flow" ? "with-inspector" : ""}`}
            style={{ "--inspector-width": `${width}px` } as React.CSSProperties}
          >
            <section
              className="execution-center"
              aria-label="Execution workspace"
            >
              <Tabs
                label="Results"
                value={tab}
                onChange={setTab}
                items={[
                  { id: "flow", label: "Workflow" },
                  { id: "changes", label: <>Changes</> },
                  {
                    id: "checks",
                    label: (
                      <>
                        Verification <span>{evidence.length}</span>
                      </>
                    ),
                  },
                  { id: "review", label: "AI review" },
                  { id: "artifacts", label: "Artifacts" },
                ]}
              />
              <div
                className={`execution-surface ${tab === "flow" ? "is-flow" : ""}`}
              >
                {tab === "flow" && (
                  <ExecutionGraph
                    key={`${run.id}:${runtime?.attempt ?? 1}`}
                    run={run}
                    connected={connected}
                    onNavigate={setTab}
                  />
                )}
                {tab === "changes" && (
                  <>
                    <div className="surface-toolbar">
                      <span>
                        {diff?.runId === run.id
                          ? `Workspace diff · ${diff.at} Refresh`
                          : "Workspace changes"}
                      </span>
                      <button
                        className="soft"
                        disabled={
                          !connected || diffLoading || !runtime?.worktree
                        }
                        onClick={() => void fetchDiff()}
                      >
                        <RefreshCw
                          size={13}
                          className={diffLoading ? "spin" : ""}
                        />
                        {diffLoading ? "Loading…" : "Load changes"}
                      </button>
                    </div>
                    {diff?.runId === run.id ? (
                      <DiffViewer key={diff.runId} patch={diff.patch} />
                    ) : (
                      <Empty
                        title={
                          runtime?.worktree
                            ? "Inspect changes"
                            : "No workspace yet"
                        }
                      >
                        {runtime?.worktree
                          ? "Load the current workspace diff. In-flight changes may differ from the verified commit."
                          : "Changed files appear after the isolated workspace is ready."}
                      </Empty>
                    )}
                  </>
                )}
                {tab === "checks" && (
                  <div className="evidence-list">
                    <div className="surface-toolbar">
                      <strong>SYSTEM · Fixed checks</strong>
                      <span>
                        Current attempt {runtime?.attempt ?? 1} · Result{" "}
                        {evidence.length}
                      </span>
                    </div>
                    {runtime?.head && (
                      <p className="evidence-binding">
                        Verified commit <code>{runtime.head}</code>
                      </p>
                    )}
                    {!evidence.length && (
                      <Empty title="No verification evidence yet">
                        Checks record exit codes, the verified tree and output.
                        Pending checks are not passes.
                      </Empty>
                    )}
                    {evidence.map((e, i) => (
                      <details className={`check-result ${e.status}`} key={i}>
                        <summary>
                          {e.status === "passed" ? (
                            <Check size={15} />
                          ) : (
                            <XCircle size={15} />
                          )}
                          <strong>{e.name}</strong>
                          <span>
                            {e.status === "passed" ? "Passed" : "Failed"}
                          </span>
                          <code>tree {e.tree.slice(0, 8)}</code>
                        </summary>
                        <div className="evidence-binding">
                          Exit code {e.code} · {new Date(e.at).toLocaleString()}{" "}
                          · Attempt {e.attempt}
                          <br />
                          <code>{e.tree}</code>
                        </div>
                        <pre className="output-text">
                          {e.log || "No output"}
                        </pre>
                      </details>
                    ))}
                    {runtime?.profile.checks.map((check) => (
                      <div className="check-command" key={check.name}>
                        <span>{check.name}</span>
                        <code>{check.argv.join(" ")}</code>
                        <small>{check.timeoutSeconds}s timeout</small>
                      </div>
                    ))}
                    {!!history.length && (
                      <details className="history-evidence">
                        <summary>
                          Previous-attempt checks {history.length} · Not
                          evidence for this attempt
                        </summary>
                        {history.map((e, i) => (
                          <details key={i}>
                            <summary>
                              Attempt {e.attempt} · {e.name} · {e.status} · tree{" "}
                              {e.tree.slice(0, 8)}
                            </summary>
                            <pre className="output-text">
                              {e.log || "No output"}
                            </pre>
                          </details>
                        ))}
                      </details>
                    )}
                  </div>
                )}
                {tab === "review" && (
                  <div className="review-evidence">
                    <div className="surface-toolbar">
                      <strong>AGENT · Independent review</strong>
                      <span>
                        Assess the review alongside verification evidence
                      </span>
                    </div>
                    {!reviewers.length && (
                      <Empty title="No AI review for this attempt yet">
                        Independent review follows implementation and checks.
                        Earlier review results do not verify this attempt.
                      </Empty>
                    )}
                    {reviewers.map((a) => (
                      <details key={a.id} open>
                        <summary>
                          {a.name} v{a.revision} · Attempt {a.attempt} ·{" "}
                          {a.required ? "Required" : "Optional"} ·{" "}
                          {a.status === "passed"
                            ? "Passed"
                            : a.status === "failed"
                              ? "Failed"
                              : "In progress"}
                        </summary>
                        <div className="evidence-binding">
                          Input tree <code>{a.inputTree}</code>
                          <br />
                          Output tree{" "}
                          <code>{a.outputTree || "Awaiting record"}</code>
                        </div>
                        <ReviewEvidence
                          value={a.output || a.error || "Awaiting output"}
                        />
                      </details>
                    ))}
                    {!!pastReviewers.length && (
                      <details className="review-history">
                        <summary>
                          Previous-attempt AI reviews {pastReviewers.length} ·
                          Not current verification evidence
                        </summary>
                        {pastReviewers.map((a) => (
                          <details key={a.id}>
                            <summary>
                              Attempt {a.attempt} · {a.name} v{a.revision} ·{" "}
                              {a.required ? "Required" : "Optional"} ·{" "}
                              {a.status}
                            </summary>
                            <div className="evidence-binding">
                              Input tree <code>{a.inputTree}</code>
                              <br />
                              Output tree{" "}
                              <code>{a.outputTree || "No records"}</code>
                            </div>
                            <ReviewEvidence
                              value={a.output || a.error || "No output"}
                            />
                          </details>
                        ))}
                      </details>
                    )}
                    {runtime?.review && (
                      <details className="review-original">
                        <summary>
                          Full review output · may include earlier attempts
                        </summary>
                        <pre className="output-text">{runtime.review}</pre>
                      </details>
                    )}
                  </div>
                )}
                {tab === "artifacts" && (
                  <div className="artifact-list">
                    <div className="surface-toolbar">
                      <strong>Run artifacts</strong>
                      <span>Verify integrity and open in Finder</span>
                    </div>
                    {!runtime?.artifacts?.length ? (
                      <Empty title="No saved artifacts yet">
                        Reports, test results and evidence collected by the
                        runner appear here.
                      </Empty>
                    ) : (
                      runtime.artifacts.map((file, i) => (
                        <button
                          key={file.path}
                          className="artifact-row"
                          disabled={!connected || busy}
                          onClick={() =>
                            void act(() =>
                              window.roopre!.revealArtifact(run.id, i),
                            )
                          }
                        >
                          <FileCode2 size={16} />
                          <span>
                            {file.path}
                            <small>
                              {file.bytes.toLocaleString()} bytes · Attempt{" "}
                              {file.attempt}
                            </small>
                          </span>
                          <code>{file.hash.slice(0, 12)}</code>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </section>
            {inspector && tab !== "flow" && (
              <>
                <ResizeHandle
                  value={width}
                  onChange={setWidth}
                  min={240}
                  max={360}
                  label="Agent inspector width"
                />
                <aside className="agent-inspector" aria-label="Agent status">
                  <header>
                    <Bot size={15} />
                    <strong>Agents</strong>
                    <span>{runtime?.agents?.length || 0}</span>
                  </header>
                  <div className="inspector-scroll">
                    <div className="actor-label">
                      {liveAgent
                        ? `AGENT · ${attemptAgents.filter((a) => a.status === "running").length} running`
                        : "AGENT · Latest activity"}
                    </div>
                    <h3>
                      {agent?.name || "Current attempt · Waiting for agents"}
                    </h3>
                    <p>
                      {run.reason ||
                        (agent
                          ? `${stageNames[agent.stage]} · ${agent.status === "running" ? "Running" : agent.status === "passed" ? "Complete" : "Failed"}`
                          : "Activity appears when the runner starts work.")}
                    </p>
                    {agent?.error && (
                      <p className="failure-text">{agent.error}</p>
                    )}
                    <dl>
                      <dt>Model</dt>
                      <dd>{agent?.model || "Available after execution"}</dd>
                      <dt>Last seen</dt>
                      <dd>
                        {runtime?.heartbeat
                          ? new Date(runtime.heartbeat).toLocaleTimeString()
                          : "Pending"}
                      </dd>
                      <dt>Estimated cost</dt>
                      <dd>
                        {runtime?.costReported
                          ? `$${runtime.costUsd.toFixed(4)}`
                          : "Unknown"}{" "}
                        / ${runtime?.profile.budgetUsd ?? "—"}
                      </dd>
                    </dl>
                    <small className="muted">
                      CLI estimate · not the final bill
                    </small>
                    {!!runtime?.agents?.length && (
                      <section>
                        <h4>Stage activity</h4>
                        {runtime.agents.map((a) => (
                          <details className="agent-task" key={a.id}>
                            <summary>
                              <i className={`agent-dot ${a.status}`} />
                              <span>
                                {a.name}
                                <small>
                                  {stageNames[a.stage]} · v{a.revision} ·{" "}
                                  {a.required ? "Required" : "Optional"}
                                  {" · "}
                                  {a.status === "running"
                                    ? "Running"
                                    : a.status === "passed"
                                      ? "Complete"
                                      : "Failed"}
                                </small>
                              </span>
                            </summary>
                            <p>
                              {a.model} · Attempt {a.attempt}
                            </p>
                            <p className="failure-text">{a.error}</p>
                            <details>
                              <summary>Agent result</summary>
                              <pre className="output-text">
                                {a.output || "Awaiting output"}
                              </pre>
                            </details>
                            <details>
                              <summary>Applied instructions</summary>
                              <code>{a.instructionHash}</code>
                              <pre className="output-text">
                                {a.instructions}
                              </pre>
                            </details>
                            <p>
                              Input tree <code>{a.inputTree}</code>
                            </p>
                            <p>
                              Output tree{" "}
                              <code>{a.outputTree || "Pending"}</code>
                            </p>
                            {a.worktree && (
                              <p>
                                Workspace <code>{a.worktree}</code>
                              </p>
                            )}
                          </details>
                        ))}
                      </section>
                    )}
                    <section>
                      <h4>SYSTEM · Execution contract</h4>
                      <dl>
                        <dt>Design</dt>
                        <dd>
                          <code>
                            {runtime?.binding.slice(0, 12) || "Pending"}
                          </code>
                        </dd>
                        <dt>Branch</dt>
                        <dd>{runtime?.branch || "Pending"}</dd>
                        <dt>Workspace</dt>
                        <dd>{runtime?.worktree || "Not prepared"}</dd>
                      </dl>
                      <details>
                        <summary>Full instructions at execution</summary>
                        <pre className="output-text">
                          {run.effectivePolicy || "No records"}
                        </pre>
                      </details>
                    </section>
                    {current && (
                      <section className="run-actions">
                        <h4>Controls · Latest run</h4>
                        {["failed", "interrupted"].includes(current.status) &&
                          current.runtime?.kind !== "planning" && (
                            <button
                              disabled={
                                !connected ||
                                busy ||
                                current.runtime?.terminationConfirmed !== true
                              }
                              title={
                                current.runtime?.terminationConfirmed !== true
                                  ? "Retry after the previous container's termination is confirmed."
                                  : "Start a new run with preserved changes."
                              }
                              onClick={() =>
                                void act(() =>
                                  window.roopre!.runAction(current.id, "retry"),
                                )
                              }
                            >
                              <RefreshCw size={13} />
                              Retry with preserved changes
                            </button>
                          )}
                        {(![
                          "cancelled",
                          "ready_for_merge",
                          "completed",
                        ].includes(current.status) ||
                          current.runtime?.terminationConfirmed === false) && (
                          <button
                            disabled={!connected || busy}
                            onClick={() =>
                              void act(() =>
                                send({ type: "cancel_run", runId: current.id }),
                              )
                            }
                          >
                            <Square size={12} />
                            Cancel run
                          </button>
                        )}
                        {current.status === "ready_for_merge" &&
                          current.runtime?.profile.gitHost &&
                          !current.runtime.delivery && (
                            <button
                              disabled={!connected || busy || !window.roopre}
                              onClick={() =>
                                void act(() =>
                                  window.roopre!.deliverRun({
                                    runId: current.id,
                                    title: feature.title,
                                    body: `Roopre verified run ${current.id}.\n\nDesign ${current.designId} passed fixed checks and independent review.`,
                                  }),
                                )
                              }
                            >
                              Publish branch · Create draft PR/MR
                            </button>
                          )}
                        <p>
                          {current.runtime?.delivery?.url ? (
                            <a
                              href={current.runtime.delivery.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open draft PR/MR
                            </a>
                          ) : current.status === "ready_for_merge" ? (
                            "Review the evidence, then publish or use your existing merge process. Merging is a separate action."
                          ) : (
                            "Retry and cancel apply to the latest run."
                          )}
                        </p>
                      </section>
                    )}
                  </div>
                </aside>
              </>
            )}
          </div>
          {output && (
            <ResizeHandle
              horizontal
              value={Math.min(height, outputLimit)}
              onChange={setHeight}
              min={120}
              max={outputLimit}
              label="Execution output height"
            />
          )}
          <section
            className={`execution-output ${output ? "expanded" : ""}`}
            style={
              {
                "--output-height": `${Math.min(height, outputLimit)}px`,
              } as React.CSSProperties
            }
            aria-label="Execution output"
          >
            <header>
              <button
                className="soft"
                onClick={() =>
                  tab === "flow"
                    ? setGraphOutput(!graphOutput)
                    : tab === "changes"
                      ? setDiffOutput(!diffOutput)
                      : setOutput(!defaultOutput)
                }
                aria-expanded={output}
              >
                <Terminal size={14} />
                Execution output{" "}
                {output ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
              {output && (
                <Tabs
                  label="Output type"
                  value={outputTab}
                  onChange={setOutputTab}
                  items={[
                    { id: "events", label: "Activity log" },
                    { id: "agent", label: "Agent results" },
                  ]}
                />
              )}
              <span>
                {run.id.slice(0, 8)} · Attempt {runtime?.attempt ?? 1}
              </span>
            </header>
            {output &&
              (outputTab === "events" ? (
                <EventLog key={run.id} events={runtime?.events || []} />
              ) : (
                <div
                  className="output-scroll"
                  tabIndex={0}
                  aria-label="Agent results"
                >
                  <pre className="output-text">
                    {agent?.output ||
                      agent?.error ||
                      "No completed results yet. Private reasoning is not displayed."}
                  </pre>
                </div>
              ))}
          </section>
        </>
      )}
    </div>
  );
}
