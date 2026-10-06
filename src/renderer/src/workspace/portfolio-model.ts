import type { Feature, Run, Snapshot } from "../../../shared/contracts";
import { activeStatuses } from "../../../shared/runtime";

const statusLabel: Record<string, string> = {
  preparing: "Environment setup",
  implementing: "Implementing",
  verifying: "Verifying",
  reviewing: "AI reviewing",
  repairing: "Repairing",
};

export type PortfolioRef = {
  featureId: string;
  runId?: string;
  attempt?: number;
  agentExecutionId?: string;
};

export type Freshness = "fresh" | "stale" | "unknown";
export type AttentionReason =
  | "review"
  | "changes"
  | "ready"
  | "failed"
  | "blocked"
  | "termination"
  | "runner"
  | "stale";

export type PortfolioItem = {
  ref: PortfolioRef;
  feature: Feature;
  run?: Run;
  phase: number;
  label: string;
  next: string;
  owner: "Human" | "System";
  freshness: Freshness;
};

export type AttentionItem = {
  key: string;
  ref: PortfolioRef;
  reason: AttentionReason;
  title: string;
  detail: string;
  owner: "Human" | "System";
  destination: "design" | "execution" | "review";
};

export type AgentCard = {
  key: string;
  ref: Required<PortfolioRef>;
  name: string;
  model: string;
  revision: number;
  stage: string;
  status: "running" | "stale" | "residual" | "stopping";
  projectName: string;
  featureTitle: string;
};

export type PortfolioProjection = {
  items: PortfolioItem[];
  attention: AttentionItem[];
  agents: AgentCard[];
  queued: number;
  occupied: number;
  terminationPending: number;
  activeAgents: number;
  reportedCost: number;
  reportedRuns: number;
  unreportedRuns: number;
  invalidCostRuns: number;
  freshness: Freshness;
  snapshotAt?: string;
};

const running = new Set(activeStatuses.filter((status) => status !== "queued"));
const terminal = new Set([
  "completed",
  "ready_for_merge",
  "failed",
  "cancelled",
  "interrupted",
  "blocked",
]);
const time = (value?: string) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const heartbeatFreshness = (
  heartbeat: string | undefined,
  now: number,
): Freshness => {
  const at = time(heartbeat);
  if (at === undefined || at > now + 5000) return "unknown";
  return now - at > 30000 ? "stale" : "fresh";
};
export const snapshotFreshness = (
  acceptedAt: string | undefined,
  error: string,
  now: number,
): Freshness => {
  if (error) return "stale";
  const at = time(acceptedAt);
  if (at === undefined) return "unknown";
  return now - at > 5000 ? "stale" : "fresh";
};

export function describePortfolioRun(
  run: Run | undefined,
  feature: Feature,
  snapshot: Snapshot,
) {
  const gate = snapshot.gates[feature.id];
  if (!gate)
    return [
      0,
      "Status data error",
      "Check the link between design and run records",
      "System",
    ] as const;
  if (!run) {
    if (gate.status === "in_review")
      return [
        1,
        "Design approval required",
        "Check the design and approval requirements",
        "Human",
      ] as const;
    if (gate.status === "changes_requested" || gate.blockers)
      return [
        1,
        "Changes requested",
        "Review blocking comments and change requests",
        "Human",
      ] as const;
    return [
      gate.eligible ? 2 : 0,
      gate.eligible ? "Ready to build" : "Design draft",
      gate.eligible
        ? "Check execution settings"
        : "Write a design and request review",
      "Human",
    ] as const;
  }
  if (run.runtime?.terminationConfirmed === false && !running.has(run.status))
    return [
      3,
      "Confirming termination",
      "No automatic restart before termination is confirmed",
      "System",
    ] as const;
  if (run.status === "queued")
    return [
      run.runtime?.kind === "planning" ? 1 : 2,
      "Queued",
      "Waiting for the runner",
      "System",
    ] as const;
  if (run.status === "preparing")
    return [
      2,
      "Environment setup",
      "Preparing the execution environment",
      "System",
    ] as const;
  if (running.has(run.status)) {
    const agent = run.runtime?.agents?.find(
      (candidate) =>
        candidate.attempt === run.runtime?.attempt &&
        candidate.status === "running",
    );
    return [
      run.runtime?.kind === "planning"
        ? 1
        : run.status === "verifying" || run.status === "reviewing"
          ? 3
          : 2,
      statusLabel[run.status] || "Running",
      agent && !run.runtime?.cancelRequested
        ? `Inspect ${agent.name}'s execution record`
        : run.runtime?.cancelRequested
          ? "Waiting for stop and termination confirmation"
          : "Waiting for runner status",
      "System",
    ] as const;
  }
  if (run.status === "ready_for_merge")
    return [
      4,
      "Ready for review",
      "Review changes and verification results",
      "Human",
    ] as const;
  if (["failed", "interrupted", "blocked"].includes(run.status))
    return [
      2,
      run.status === "blocked" ? "Approval required" : "Failed run",
      "Inspect failure evidence and recovery requirements",
      "Human",
    ] as const;
  if (run.runtime?.kind === "planning")
    return [
      1,
      "Plan drafted",
      "Review the design and approval requirements",
      "Human",
    ] as const;
  return [2, "Run history", "Inspect execution results", "Human"] as const;
}

