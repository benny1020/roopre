import { useEffect, useState } from "react";
import { Check, Circle, RefreshCw } from "lucide-react";
import type { Feature, Snapshot } from "../../../shared/contracts";
import { workflowIssues } from "../../../shared/harness";
import {
  executionProfileIssues,
  type ConnectionInfo,
} from "../../../shared/runtime";
export type SetupDestination = "connection" | "profile" | "agents" | "harness";
export default function ExecutionSetup({
  snapshot,
  feature,
  onSetup,
  onDesign,
}: {
  snapshot: Snapshot;
  feature: Feature;
  onSetup: (destination: SetupDestination) => void;
  onDesign: () => void;
}) {
  const [connections, setConnections] = useState<ConnectionInfo[]>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setConnections(undefined);
    setError("");
    void window.roopre
      ?.connections()
      .then((value) => {
        if (live) setConnections(value);
      })
      .catch(() => {
        if (live)
          setError(
            "Unable to load connections. Retry or open connection settings.",
          );
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  const project = snapshot.projects.find((p) => p.id === feature.projectId)!;
  const profile = project.executionProfile;
  const connection = connections?.find((c) => c.id === profile?.connectionId);
  const connectionCurrent =
    !!connection && connection.version === profile?.connectionVersion;
  const profileProblems = executionProfileIssues(profile, [
    ...snapshot.policies.at(-1)!.requiredChecks,
    ...project.requiredChecks,
  ]);
  const flowProblems = workflowIssues(snapshot, project);
  const gate = snapshot.gates[feature.id];
  const rows = [
    {
      name: "Project AI connection",
      done: connectionCurrent && connection?.testStatus === "passed",
      detail:
        error ||
        (connections === undefined
          ? "Checking saved connections…"
          : !connections.length
            ? "Add an API key and endpoint in the app."
            : !profile
              ? `Connection ${connections.length} registered · Choose a connection in the execution profile.`
              : !connection
                ? "No connection assigned to this project. Register one and save the execution profile again."
                : !connectionCurrent
                  ? "Connection version changed. Save the execution profile again."
                  : `${connection.name} · ${connection.model} · ${connection.testStatus === "passed" ? "Last connection test passed" : connection.testStatus === "failed" ? "Last test failed · Check connection settings" : "Not tested"}`),
      action:
        connection && !connectionCurrent
          ? "Refresh connection version"
          : connection && connection.testStatus !== "passed"
            ? "Test AI connection"
            : "AI connections",
      run: () =>
        onSetup(connection && !connectionCurrent ? "profile" : "connection"),
    },
    {
      name: "Repository & fixed checks",
      done: profileProblems.length === 0,
      detail:
        profileProblems.join(" ") ||
        `${profile!.baseBranch} · Checks ${profile!.checks.length} · ${profile!.repositoryPath}`,
      action: "Configure execution profile",
      run: () => onSetup("profile"),
    },
    {
      name: "Agent workflow",
      done: !!project.workflow && !flowProblems.length,
      detail:
        flowProblems.join(" ") ||
        (project.workflow
          ? `Saved workflow v${project.workflow.revision} · Roles ${project.workflow.assignments.length}`
          : "Configure planning agents to prepare requirements and designs. Without a workflow, the default implementation and review roles are used."),
      action: project.harness
        ? "Configure shared standard"
        : "Configure workflow",
      run: () => onSetup(project.harness ? "harness" : "agents"),
    },
    {
      name: "Design review & approval",
      done: gate.eligible,
      detail: gate.eligible
        ? "The current approval gate is satisfied. It is checked again at execution."
        : gate.reasons.join(" "),
      action: "Open design review",
      run: onDesign,
    },
  ];
  return (
    <section className="execution-setup" aria-label="Execution readiness">
      <header>
        <div>
          <h2>Prepare your first run</h2>
          <p>Check settings for {project.name}, then review the design.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Recheck AI connections"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <ol>
        {rows.map((row) => (
          <li key={row.name}>
            <span
              role="img"
              className={`setup-indicator ${row.done ? "is-configured" : ""}`}
              aria-label={row.done ? "Configured" : "Needs attention"}
            >
              {row.done ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Circle size={15} aria-hidden="true" />
              )}
            </span>
            <div>
              <h3>{row.name}</h3>
              <p>{row.detail}</p>
            </div>
            <button onClick={row.run}>{row.action}</button>
          </li>
        ))}
      </ol>
      <p className="setup-footnote">
        These are saved settings. Model availability, Docker readiness and
        approvals are rechecked at execution. This screen does not approve or
        start work.
      </p>
    </section>
  );
}
