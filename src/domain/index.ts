import {
  latestAgents,
  resolveHarness,
  workflowIssues,
} from "../shared/harness.ts";
import { policyBinding, approvalBinding } from "./runtime.ts";
import { activeStatuses, executionProfileIssues } from "../shared/runtime.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  sections,
  gate,
  latestDesign,
  type Workspace,
  type Command,
  type Feature,
  type Person,
} from "../shared/contracts.ts";

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
function requireThat(
  test: unknown,
  code: string,
  message: string,
  status = 409,
): asserts test {
  if (!test) throw new DomainError(code, message, status);
}
const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;
export const draftTemplate = (title: string) =>
  `## 요구사항\n${title}\n\n## 구조\n기존 구성 요소와 변경 책임을 작성하세요.\n\n## API·데이터\n입력·출력 계약과 데이터 변경을 작성하세요.\n\n## 예외 상황\n실패·중복 요청·권한 처리를 작성하세요.\n\n## 변경 영향\n관련 기능과 의존성을 작성하세요.\n\n## 검증 계획\n수용 기준별 검증 방법을 작성하세요.\n\n## 적용·복구\n적용 순서와 필요한 복구 방법을 작성하세요.`;

function person(w: Workspace, actorId: string): Person {
  const p = w.people.find((p) => p.id === actorId && p.teamId === w.teamId);
  requireThat(p, "forbidden", "이 팀에 접근할 수 없습니다.", 403);
  return p;
}
function reviewers(w: Workspace, ids: string[]) {
  requireThat(
    new Set(ids).size === ids.length,
    "reviewers_duplicate",
    "검토자가 중복됐습니다.",
  );
  for (const id of ids)
    requireThat(
      person(w, id).role !== "agent",
      "human_required",
      "필수 검토자는 개발자여야 합니다.",
    );
}
export function effectivePolicy(w: Workspace, f: Feature) {
  const p = w.policies.at(-1)!;
  const project = w.projects.find((p) => p.id === f.projectId)!;
  return `전역 v${p.version}\n${p.global}\n\n프로젝트: ${project.name}\n${project.instructions || "추가 지침 없음"}\n필수 검사: ${[...new Set([...p.requiredChecks, ...project.requiredChecks])].join(", ")}\n\n설계 단계\n${p.design}\n\n구현 단계\n${p.implementation}\n\n리뷰 역할\n${p.reviewer}\n\n이번 기능\n${latestDesign(f)?.requirements || f.draft.requirements}`;
}

