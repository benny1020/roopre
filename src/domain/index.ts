import { applyPackage } from "./harness-package.ts";
import {
  packageInstructions,
  profileOf,
  packageLimitIssues,
} from "../shared/harness-package.ts";
import {
  latestAgents,
  resolveHarness,
  workflowIssues,
} from "../shared/harness.ts";
import { policyBinding, approvalBinding } from "./runtime.ts";
import {
  assertMemoryMutationAllowed,
  freezeHarnessMemory,
  validateMemoryMutation,
} from "./memory.ts";
import {
  activeStatuses,
  executionCapacityOf,
  executionProfileIssues,
} from "../shared/runtime.ts";
import { createHash, randomUUID } from "node:crypto";
import { canonicalSourceRef } from "../shared/memory.ts";
import {
  sections,
  sectionLabels,
  hasDesignSections,
  hasDesignPlaceholders,
  designPrompts,
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
  sections
    .map(
      (key, index) =>
        `## ${sectionLabels[key]}\n${index === 0 ? title : designPrompts[index - 1]}`,
    )
    .join("\n\n");

function person(w: Workspace, actorId: string): Person {
  const p = w.people.find((p) => p.id === actorId && p.teamId === w.teamId);
  requireThat(p, "forbidden", "You do not have access to this workspace.", 403);
  return p;
}
function reviewers(w: Workspace, ids: string[]) {
  requireThat(
    new Set(ids).size === ids.length,
    "reviewers_duplicate",
    "Duplicate reviewers.",
  );
  for (const id of ids)
    requireThat(
      person(w, id).role !== "agent",
      "human_required",
      "Required reviewers must be developers.",
    );
}
export function effectivePolicy(w: Workspace, f: Feature) {
  const p = w.policies.at(-1)!;
  const project = w.projects.find((p) => p.id === f.projectId)!;
  return `${packageInstructions(project.harness, f.harnessScope)}\n\nGlobal v${p.version}\n${p.global}\n\nProject: ${project.name}\n${project.instructions || "No additional instructions"}\nRequired checks: ${[...new Set([...p.requiredChecks, ...project.requiredChecks])].join(", ")}\n\nPlanning stage\n${p.design}\n\nImplementation stage\n${p.implementation}\n\nReviewer role\n${p.reviewer}\n\nThis feature\n${latestDesign(f)?.requirements || f.draft.requirements}`;
}

export function apply(
  w: Workspace,
  actorId: string,
  c: Command,
  proof?: {
    binding: string;
    authentication: "app-confirmation" | "macos-owner";
  },
): { featureId?: string; entityId?: string } {
  const actor = person(w, actorId);
  requireThat(
    actor.role !== "agent",
    "human_required",
    "Agents cannot approve designs, change policies or control execution on behalf of humans.",
    403,
  );
  const stamp = now();
  let f: Feature | undefined;
  if ("featureId" in c) {
    f = w.features.find((f) => f.id === c.featureId);
    requireThat(f, "not_found", "Feature not found.", 404);
  }
  const canEdit = () =>
    requireThat(
      f && (actor.id === f.authorId || actor.role === "admin"),
      "forbidden",
      "Only the assigned developer can edit the design.",
      403,
    );
  let entityId: string | undefined;
  switch (c.type) {
    case "apply_harness_package": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can apply standards.",
        403,
      );
      applyPackage(w, c);
      break;
    }
    case "save_memory": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can save user-confirmed work memory.",
        403,
      );
      requireThat(
        w.revision === c.expectedRevision,
        "revision_conflict",
        "State changed. Check the latest memory.",
      );
      const project = w.projects.find((item) => item.id === c.projectId);
      requireThat(project, "not_found", "Project not found.", 404);
      assertMemoryMutationAllowed(w, project.id);
      const existing = (project.memories ?? []).find(
        (item) => item.id === c.memory.id,
      );
      requireThat(
        (!existing && c.memory.revision === 1) ||
          (!!existing && c.memory.revision === existing.revision + 1),
        "revision_conflict",
        "Memory changed. Check the latest version.",
      );
      requireThat(
        !existing ||
          (existing.agentDefinitionId === c.memory.agentDefinitionId &&
            existing.featureId === c.memory.featureId &&
            existing.sourceRefs.map(canonicalSourceRef).sort().join("\n") ===
              c.memory.sourceRefs.map(canonicalSourceRef).sort().join("\n")),
        "memory_scope_immutable",
        "Memory scope and source cannot be changed.",
      );
      const memory = {
        ...c.memory,
        authorId: existing?.authorId ?? actor.id,
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      validateMemoryMutation(w, project, memory);
      project.memories ??= [];
      if (existing)
        project.memories[project.memories.indexOf(existing)] = memory;
      else project.memories.push(memory);
      for (const feature of w.features.filter(
        (item) => item.projectId === project.id,
      ))
        if (latestDesign(feature)) latestDesign(feature)!.decisions = [];
      entityId = memory.id;
      break;
    }
    case "deactivate_memory": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can deactivate work memory.",
        403,
      );
      requireThat(
        w.revision === c.expectedRevision,
        "revision_conflict",
        "State changed. Check the latest memory.",
      );
      const project = w.projects.find((item) => item.id === c.projectId);
      requireThat(project, "not_found", "Project not found.", 404);
      assertMemoryMutationAllowed(w, project.id);
      const memory = (project.memories ?? []).find(
        (item) => item.id === c.memoryId,
      );
      requireThat(memory, "not_found", "Memory not found.", 404);
      memory.active = false;
      memory.revision++;
      memory.updatedAt = stamp;
      for (const feature of w.features.filter(
        (item) => item.projectId === project.id,
      ))
        if (latestDesign(feature)) latestDesign(feature)!.decisions = [];
      entityId = memory.id;
      break;
    }
    case "set_feature_scope": {
      canEdit();
      requireThat(
        w.revision === c.expectedRevision,
        "revision_conflict",
        "State changed. Review again.",
      );
      const p = w.projects.find((p) => p.id === f!.projectId)!;
      requireThat(
        !c.scopeId ||
          (p.harness &&
            profileOf(p.harness).scopes.some((s) => s.id === c.scopeId)),
        "invalid_scope",
        "Feature scope not found.",
      );
      requireThat(
        !w.runs.some(
          (r) =>
            r.featureId === f!.id &&
            (activeStatuses.includes(r.status) ||
              r.runtime?.terminationConfirmed === false),
        ),
        "active_run",
        "End this feature's run first.",
      );
      f!.harnessScope = c.scopeId;
      if (latestDesign(f!)) latestDesign(f!)!.decisions = [];
      break;
    }
    case "save_agent": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can edit agents.",
        403,
      );
      requireThat(
        !w.projects.some((p) =>
          Object.values(p.harness?.agents ?? {}).includes(c.agent.id),
        ),
        "standard_managed",
        "Edit shared agents by creating a new harness standard version.",
      );
      const old = latestAgents(w).find((a) => a.id === c.agent.id);
      requireThat(
        (old?.revision ?? 0) === c.expectedRevision &&
          c.agent.revision === c.expectedRevision + 1,
        "revision_conflict",
        "Agent changed. Reopen the latest version.",
      );
      requireThat(
        !c.agent.projectId ||
          w.projects.some((p) => p.id === c.agent.projectId),
        "not_found",
        "Project not found.",
      );
      requireThat(
        !c.agent.connectionId || c.agent.connectionVersion,
        "connection_required",
        "Check the connection version.",
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
          r.reason = "An assigned agent changed. Approve the design again.";
        }
      }
      entityId = c.agent.id;
      break;
    }
    case "save_workflow": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can edit workflows.",
        403,
      );
      const p = w.projects.find((p) => p.id === c.projectId);
      requireThat(p, "not_found", "Project not found.");
      requireThat(
        (p.workflow?.revision ?? 0) === c.expectedRevision &&
          c.workflow.revision === c.expectedRevision + 1,
        "revision_conflict",
        "Workflow changed. Reopen the latest version.",
      );
      requireThat(
        !p.harness,
        "standard_managed",
        "Edit shared workflows by creating a new harness standard version.",
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
        r.reason = "Workflow changed. Approve the design again.";
      }
      break;
    }
    case "queue_planning": {
      canEdit();
      requireThat(
        w.mode === "local-owner",
        "desktop_required",
        "Use the macOS app for this action.",
      );
      requireThat(
        f!.draft.revision === c.expectedRevision,
        "revision_conflict",
        "Draft changed.",
      );
      const p = w.projects.find((p) => p.id === f!.projectId)!;
      requireThat(
        p.executionProfile,
        "profile_required",
        "Configure the project execution profile first.",
      );
      const harness = resolveHarness(w, p, f!.harnessScope, f!.id);
      requireThat(
        harness?.agents.some(
          (a) => a.stage === "requirements" || a.stage === "design",
        ),
        "planning_required",
        "Assign a requirements or design agent.",
      );
      requireThat(
        !w.runs.some(
          (r) =>
            r.featureId === f!.id &&
            (activeStatuses.includes(r.status) ||
              r.runtime?.terminationConfirmed === false),
        ),
        "duplicate_run",
        "End the active run first.",
      );
      entityId = uid("run");
      w.runs.push({
        id: entityId,
        featureId: f!.id,
        designId: `draft-${f!.draft.revision}`,
        status: "queued",
        reason: "Read-only requirements and design planning",
        at: stamp,
        actorId,
        policyVersion: w.policies.at(-1)!.version,
        effectivePolicy: effectivePolicy(w, f!),
        runtime: {
          kind: "planning",
          draftRevision: f!.draft.revision,
          harness: freezeHarnessMemory(harness!),
          agents: [],
          profile: structuredClone(p.executionProfile),
          capacity: executionCapacityOf(w.executionCapacity),
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
        "Only the local app owner can configure execution settings.",
        403,
      );
      const p = w.projects.find((p) => p.id === c.projectId);
      requireThat(p, "not_found", "Project not found.", 404);
      requireThat(
        !w.runs.some(
          (r) =>
            activeStatuses.includes(r.status) &&
            w.features.find((f) => f.id === r.featureId)?.projectId === p.id,
        ),
        "active_run",
        "Cancel the run first.",
      );
      const issues = [
        ...packageLimitIssues(p, c.profile),
        ...executionProfileIssues(c.profile, [
          ...w.policies.at(-1)!.requiredChecks,
          ...p.requiredChecks,
        ]),
      ];
      requireThat(!issues.length, "missing_checks", issues.join(" "));
      p.executionProfile = c.profile;
      for (const f of w.features.filter((f) => f.projectId === p.id))
        if (latestDesign(f)) latestDesign(f)!.decisions = [];
      break;
    }
    case "configure_execution_capacity": {
      requireThat(
        w.mode === "local-owner" && actor.role === "admin",
        "forbidden",
        "Only the local app owner can set execution capacity.",
        403,
      );
      requireThat(
        w.revision === c.expectedRevision,
        "revision_conflict",
        "Execution policy changed. Check the latest state.",
      );
      w.executionCapacity = executionCapacityOf(c.capacity);
      break;
    }
    case "create_project": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can create projects.",
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
        "Project not found.",
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
        "Another change was saved first. Your draft is preserved; inspect the latest version.",
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
        "Draft changed. Inspect the latest draft.",
      );
      const p = w.projects.find((p) => p.id === f!.projectId)!;
      const independentReviewers = p.reviewerIds.filter(
        (id) => w.mode === "local-owner" || id !== f!.authorId,
      );
      requireThat(
        independentReviewers.length > 0,
        "independent_reviewer_required",
        "Assign a required reviewer other than the author.",
      );
      requireThat(
        hasDesignSections(f!.draft.body),
        "missing_sections",
        "Include all seven required design sections.",
      );
      requireThat(
        !hasDesignPlaceholders(f!.draft.body),
        "incomplete_design",
        "Replace template guidance with the actual design before requesting review.",
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
          "Connect a repository and execution profile first.",
        );
        requireThat(
          /AC[- ]?\d+/i.test(f!.draft.requirements),
          "acceptance_required",
          "Include identifiable acceptance criteria such as AC01 in the requirements.",
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
        "Design version not found.",
        404,
      );
      requireThat(
        c.designId === latestDesign(f!)!.id,
        "stale_design",
        "New comments cannot be added to an older version. Review the latest design.",
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
      requireThat(thread, "not_found", "Review comment not found.", 404);
      if (c.type === "reply_thread")
        thread.replies.push({ actorId: actor.id, body: c.body, at: stamp });
      if (c.type === "address_thread") {
        canEdit();
        requireThat(
          thread.status !== "resolved",
          "already_resolved",
          "This comment is already resolved.",
        );
        thread.status = "addressed";
      }
      if (c.type === "resolve_thread") {
        requireThat(
          (w.mode === "local-owner" || actor.id !== f!.authorId) &&
            latestDesign(f!)?.reviewers.includes(actor.id),
          "reviewer_required",
          "Only a required reviewer other than the author can confirm resolution.",
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
        "Design changed. Review the latest version again.",
      );
      requireThat(
        (w.mode === "local-owner" || actor.id !== f!.authorId) &&
          d.reviewers.includes(actor.id),
        "reviewer_required",
        "Only required reviewers can approve or request changes.",
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
            proof?.authentication === "app-confirmation" &&
              proof.binding === approvalBinding(w, f!),
            "confirmation_required",
            "Read the design brief and confirm approval in the app.",
            403,
          );
          requireThat(
            d.policyBinding === policyBinding(w, f!),
            "profile_changed",
            "Execution contract changed. Publish a new design.",
          );
        }
        requireThat(
          d.policyVersion === w.policies.at(-1)!.version,
          "policy_changed",
          "Instructions changed. Publish a new design.",
        );
        if (w.mode !== "local-owner")
          requireThat(
            sections.every((s) => c.checked.includes(s)),
            "checklist_incomplete",
            "Confirm all seven review criteria.",
          );
        requireThat(
          !f!.threads.some((t) => t.blocking && t.status !== "resolved"),
          "unresolved_threads",
          "Blocking comments need confirmed resolution.",
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
        "The selected design is not the latest version.",
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
          "Approval contract does not match.",
        );
      const g = gate(w, f!, approvalBinding(w, f!));
      requireThat(g.eligible, "design_gate", g.reasons.join(" "));
      requireThat(
        !w.runs.some(
          (r) =>
            r.featureId === f!.id &&
            ([...activeStatuses, "blocked", "interrupted"].includes(r.status) ||
              r.runtime?.terminationConfirmed === false),
        ),
        "duplicate_run",
        "This feature is already queued.",
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
                harness: (() => {
                  const resolved = resolveHarness(
                    w,
                    w.projects.find((p) => p.id === f!.projectId)!,
                    f!.harnessScope,
                    f!.id,
                  );
                  return resolved ? freezeHarnessMemory(resolved) : undefined;
                })(),
                capacity: executionCapacityOf(w.executionCapacity),
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
            ? "Waiting for environment checks"
            : f!.dependencies.length
              ? "Waiting for dependency integration · Runner disconnected"
              : "Runner disconnected · Run request saved.",
        policyVersion: w.policies.at(-1)!.version,
        effectivePolicy: effectivePolicy(w, f!),
        actorId,
        at: stamp,
      });
      break;
    }
    case "cancel_run": {
      const run = w.runs.find((r) => r.id === c.runId);
      requireThat(run, "not_found", "Run not found.", 404);
      f = w.features.find((f) => f.id === run.featureId)!;
      canEdit();
      if (run.runtime) run.runtime.cancelRequested = true;
      run.status = "cancelled";
      run.reason = "Queued run cancelled by the developer.";
      break;
    }
    case "set_dependencies": {
      canEdit();
      requireThat(
        !c.dependencyIds.includes(f!.id),
        "dependency_cycle",
        "A feature cannot depend on itself.",
      );
      requireThat(
        c.dependencyIds.every((id) => w.features.some((x) => x.id === id)),
        "not_found",
        "Dependency not found.",
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
        "Circular dependencies are not allowed.",
      );
      f!.dependencies = [...new Set(c.dependencyIds)];
      if (latestDesign(f!)) latestDesign(f!)!.decisions = [];
      break;
    }
    case "publish_policy": {
      requireThat(
        actor.role === "admin",
        "forbidden",
        "Only administrators can publish team instructions.",
        403,
      );
      const last = w.policies.at(-1)!;
      requireThat(
        last.version === c.expectedVersion,
        "revision_conflict",
        "Another administrator changed the instructions.",
      );
      requireThat(
        last.requiredChecks.every((x) => c.requiredChecks.includes(x)),
        "policy_weakening",
        "Existing required checks cannot be removed.",
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
        "Only administrators can change project instructions.",
        403,
      );
      const project = w.projects.find((p) => p.id === c.projectId);
      requireThat(project, "not_found", "Project not found.", 404);
      reviewers(w, c.reviewerIds);
      if (w.mode === "local-owner")
        requireThat(
          c.reviewerIds.length === 1 && c.reviewerIds[0] === project.ownerId,
          "owner_required",
          "The local workspace requires your own approval.",
        );
      requireThat(
        [...project.requiredChecks, ...w.policies.at(-1)!.requiredChecks].every(
          (check) => c.requiredChecks.includes(check),
        ),
        "policy_weakening",
        "Team and project required checks cannot be removed.",
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
  reconcileRunContracts(w);
  w.revision++;
  return { featureId: f?.id, entityId };
}

/** Reconcile every persisted run when approval inputs change, including storage-only mutations. */
export function reconcileRunContracts(w: Workspace) {
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
          "Draft or instructions changed. Request planning again from the latest draft.";
      }
      continue;
    }
    if (
      !latestDesign(feature) ||
      !gate(w, feature, approvalBinding(w, feature)).eligible ||
      run.designId !== latestDesign(feature)?.id ||
      run.policyVersion !== w.policies.at(-1)!.version ||
      (run.runtime && run.runtime.binding !== approvalBinding(w, feature))
    ) {
      run.status = "blocked";
      run.reason =
        "Design, approvals or instructions changed. Cancel this run and request it again from an approved version.";
    }
  }
}
