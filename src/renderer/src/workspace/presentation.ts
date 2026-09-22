import type { Feature, Snapshot } from "../../../shared/contracts";
import { activeStatuses } from "../../../shared/runtime";

export const runNames: Record<string, string> = {
  completed: "초안 작성 완료",
  queued: "실행 대기",
  preparing: "환경 준비",
  implementing: "구현 중",
  verifying: "검증 중",
  reviewing: "AI 리뷰",
  repairing: "수정 중",
  ready_for_merge: "결과 검토 대기",
  interrupted: "중단됨",
  failed: "실패",
  cancelled: "취소됨",
  blocked: "승인 확인 필요",
};
export const phases = ["요구사항", "설계", "구현", "검증", "결과 검토"];
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
    label:
      gate.status === "draft"
        ? "설계 초안"
        : gate.status === "changes_requested"
          ? "수정 요청"
          : gate.eligible
            ? "개발 준비"
            : "설계 리뷰",
    next: gate.eligible
      ? "승인된 설계로 개발을 시작하세요"
      : gate.blockers
        ? `차단 의견 ${gate.blockers}개를 해결하세요`
        : gate.status === "draft"
          ? "설계를 작성하고 리뷰를 요청하세요"
          : "설계와 승인 조건을 확인하세요",
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
      label: "종료 확인 중",
      next: "Docker 연결 복구 후 종료를 다시 확인합니다. 작업은 자동 재실행하지 않습니다",
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
          ? `계획 · ${runNames[run.status]}`
          : runNames[run.status],
      next: liveAgent
        ? `${liveAgent.name} 에이전트 작업 중`
        : run.runtime?.events.at(-1)?.message || "실행기 상태를 기다리는 중",
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
        ? "변경·검증 근거를 검토하세요. 병합은 별도입니다."
        : "실행 결과와 복구 조건을 확인하세요"),
    actor: "HUMAN",
    tone: run.status === "failed" ? "danger" : "attention",
    attention: true,
  };
}