export function apply(
  w: Workspace,
  actorId: string,
  c: Command,
  proof?: { binding: string; authentication: "macos-owner" },
): { featureId?: string; entityId?: string } {
  const actor = person(w, actorId);
  requireThat(
    actor.role !== "agent",
    "human_required",
    "에이전트는 사람의 승인·정책·실행 제어를 수행할 수 없습니다.",
    403,
  );
  const stamp = now();
  let f: Feature | undefined;
  if ("featureId" in c) {
    f = w.features.find((f) => f.id === c.featureId);
    requireThat(f, "not_found", "기능을 찾을 수 없습니다.", 404);
  }
  const canEdit = () =>
    requireThat(
      f && (actor.id === f.authorId || actor.role === "admin"),
      "forbidden",
      "담당 개발자만 설계를 수정할 수 있습니다.",
      403,
    );
  let entityId: string | undefined;
  switch (c.type) {
    case "save_agent": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "관리자만 에이전트를 수정할 수 있습니다.",
        403,
      );
      const old = latestAgents(w).find((a) => a.id === c.agent.id);
      requireThat(
        (old?.revision ?? 0) === c.expectedRevision &&
          c.agent.revision === c.expectedRevision + 1,
        "revision_conflict",
        "에이전트가 변경됐습니다. 최신 버전을 다시 여세요.",
      );
      requireThat(
        !c.agent.projectId ||
          w.projects.some((p) => p.id === c.agent.projectId),
        "not_found",
        "프로젝트가 없습니다.",
      );
      requireThat(
        !c.agent.connectionId || c.agent.connectionVersion,
        "connection_required",
        "연결 버전을 확인하세요.",
      );
      w.agents ??= [];
      w.agents.push(structuredClone(c.agent));
      for (const p of w.projects.filter((p) =>
        p.workflow?.assignments.some((a) => a.agentId === c.agent.id),
      )) {
        for (const f of w.features.filter((f) => f.projectId === p.id))
          if (latestDesign(f)) latestDesign(f)!.decisions = [];
        for (const r of w.runs.filter(
          (r) =>
            activeStatuses.includes(r.status) &&
            w.features.find((f) => f.id === r.featureId)?.projectId === p.id,
        )) {
          r.status = "blocked";
          r.reason = "사용 중인 에이전트가 변경됐습니다. 설계를 재승인하세요.";
        }
      }
      entityId = c.agent.id;
      break;
    }
    case "save_workflow": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "관리자만 개발 흐름을 수정할 수 있습니다.",
        403,
      );
      const p = w.projects.find((p) => p.id === c.projectId);
      requireThat(p, "not_found", "프로젝트가 없습니다.");
      requireThat(
        (p.workflow?.revision ?? 0) === c.expectedRevision &&
          c.workflow.revision === c.expectedRevision + 1,
        "revision_conflict",
        "개발 흐름이 변경됐습니다. 최신 버전을 다시 여세요.",
      );
      const issues = workflowIssues(w, p, c.workflow);
      requireThat(!issues.length, "invalid_workflow", issues.join(" "));
      p.workflow = structuredClone(c.workflow);
      for (const f of w.features.filter((f) => f.projectId === p.id))
        if (latestDesign(f)) latestDesign(f)!.decisions = [];
      for (const r of w.runs.filter(
        (r) =>
          activeStatuses.includes(r.status) &&
          w.features.find((f) => f.id === r.featureId)?.projectId === p.id,
      )) {
        r.status = "blocked";
        r.reason = "개발 흐름이 변경됐습니다. 설계를 재승인하세요.";
      }
      break;
    }
    case "queue_planning": {
      canEdit();
      requireThat(
        w.mode === "local-owner",
        "desktop_required",
        "맥 앱에서 실행하세요.",
      );
      requireThat(
        f!.draft.revision === c.expectedRevision,
        "revision_conflict",
        "초안이 변경됐습니다.",
      );
      const p = w.projects.find((p) => p.id === f!.projectId)!;
      requireThat(
        p.executionProfile,
        "profile_required",
        "프로젝트 실행 프로필을 먼저 설정하세요.",
      );
      const harness = resolveHarness(w, p);
      requireThat(
        harness?.agents.some(
          (a) => a.stage === "requirements" || a.stage === "design",
        ),
        "planning_required",
        "요구사항 또는 설계 에이전트를 배치하세요.",
      );
      requireThat(
        !w.runs.some(
          (r) =>
            r.featureId === f!.id &&
            (activeStatuses.includes(r.status) ||
              r.runtime?.terminationConfirmed === false),
        ),
        "duplicate_run",
        "진행 중인 실행을 먼저 종료하세요.",
      );
      entityId = uid("run");
      w.runs.push({
        id: entityId,
        featureId: f!.id,
        designId: `draft-${f!.draft.revision}`,
        status: "queued",
        reason: "읽기 전용 요구사항·설계 준비",
        at: stamp,
        actorId,
        policyVersion: w.policies.at(-1)!.version,
        effectivePolicy: effectivePolicy(w, f!),
        runtime: {
          kind: "planning",
          draftRevision: f!.draft.revision,
          harness,
          agents: [],
          profile: structuredClone(p.executionProfile),
          binding: policyBinding(w, f!),
          attempt: 0,
          costUsd: 0,
          costEstimated: true,
          events: [],
          evidence: [],
        },
      });
      break;
    }
    case "configure_execution": {
      requireThat(
        w.mode === "local-owner" && actor.role === "admin",
        "forbidden",
        "맥 앱 소유자만 실행 환경을 설정할 수 있습니다.",
        403,
      );
      const p = w.projects.find((p) => p.id === c.projectId);
      requireThat(p, "not_found", "프로젝트가 없습니다.", 404);
      requireThat(
        !w.runs.some(
          (r) =>
            activeStatuses.includes(r.status) &&
            w.features.find((f) => f.id === r.featureId)?.projectId === p.id,
        ),
        "active_run",
        "실행을 먼저 취소하세요.",
      );
      const issues = executionProfileIssues(c.profile, [
        ...w.policies.at(-1)!.requiredChecks,
        ...p.requiredChecks,
      ]);
      requireThat(!issues.length, "missing_checks", issues.join(" "));
      p.executionProfile = c.profile;
      for (const f of w.features.filter((f) => f.projectId === p.id))
        if (latestDesign(f)) latestDesign(f)!.decisions = [];
      break;
    }
    case "create_project": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "관리자만 프로젝트를 만들 수 있습니다.",
        403,
      );
      reviewers(w, w.mode === "local-owner" ? [actorId] : c.reviewerIds);
      entityId = uid("project");
      w.projects.push({
        id: entityId,
        name: c.name.trim(),
        description: c.description,
        color: "#477CC9",
        reviewerIds: w.mode === "local-owner" ? [actorId] : c.reviewerIds,
        ownerId: w.mode === "local-owner" ? actorId : undefined,
        requiredChecks: [...w.policies.at(-1)!.requiredChecks],
      });
      break;
    }
    case "create_feature": {
      requireThat(
        w.projects.some((p) => p.id === c.projectId),
        "not_found",
        "프로젝트를 찾을 수 없습니다.",
        404,
      );
      f = {
        id: uid("feature"),
        projectId: c.projectId,
        title: c.title.trim(),
        template: c.template,
        authorId: actor.id,
        createdAt: stamp,
        updatedAt: stamp,
        draft: {
          revision: 0,
          body: draftTemplate(c.title),
          requirements: c.requirements,
        },
        designs: [],
        threads: [],
        dependencies: [],
      };
      w.features.push(f);
      entityId = f.id;
      break;
    }
    case "save_draft": {
      canEdit();
      requireThat(
        f!.draft.revision === c.expectedRevision,
        "revision_conflict",
        "다른 변경이 먼저 저장됐습니다. 내 초안을 보존하고 최신 버전을 확인하세요.",
      );
      f!.draft = {
        revision: c.expectedRevision + 1,
        body: c.body,
        requirements: c.requirements,
      };
      break;
    }
    case "publish_design": {
      canEdit();
      requireThat(
        f!.draft.revision === c.expectedRevision,
        "revision_conflict",
        "초안이 변경됐습니다. 최신 초안을 확인하세요.",
      );
      const p = w.projects.find((p) => p.id === f!.projectId)!;
      const independentReviewers = p.reviewerIds.filter(
        (id) => w.mode === "local-owner" || id !== f!.authorId,
      );
      requireThat(
        independentReviewers.length > 0,
        "independent_reviewer_required",
        "작성자 이외의 개발자를 필수 검토자로 지정하세요.",
      );
      requireThat(
        sections.every((s) => f!.draft.body.includes(`## ${s}\n`)),
        "missing_sections",
        "설계의 필수 검토 항목 7개를 모두 포함하세요.",
      );
      requireThat(
        !f!.draft.body.includes("작성하세요."),
        "incomplete_design",
        "안내 문구를 실제 설계로 채운 뒤 리뷰를 요청하세요.",
      );
      if (w.mode === "local-owner") {
        const issues = executionProfileIssues(p.executionProfile, [
          ...w.policies.at(-1)!.requiredChecks,
          ...p.requiredChecks,
        ]);
        requireThat(!issues.length, "missing_checks", issues.join(" "));
        requireThat(
          p.executionProfile,
          "profile_required",
          "저장소와 실행 프로필을 먼저 연결하세요.",
        );
        requireThat(
          /AC[- ]?\d+/i.test(f!.draft.requirements),
          "acceptance_required",
          "요구사항에 AC01 등 식별 가능한 완료 기준을 포함하세요.",
        );
      }
      entityId = uid("design");
      f!.designs.push({
        id: entityId,
        number: f!.designs.length + 1,
        body: f!.draft.body,
        requirements: f!.draft.requirements,
        hash: createHash("sha256")
          .update(f!.draft.body + "\n" + f!.draft.requirements)
          .digest("hex"),
        at: stamp,
        policyVersion: w.policies.at(-1)!.version,
        reviewers: independentReviewers,
        decisions: [],
        policyBinding:
          w.mode === "local-owner" ? policyBinding(w, f!) : undefined,
      });
      break;
    }
    case "add_thread": {
      requireThat(
        f!.designs.some((d) => d.id === c.designId),
        "not_found",
        "설계 버전을 찾을 수 없습니다.",
        404,
      );
      requireThat(
        c.designId === latestDesign(f!)!.id,
        "stale_design",
        "이전 버전에는 새 의견을 추가할 수 없습니다. 최신 설계에서 검토하세요.",
      );
      entityId = uid("thread");
      f!.threads.push({
        id: entityId,
        designId: c.designId,
        section: c.section,
        quote: c.quote,
        authorId: actor.id,
        body: c.body,
        blocking: c.blocking,
        status: "open",
        replies: [],
        at: stamp,
      });
      if (c.blocking) latestDesign(f!)!.decisions = [];
      break;
    }
    case "reply_thread":
    case "address_thread":
    case "resolve_thread": {
      const thread = f!.threads.find((t) => t.id === c.threadId);
      requireThat(thread, "not_found", "리뷰 의견을 찾을 수 없습니다.", 404);
      if (c.type === "reply_thread")
        thread.replies.push({ actorId: actor.id, body: c.body, at: stamp });
      if (c.type === "address_thread") {
        canEdit();
        requireThat(
          thread.status !== "resolved",
          "already_resolved",
          "이미 해결 확인된 의견입니다.",
        );
        thread.status = "addressed";
      }
      if (c.type === "resolve_thread") {
        requireThat(
          (w.mode === "local-owner" || actor.id !== f!.authorId) &&
            latestDesign(f!)?.reviewers.includes(actor.id),
          "reviewer_required",
          "작성자 이외의 필수 검토자만 해결을 확인할 수 있습니다.",
          403,
        );
        thread.status = "resolved";
        thread.resolvedBy = actor.id;
      }
      break;
    }
    case "review": {
      const d = latestDesign(f!);
      requireThat(
        d && d.id === c.designId,
        "stale_design",
        "설계가 변경됐습니다. 최신 버전을 다시 검토하세요.",
      );
      requireThat(
        (w.mode === "local-owner" || actor.id !== f!.authorId) &&
          d.reviewers.includes(actor.id),
        "reviewer_required",
        "이 설계의 필수 검토자만 승인·수정 요청할 수 있습니다.",
        403,
      );
      if (c.decision === "approve") {
        if (w.mode === "local-owner") {
          const project = w.projects.find((p) => p.id === f!.projectId)!;
          const issues = executionProfileIssues(project.executionProfile, [
            ...w.policies.at(-1)!.requiredChecks,
            ...project.requiredChecks,
          ]);
          requireThat(!issues.length, "missing_checks", issues.join(" "));
          requireThat(
            proof?.authentication === "macos-owner" &&
              proof.binding === approvalBinding(w, f!),
            "owner_auth_required",
            "이 설계에 대해 macOS 본인 확인을 완료하세요.",
            403,
          );
          requireThat(
            d.policyBinding === policyBinding(w, f!),
            "profile_changed",
            "실행 계약이 변경됐습니다. 새 설계를 게시하세요.",
          );
        }
        requireThat(
          d.policyVersion === w.policies.at(-1)!.version,
          "policy_changed",
          "지침이 변경되어 새 설계 게시가 필요합니다.",
        );
        requireThat(
          sections.every((s) => c.checked.includes(s)),
          "checklist_incomplete",
          "검토 항목 7개를 모두 확인하세요.",
        );
        requireThat(
          !f!.threads.some((t) => t.blocking && t.status !== "resolved"),
          "unresolved_threads",
          "차단 의견의 해결 확인이 필요합니다.",
        );
      }
      d.decisions = d.decisions.filter((x) => x.actorId !== actor.id);
      d.decisions.push({
        actorId: actor.id,
        decision: c.decision,
        checked: [...new Set(c.checked)],
        binding: c.decision === "approve" ? proof?.binding : undefined,
        authentication:
          c.decision === "approve" ? proof?.authentication : undefined,
        at: stamp,
      });
      break;
    }
    case "queue_run": {
      canEdit();
      const d = latestDesign(f!);
      requireThat(
        d && d.id === c.designId,
        "stale_design",
        "실행 대상 설계가 최신 버전이 아닙니다.",
      );
      if (w.mode === "local-owner")
        requireThat(
          d.decisions.some(
            (x) =>
              x.actorId ===
                w.projects.find((p) => p.id === f!.projectId)!.ownerId &&
              x.decision === "approve" &&
              x.binding === approvalBinding(w, f!),
          ),
          "stale_approval",
          "승인 계약이 일치하지 않습니다.",
        );
      const g = gate(w, f!);
      requireThat(g.eligible, "design_gate", g.reasons.join(" "));
      requireThat(
        !w.runs.some(
          (r) =>
            r.featureId === f!.id &&
            ([...activeStatuses, "blocked", "interrupted"].includes(r.status) ||
              r.runtime?.terminationConfirmed === false),
        ),
        "duplicate_run",
        "이미 실행 대기 중인 기능입니다.",
      );
      entityId = uid("run");
      w.runs.push({
        id: entityId,
        featureId: f!.id,
        designId: d.id,
        status: "queued",
        runtime:
          w.mode === "local-owner"
            ? {
                profile: structuredClone(
                  w.projects.find((p) => p.id === f!.projectId)!
                    .executionProfile!,
                ),
                harness: resolveHarness(
                  w,
                  w.projects.find((p) => p.id === f!.projectId)!,
                ),
                agents: [],
                binding: approvalBinding(w, f!),
                attempt: 0,
                costUsd: 0,
                costEstimated: true,
                events: [],
                evidence: [],
              }
            : undefined,
        reason:
          w.mode === "local-owner"
            ? "실행 환경 확인 대기"
            : f!.dependencies.length
              ? "선행 기능 통합 대기 · M2 실행기 미연결"
              : "M2 실행기 미연결 · 실행 요청이 저장됐습니다.",
        policyVersion: w.policies.at(-1)!.version,
        effectivePolicy: effectivePolicy(w, f!),
        actorId,
        at: stamp,
      });
      break;
    }
    case "cancel_run": {
      const run = w.runs.find((r) => r.id === c.runId);
      requireThat(run, "not_found", "실행을 찾을 수 없습니다.", 404);
      f = w.features.find((f) => f.id === run.featureId)!;
      canEdit();
      if (run.runtime) run.runtime.cancelRequested = true;
      run.status = "cancelled";
      run.reason = "개발자가 대기를 취소했습니다.";
      break;
    }
    case "set_dependencies": {
      canEdit();
      requireThat(
        !c.dependencyIds.includes(f!.id),
        "dependency_cycle",
        "자기 자신에게 의존할 수 없습니다.",
      );
      requireThat(
        c.dependencyIds.every((id) => w.features.some((x) => x.id === id)),
        "not_found",
        "선행 기능을 찾을 수 없습니다.",
        404,
      );
      const reaches = (
        id: string,
        target: string,
        seen = new Set<string>(),
      ): boolean => {
        if (id === target) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return w.features
          .find((f) => f.id === id)!
          .dependencies.some((next) => reaches(next, target, seen));
      };
      requireThat(
        c.dependencyIds.every((id) => !reaches(id, f!.id)),
        "dependency_cycle",
        "순환 의존성을 만들 수 없습니다.",
      );
      f!.dependencies = [...new Set(c.dependencyIds)];
      if (latestDesign(f!)) latestDesign(f!)!.decisions = [];
      break;
    }
    case "publish_policy": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "관리자만 팀 지침을 게시할 수 있습니다.",
        403,
      );
      const last = w.policies.at(-1)!;
      requireThat(
        last.version === c.expectedVersion,
        "revision_conflict",
        "다른 관리자가 지침을 변경했습니다.",
      );
      requireThat(
        last.requiredChecks.every((x) => c.requiredChecks.includes(x)),
        "policy_weakening",
        "현재 필수 검사를 삭제할 수 없습니다.",
      );
      w.policies.push({
        version: last.version + 1,
        global: c.global,
        design: c.design,
        implementation: c.implementation,
        reviewer: c.reviewer,
        requiredChecks: [...new Set(c.requiredChecks)],
        at: stamp,
        authorId: actorId,
      });
      break;
    }
    case "update_project_policy": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "관리자만 프로젝트 지침을 변경할 수 있습니다.",
        403,
      );
      const project = w.projects.find((p) => p.id === c.projectId);
      requireThat(project, "not_found", "프로젝트를 찾을 수 없습니다.", 404);
      reviewers(w, c.reviewerIds);
      if (w.mode === "local-owner")
        requireThat(
          c.reviewerIds.length === 1 && c.reviewerIds[0] === project.ownerId,
          "owner_required",
          "로컬 파일럿의 필수 승인자는 본인입니다.",
        );
      requireThat(
        [...project.requiredChecks, ...w.policies.at(-1)!.requiredChecks].every(
          (check) => c.requiredChecks.includes(check),
        ),
        "policy_weakening",
        "팀·프로젝트 필수 검사를 삭제할 수 없습니다.",
      );
      if (c.instructions !== undefined) project.instructions = c.instructions;
      project.requiredChecks = [...new Set(c.requiredChecks)];
      project.reviewerIds = c.reviewerIds;
      // Project check changes must invalidate the previously approved execution contract too.
      const p = w.policies.at(-1)!;
      if (w.mode === "local-owner") {
        for (const f of w.features.filter((f) => f.projectId === project.id))
          if (latestDesign(f)) latestDesign(f)!.decisions = [];
      } else
        w.policies.push({
          ...p,
          version: p.version + 1,
          at: stamp,
          authorId: actorId,
        });
      break;
    }
  }
  if (f) f.updatedAt = stamp;
  for (const run of w.runs.filter((r) => r.status !== "cancelled")) {
    const feature = w.features.find((f) => f.id === run.featureId)!;
    if (run.runtime?.kind === "planning") {
      if (
        activeStatuses.includes(run.status) &&
        (run.runtime.binding !== policyBinding(w, feature) ||
          run.runtime.draftRevision !== feature.draft.revision)
      ) {
        run.status = "blocked";
        run.reason =
          "초안 또는 지침이 변경됐습니다. 최신 초안에서 새로 요청하세요.";
      }
      continue;
    }
    if (
      !gate(w, feature).eligible ||
      run.designId !== latestDesign(feature)?.id ||
      run.policyVersion !== w.policies.at(-1)!.version
    ) {
      run.status = "blocked";
      run.reason =
        "설계·승인·지침이 변경되어 실행 요청이 차단됐습니다. 취소 후 재승인된 버전으로 요청하세요.";
    }
  }
  w.revision++;
  return { featureId: f?.id, entityId };
}