/**
 * A run can be the latest attempt of its own record while still being an older
 * execution for the feature. Keep this identity check shared by the renderer
 * and its regression tests so the inspector never calls that record current.
 */
export function isHistoricalPortfolioRun(
  snapshot: Snapshot,
  featureId: string,
  run: Run,
  attempt: number | undefined,
) {
  const latest = snapshot.runs
    .filter((candidate) => candidate.featureId === featureId)
    .at(-1);
  return latest?.id !== run.id || attempt !== run.runtime?.attempt;
}

export function projectPortfolio(
  snapshot: Snapshot,
  acceptedAt: string | undefined,
  fetchError: string,
  now: number,
): PortfolioProjection {
  const freshness = snapshotFreshness(acceptedAt, fetchError, now);
  const items = snapshot.features.map((feature) => {
    const run = snapshot.runs
      .filter((candidate) => candidate.featureId === feature.id)
      .at(-1);
    const [phase, label, next, owner] = describePortfolioRun(
      run,
      feature,
      snapshot,
    );
    return {
      ref: {
        featureId: feature.id,
        runId: run?.id,
        attempt: run?.runtime?.attempt,
      },
      feature,
      run,
      phase,
      label,
      next,
      owner,
      freshness,
    };
  });
  const runtimeRuns = snapshot.runs.filter((run) => !!run.runtime);
  const queued = runtimeRuns.filter((run) => run.status === "queued").length;
  const occupied = runtimeRuns.filter(
    (run) =>
      run.runtime?.terminationConfirmed === false ||
      (running.has(run.status) && run.status !== "queued"),
  ).length;
  const terminationPending = runtimeRuns.filter(
    (run) =>
      terminal.has(run.status) && run.runtime?.terminationConfirmed === false,
  ).length;
  const agents: AgentCard[] = [];
  for (const run of runtimeRuns) {
    const runtime = run.runtime!;
    const activeRun =
      running.has(run.status) &&
      run.status !== "queued" &&
      !runtime.cancelRequested;
    for (const agent of runtime.agents || []) {
      if (agent.attempt !== runtime.attempt || agent.status !== "running")
        continue;
      const feature = snapshot.features.find(
        (candidate) => candidate.id === run.featureId,
      );
      const project =
        feature &&
        snapshot.projects.find(
          (candidate) => candidate.id === feature.projectId,
        );
      if (!feature || !project) continue;
      const health = heartbeatFreshness(runtime.heartbeat, now);
      agents.push({
        key: `${run.id}:${runtime.attempt}:${agent.id}`,
        ref: {
          featureId: feature.id,
          runId: run.id,
          attempt: runtime.attempt,
          agentExecutionId: agent.id,
        },
        name: agent.name,
        model: agent.model,
        revision: agent.revision,
        stage: agent.stage,
        status: runtime.cancelRequested
          ? "stopping"
          : !activeRun
            ? "residual"
            : health === "fresh" &&
                freshness === "fresh" &&
                snapshot.runnerConnected
              ? "running"
              : "stale",
        projectName: project.name,
        featureTitle: feature.title,
      });
    }
  }
  const attention: AttentionItem[] = [];
  for (const item of items) {
    const gate = snapshot.gates[item.feature.id];
    const add = (
      reason: AttentionReason,
      title: string,
      detail: string,
      owner: "Human" | "System",
      destination: AttentionItem["destination"],
    ) =>
      attention.push({
        key: `${item.feature.id}:${item.run?.id || ""}:${item.run?.runtime?.attempt || ""}:${reason}`,
        ref: item.ref,
        reason,
        title,
        detail,
        owner,
        destination,
      });
    if (!gate)
      add(
        "blocked",
        "Check status data",
        item.feature.title,
        "System",
        "execution",
      );
    else {
      if (gate.status === "in_review")
        add(
          "review",
          "Design approval required",
          item.feature.title,
          "Human",
          "design",
        );
      if (gate.status === "changes_requested" || gate.blockers)
        add(
          "changes",
          "Blocking comments or changes requested",
          item.feature.title,
          "Human",
          "design",
        );
    }
    if (item.run?.status === "ready_for_merge")
      add(
        "ready",
        "Results need review",
        item.feature.title,
        "Human",
        "review",
      );
    if (["failed", "interrupted"].includes(item.run?.status || ""))
      add(
        "failed",
        "Inspect failed run",
        item.feature.title,
        "Human",
        "execution",
      );
    if (item.run?.status === "blocked")
      add(
        "blocked",
        "Check approvals or policies",
        item.feature.title,
        "Human",
        "design",
      );
    if (
      item.run?.runtime &&
      running.has(item.run.status) &&
      heartbeatFreshness(item.run.runtime.heartbeat, now) !== "fresh"
    )
      add(
        "stale",
        "Confirm execution status",
        item.feature.title,
        "System",
        "execution",
      );
  }
  for (const run of runtimeRuns) {
    if (!(
      terminal.has(run.status) && run.runtime?.terminationConfirmed === false
    ))
      continue;
    const feature = snapshot.features.find(
      (candidate) => candidate.id === run.featureId,
    );
    if (!feature) continue;
    attention.push({
      key: `${feature.id}:${run.id}:${run.runtime?.attempt || ""}:termination`,
      ref: {
        featureId: feature.id,
        runId: run.id,
        attempt: run.runtime?.attempt,
      },
      reason: "termination",
      title: "Confirm termination",
      detail: feature.title,
      owner: "System",
      destination: "execution",
    });
  }
  if (!snapshot.runnerConnected || freshness === "stale")
    attention.push({
      key: `workspace:${!snapshot.runnerConnected ? "runner" : "stale"}`,
      ref: { featureId: "" },
      reason: !snapshot.runnerConnected ? "runner" : "stale",
      title: !snapshot.runnerConnected
        ? "Check runner connection"
        : "Check workspace freshness",
      detail: acceptedAt || "No successful sync yet",
      owner: "System",
      destination: "execution",
    });
  const reported = runtimeRuns.filter(
    (run) =>
      run.runtime!.costReported === true &&
      Number.isFinite(run.runtime!.costUsd) &&
      run.runtime!.costUsd >= 0,
  );
  return {
    items,
    attention,
    agents,
    queued,
    occupied,
    terminationPending,
    activeAgents: agents.filter((agent) => agent.status === "running").length,
    reportedCost: reported.reduce(
      (total, run) => total + run.runtime!.costUsd,
      0,
    ),
    reportedRuns: reported.length,
    unreportedRuns: runtimeRuns.filter((run) => !run.runtime!.costReported)
      .length,
    invalidCostRuns: runtimeRuns.filter(
      (run) =>
        run.runtime!.costReported === true &&
        (!Number.isFinite(run.runtime!.costUsd) || run.runtime!.costUsd < 0),
    ).length,
    freshness,
    snapshotAt: acceptedAt,
  };
}
