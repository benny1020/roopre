import type { Feature, Run, Snapshot } from "../../../shared/contracts";
import { activeStatuses } from "../../../shared/runtime";

const statusLabel: Record<string, string> = {
  preparing: "환경 준비",
  implementing: "구현 중",
  verifying: "검증 중",
  reviewing: "AI 리뷰 중",
  repairing: "수정 중",
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
  owner: "사람" | "시스템";
  freshness: Freshness;
};

export type AttentionItem = {
  key: string;
  ref: PortfolioRef;
  reason: AttentionReason;
  title: string;
  detail: string;
  owner: "사람" | "시스템";
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
      "상태 정보 오류",
      "설계와 실행 기록의 연결을 확인하세요",
      "시스템",
    ] as const;
  if (!run) {
    if (gate.status === "in_review")
      return [
        1,
        "설계 승인 필요",
        "설계와 승인 조건을 확인하세요",
        "사람",
      ] as const;
    if (gate.status === "changes_requested" || gate.blockers)
      return [
        1,
        "수정 요청",
        "차단 의견과 수정 요청을 확인하세요",
        "사람",
      ] as const;
    return [
      gate.eligible ? 2 : 0,
      gate.eligible ? "개발 준비" : "설계 초안",
      gate.eligible
        ? "기존 실행 설정을 확인하세요"
        : "설계를 작성하고 리뷰를 요청하세요",
      "사람",
    ] as const;
  }
  if (run.runtime?.terminationConfirmed === false && !running.has(run.status))
    return [
      3,
      "종료 확인 중",
      "종료 확인 전 자동 재실행하지 않습니다",
      "시스템",
    ] as const;
  if (run.status === "queued")
    return [
      run.runtime?.kind === "planning" ? 1 : 2,
      "실행 대기",
      "실행기 확인을 기다립니다",
      "시스템",
    ] as const;
  if (run.status === "preparing")
    return [2, "환경 준비", "실행 환경을 준비하고 있습니다", "시스템"] as const;
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
      statusLabel[run.status] || "실행 중",
      agent && !run.runtime?.cancelRequested
        ? `${agent.name} 작업 기록을 확인하세요`
        : run.runtime?.cancelRequested
          ? "중단 요청 처리와 종료 확인을 기다립니다"
          : "실행기 상태를 기다립니다",
      "시스템",
    ] as const;
  }
  if (run.status === "ready_for_merge")
    return [
      4,
      "결과 검토 대기",
      "변경과 검증 결과를 검토하세요",
      "사람",
    ] as const;
  if (["failed", "interrupted", "blocked"].includes(run.status))
    return [
      2,
      run.status === "blocked" ? "승인 확인 필요" : "실패 기록",
      "실패 근거와 복구 조건을 확인하세요",
      "사람",
    ] as const;
  if (run.runtime?.kind === "planning")
    return [
      1,
      "계획 초안 작성 완료",
      "설계와 승인 조건을 검토하세요",
      "사람",
    ] as const;
  return [2, "실행 기록", "실행 결과를 확인하세요", "사람"] as const;
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
      owner: "사람" | "시스템",
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
        "상태 정보 연결 확인",
        item.feature.title,
        "시스템",
        "execution",
      );
    else {
      if (gate.status === "in_review")
        add("review", "설계 승인 필요", item.feature.title, "사람", "design");
      if (gate.status === "changes_requested" || gate.blockers)
        add(
          "changes",
          "차단 의견 또는 수정 요청",
          item.feature.title,
          "사람",
          "design",
        );
    }
    if (item.run?.status === "ready_for_merge")
      add("ready", "결과 검토 필요", item.feature.title, "사람", "review");
    if (["failed", "interrupted"].includes(item.run?.status || ""))
      add("failed", "실패 기록 확인", item.feature.title, "사람", "execution");
    if (item.run?.status === "blocked")
      add(
        "blocked",
        "승인 또는 정책 확인",
        item.feature.title,
        "사람",
        "design",
      );
    if (
      item.run?.runtime &&
      running.has(item.run.status) &&
      heartbeatFreshness(item.run.runtime.heartbeat, now) !== "fresh"
    )
      add(
        "stale",
        "실행 상태 확인 필요",
        item.feature.title,
        "시스템",
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
      title: "종료 확인 필요",
      detail: feature.title,
      owner: "시스템",
      destination: "execution",
    });
  }
  if (!snapshot.runnerConnected || freshness === "stale")
    attention.push({
      key: `workspace:${!snapshot.runnerConnected ? "runner" : "stale"}`,
      ref: { featureId: "" },
      reason: !snapshot.runnerConnected ? "runner" : "stale",
      title: !snapshot.runnerConnected
        ? "실행기 연결 확인 필요"
        : "화면 최신성 확인 필요",
      detail: acceptedAt || "마지막 성공 조회 없음",
      owner: "시스템",
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
