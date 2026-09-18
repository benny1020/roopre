import { createHash } from "node:crypto";
import { latestAgents, stages } from "../shared/harness.ts";
import {
  canonical,
  harnessPackageSchema,
  profileOf,
  type HarnessPackage,
  type HarnessInstallation,
} from "../shared/harness-package.ts";
import type { Workspace, Project, Command } from "../shared/contracts.ts";
import { activeStatuses, executionProfileIssues } from "../shared/runtime.ts";
export const packageDigest = (p: HarnessPackage) =>
  createHash("sha256").update(canonical(p)).digest("hex");
const stableId = (...values: string[]) => {
  const h = createHash("sha256").update(JSON.stringify(values)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export function applyPackage(
  w: Workspace,
  c: Extract<Command, { type: "apply_harness_package" }>,
) {
  if (w.revision !== c.expectedRevision)
    throw Error("미리보기 이후 상태가 변경됐습니다. 다시 비교하세요.");
  const p = w.projects.find((p) => p.id === c.projectId);
  if (!p) throw Error("프로젝트가 없습니다.");
  if (
    w.runs.some(
      (r) =>
        w.features.find((f) => f.id === r.featureId)?.projectId === p.id &&
        (activeStatuses.includes(r.status) ||
          r.runtime?.terminationConfirmed === false),
    )
  )
    throw Error("프로젝트 실행을 종료하고 종료 확인 후 적용하세요.");
  const pack = harnessPackageSchema.parse(c.package);
  const profile = pack.profiles.find((f) => f.id === c.profileId);
  if (!profile) throw Error("표준 프로젝트 프로필이 없습니다.");
  const digest = packageDigest(pack);
  const existing = p.harness;
  if (
    w.projects.some(
      (target) =>
        target.harness?.package.id === pack.id &&
        target.harness.package.version === pack.version &&
        target.harness.digest !== digest,
    )
  )
    throw Error("같은 표준 버전의 내용이 다릅니다. 버전을 올려 주세요.");
  const used = pack.agents.filter((a) =>
    profile.assignments.some((x) => x.agentId === a.id),
  );
  for (const a of used)
    if (a.connection !== "project" && !c.bindings[a.connection])
      throw Error(`연결을 매핑하세요: ${a.connection}`);
  const ids = Object.fromEntries(
    used.map((a) => [a.id, stableId(p.id, pack.id, "agent", a.id)]),
  );
  const assignments = Object.fromEntries(
    profile.assignments.map((a) => [
      a.id,
      stableId(p.id, pack.id, "assignment", a.id),
    ]),
  );
  const requiredChecks = [
    ...new Set([
      ...w.policies.at(-1)!.requiredChecks,
      ...p.requiredChecks,
      ...profile.requiredChecks,
    ]),
  ];
  const execution = p.executionProfile && {
    ...p.executionProfile,
    ...profile.limits,
    checks: profile.checks.length
      ? structuredClone(profile.checks)
      : p.executionProfile.checks,
  };
  if (execution) {
    const issues = executionProfileIssues(execution, requiredChecks);
    if (issues.length) throw Error(issues.join(" "));
  }
  const installation: HarnessInstallation = {
    package: structuredClone(pack),
    profileId: profile.id,
    digest,
    source: c.source,
    agents: ids,
    assignments,
    bindings: c.bindings,
    revision: (existing?.revision ?? 0) + 1,
    appliedAt: new Date().toISOString(),
  };
  if (
    existing?.digest === digest &&
    existing.profileId === profile.id &&
    canonical(existing.bindings) === canonical(c.bindings) &&
    p.instructions === profile.instructions &&
    canonical(p.executionProfile ?? null) === canonical(execution ?? null) &&
    canonical(p.workflow?.instructions) ===
      canonical(profile.stageInstructions) &&
    canonical(p.workflow?.assignments) ===
      canonical(
        profile.assignments.map((a) => ({
          ...a,
          id: assignments[a.id],
          agentId: ids[a.agentId],
        })),
      )
  )
    return;
  // All validation precedes writes. Store commits the whole command transactionally.
  const current = latestAgents(w);
  const definitions = used.map((a) => ({
    id: ids[a.id],
    revision: (current.find((d) => d.id === ids[a.id])?.revision ?? 0) + 1,
    name: a.name,
    description: a.description,
    markdown: a.instructions,
    capability: a.capability,
    projectId: p.id,
    archived: false,
    ...(a.connection === "project"
      ? {}
      : {
          connectionId: c.bindings[a.connection].id,
          connectionVersion: c.bindings[a.connection].version,
        }),
  }));
  const retired = current
    .filter(
      (a) =>
        Object.values(existing?.agents ?? {}).includes(a.id) &&
        !Object.values(ids).includes(a.id) &&
        !a.archived,
    )
    .map((a) => ({ ...a, revision: a.revision + 1, archived: true }));
  w.agents = [...(w.agents ?? []), ...retired, ...definitions];
  p.harness = installation;
  p.instructions = profile.instructions;
  p.requiredChecks = requiredChecks;
  p.executionProfile = execution;
  p.workflow = {
    revision: (p.workflow?.revision ?? 0) + 1,
    instructions: structuredClone(profile.stageInstructions),
    assignments: profile.assignments.map((a) => ({
      ...a,
      id: assignments[a.id],
      agentId: ids[a.agentId],
    })),
  };
  for (const f of w.features.filter((f) => f.projectId === p.id)) {
    if (f.designs.at(-1)) f.designs.at(-1)!.decisions = [];
    if (f.harnessScope && !profile.scopes.some((s) => s.id === f.harnessScope))
      f.harnessScope = undefined;
  }
}
export function exportProject(
  w: Workspace,
  p: Project,
  identity: { id: string; version: string; name: string },
): HarnessPackage {
  if (!p.workflow) throw Error("개발 흐름을 먼저 구성하세요.");
  const definitions = latestAgents(w);
  const reverse = new Map(
    Object.entries(p.harness?.agents ?? {}).map(([key, value]) => [value, key]),
  );
  const reverseAssignment = new Map(
    Object.entries(p.harness?.assignments ?? {}).map(([key, value]) => [
      value,
      key,
    ]),
  );
  const ids = [...new Set(p.workflow.assignments.map((a) => a.agentId))];
  const names = new Map(
    ids.map((id, index) => [id, reverse.get(id) ?? `agent-${index + 1}`]),
  );
  const connections = new Map<string, string>();
  const agents = ids.map((id) => {
    const a = definitions.find((d) => d.id === id);
    if (!a || a.archived)
      throw Error("사용할 수 없는 에이전트가 배치됐습니다.");
    let connection = "project";
    if (a.connectionId) {
      if (!connections.has(a.connectionId)) {
        const original = p.harness?.package.agents.find(
          (d) => d.id === reverse.get(id),
        )?.connection;
        let alias =
          original && original !== "project"
            ? original
            : `connection-${connections.size + 1}`;
        while ([...connections.values()].includes(alias)) alias += "-local";
        connections.set(a.connectionId, alias);
      }
      connection = connections.get(a.connectionId)!;
    }
    return {
      id: names.get(id)!,
      name: a.name,
      description: a.description,
      capability: a.capability,
      instructions: a.markdown,
      connection,
    };
  });
  const policy = w.policies.at(-1)!;
  const installed = p.harness && profileOf(p.harness);
  const profile = {
    id: installed?.id ?? "default",
    name: installed?.name ?? p.name,
    instructions: p.instructions ?? "",
    stageInstructions: Object.fromEntries(
      stages.map((stage) => [stage, p.workflow!.instructions[stage]]),
    ),
    assignments: p.workflow.assignments.map((a, i) => ({
      ...a,
      id: reverseAssignment.get(a.id) ?? `assignment-${i + 1}`,
      agentId: names.get(a.agentId)!,
    })),
    checks: p.executionProfile?.checks ?? installed?.checks ?? [],
    requiredChecks: [
      ...new Set([...policy.requiredChecks, ...p.requiredChecks]),
    ],
    scopes: installed?.scopes ?? [],
    limits: p.executionProfile
      ? {
          budgetUsd: p.executionProfile.budgetUsd,
          timeoutMinutes: p.executionProfile.timeoutMinutes,
          repairLimit: p.executionProfile.repairLimit,
        }
      : installed?.limits,
  };
  return harnessPackageSchema.parse({
    schema: "roopre.harness/v1",
    ...identity,
    instructions:
      p.harness?.package.instructions ??
      `# 전역\n${policy.global}\n\n# 설계\n${policy.design}\n\n# 구현\n${policy.implementation}\n\n# 리뷰\n${policy.reviewer}`,
    agents,
    profiles: [profile],
  });
}
