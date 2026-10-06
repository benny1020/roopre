import type { Run } from "./contracts.ts";
import type { AgentExecution } from "./harness.ts";
import { stages } from "./harness-stages.ts";
import { activeStatuses } from "./runtime.ts";
export type ExecutionGraphItem = {
  id: string;
  stage: (typeof stages)[number];
  name: string;
  detail: string;
  state: "idle" | "running" | "passed" | "failed" | "unknown";
  execution?: AgentExecution;
};
export function executionGraph(
  run: Run,
  connected: boolean,
): ExecutionGraphItem[] {
  const runtime = run.runtime;
  if (!runtime) return [];
  const records = (runtime.agents ?? []).filter(
    (a) => a.attempt === runtime.attempt,
  );
  const executing =
    activeStatuses.includes(run.status) && !runtime.cancelRequested;
  const observed: ExecutionGraphItem[] = records.map((a) => ({
    id: a.id,
    stage: a.stage,
    name: a.name,
    execution: a,
    state:
      a.status === "running"
        ? connected && executing
          ? "running"
          : "unknown"
        : a.status,
    detail:
      a.status === "running"
        ? !connected
          ? "Disconnected · last known state running"
          : executing
            ? "Running"
            : runtime.terminationConfirmed
              ? "Finished · result unconfirmed"
              : "Confirming termination"
        : a.status === "passed"
          ? "Completion record"
          : "Failed run",
  }));
  const pending = (runtime.harness?.agents ?? []).filter(
    (a) =>
      (runtime.kind === "planning"
        ? ["requirements", "design"]
        : ["implementation", "verification", "review"]
      ).includes(a.stage) && !records.some((r) => r.assignmentId === a.id),
  );
  return [
    ...observed,
    ...pending.map((a) => ({
      id: `pending-${a.id}`,
      stage: a.stage,
      name: a.agent.name,
      state: "idle" as const,
      detail: executing
        ? "Waiting for stage or parallel batch"
        : "No execution record for this attempt",
    })),
  ];
}

export function activeGraphStage(run: Run, connected: boolean) {
  if (
    !connected ||
    !activeStatuses.includes(run.status) ||
    run.runtime?.cancelRequested
  )
    return undefined;
  const agent = executionGraph(run, connected).find(
    (item) => item.state === "running",
  );
  if (agent) return agent.stage;
  if (run.runtime?.kind === "planning") return undefined;
  if (run.status === "verifying") return "verification" as const;
  if (run.status === "reviewing") return "review" as const;
  if (run.status === "implementing" || run.status === "repairing")
    return "implementation" as const;
  return undefined;
}
