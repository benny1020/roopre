import type { Feature, Snapshot } from "../../../shared/contracts";
import { activeStatuses } from "../../../shared/runtime";

export const runNames: Record<string, string> = {
  completed: "Draft complete",
  queued: "Queued",
  preparing: "Environment setup",
  implementing: "Implementing",
  verifying: "Verifying",
  reviewing: "AI review",
  repairing: "Repairing",
  ready_for_merge: "Ready for review",
  interrupted: "Interrupted",
  failed: "Failed",
  cancelled: "Cancelled",
  blocked: "Approval required",
};
export const phases = [
  "Requirements",
  "Design",
  "Implementation",
  "Verification",
  "Result review",
];
export type WorkState = {
  phase: number;
  label: string;
  next: string;
  tone: "quiet" | "active" | "attention" | "danger";
  actor: "HUMAN" | "AGENT" | "SYSTEM";
  attention: boolean;
};
export function workState(snapshot: Snapshot, feature: Feature): WorkState {
  const gate = snapshot.gates[feature.id];
  const run = snapshot.runs.filter((r) => r.featureId === feature.id).at(-1);
  const base: WorkState = {
    phase: feature.draft.requirements.trim() ? 1 : 0,
    label: !feature.draft.requirements.trim()
      ? "Define intent"
      : gate.status === "draft"
        ? "Design draft"
        : gate.status === "changes_requested"
          ? "Changes requested"
          : gate.eligible
            ? "Ready to build"
            : "Design review",
    next: !feature.draft.requirements.trim()
      ? "Add requirements and acceptance criteria"
      : gate.eligible
        ? "Start implementation with the approved design"
        : gate.blockers
          ? `Resolve ${countLabel(gate.blockers, "blocking comment")}`
          : gate.status === "draft"
            ? "Write a design and request review"
            : "Review design and approvals",
    tone: gate.blockers ? "attention" : "quiet",
    actor: "HUMAN",
    attention:
      gate.blockers > 0 ||
      gate.status === "in_review" ||
      gate.status === "changes_requested",
  };
  if (
    run &&
    !activeStatuses.includes(run.status) &&
    run.runtime?.terminationConfirmed === false
  )
    return {
      phase: 2,
      label: "Confirming termination",
      next: "Recheck termination after Docker reconnects. Work will not restart automatically",
      actor: "SYSTEM",
      tone: "attention",
      attention: true,
    };
  if (!run || ["completed", "cancelled"].includes(run.status)) return base;
  const liveAgent = run.runtime?.agents?.find(
    (a) => a.status === "running" && a.attempt === run.runtime?.attempt,
  );
  const phase =
    run.runtime?.kind === "planning" || run.status === "blocked"
      ? 1
      : ["verifying", "reviewing"].includes(run.status)
        ? 3
        : run.status === "ready_for_merge"
          ? 4
          : 2;
  if (activeStatuses.includes(run.status))
    return {
      phase,
      label:
        run.runtime?.kind === "planning"
          ? `Planning · ${runNames[run.status]}`
          : runNames[run.status],
      next: liveAgent
        ? `${liveAgent.name} is working`
        : run.runtime?.events.at(-1)?.message || "Waiting for runner status",
      actor: ["queued", "preparing", "verifying"].includes(run.status)
        ? "SYSTEM"
        : "AGENT",
      tone: "active",
      attention: false,
    };
  return {
    phase,
    label: runNames[run.status] || run.status,
    next:
      run.reason ||
      (run.status === "ready_for_merge"
        ? "Review changes and verification evidence. Merge is a separate action."
        : "Inspect execution results and recovery requirements"),
    actor: "HUMAN",
    tone: run.status === "failed" ? "danger" : "attention",
    attention: true,
  };
}

export const countLabel = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
