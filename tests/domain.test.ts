import test from "node:test";
import assert from "node:assert/strict";
import { apply, DomainError } from "../src/domain/index.ts";
import { seed } from "../src/database/seed.ts";
import {
  gate,
  latestDesign,
  sections,
  commandSchema,
  type Workspace,
  type Command,
} from "../src/shared/contracts.ts";

const featureId = "feature-receipt";
const review = (
  w: Workspace,
  actor: string,
  decision: "approve" | "withdraw" | "request_changes" = "approve",
) =>
  apply(w, actor, {
    type: "review",
    featureId,
    designId: latestDesign(w.features[1])!.id,
    decision,
    checked: [...sections],
  });
const approved = () => {
  const w = seed();
  review(w, "mina");
  review(w, "sora");
  return w;
};
const fails = (fn: () => unknown, code: string) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );

test("T01: both developer identities get the same template and immutable required checks", () => {
  const w = seed();
  for (const actor of ["jun", "mina"])
    apply(w, actor, {
      type: "create_feature",
      projectId: "platform",
      title: "새 기능",
      template: "feature",
      requirements: "AC-01 정상 동작",
    });
  for (const f of w.features.slice(-2)) {
    assert(sections.every((s) => f.draft.body.includes(`## ${s}`)));
    assert.equal(gate(w, f).eligible, false);
  }
});
test("T02/T04: every required human must review all seven sections before queueing", () => {
  const w = seed();
  const designId = latestDesign(w.features[1])!.id;
  fails(
    () => apply(w, "jun", { type: "queue_run", featureId, designId }),
    "design_gate",
  );
  fails(
    () =>
      apply(w, "mina", {
        type: "review",
        featureId,
        designId,
        decision: "approve",
        checked: [],
      }),
    "checklist_incomplete",
  );
  review(w, "mina");
  assert.equal(gate(w, w.features[1]).eligible, false);
  review(w, "sora");
  assert.equal(gate(w, w.features[1]).eligible, true);
  apply(w, "jun", { type: "queue_run", featureId, designId });
  assert.equal(w.runs[0].status, "queued");
  assert.match(w.runs[0].reason, /미연결/);
});
test("T03: agent, author, and unrecognized actor cannot impersonate required reviewers", () => {
  const w = seed();
  fails(() => review(w, "agent"), "human_required");
  fails(() => review(w, "jun"), "reviewer_required");
  fails(() => review(w, "outsider"), "forbidden");
  assert.equal(w.features[1].designs[0].decisions.length, 0);
});
test("T03: author cannot resolve a blocking issue; human reviewer must confirm", () => {
  const w = seed();
  const f = w.features[0];
  const c: Command = {
    type: "resolve_thread",
    featureId: f.id,
    threadId: f.threads[0].id,
  };
  fails(() => apply(w, "jun", c), "reviewer_required");
  apply(w, "jun", { ...c, type: "address_thread" });
  assert.equal(gate(w, f).blockers, 1);
  apply(w, "mina", c);
  assert.equal(gate(w, f).blockers, 0);
  assert.equal(f.threads[0].resolvedBy, "mina");
});
test("T05: new published version preserves old body and hash, invalidates queued run", () => {
  const w = approved();
  const f = w.features[1];
  const old = structuredClone(latestDesign(f)!);
  apply(w, "jun", { type: "queue_run", featureId, designId: old.id });
  apply(w, "jun", {
    type: "save_draft",
    featureId,
    expectedRevision: 1,
    body: f.draft.body + "\n추가 검증 조건",
    requirements: f.draft.requirements,
  });
  apply(w, "jun", { type: "publish_design", featureId, expectedRevision: 2 });
  assert.deepEqual(f.designs[0], old);
  assert.equal(gate(w, f).eligible, false);
  assert.equal(w.runs[0].status, "blocked");
  fails(
    () =>
      apply(w, "mina", {
        type: "review",
        featureId,
        designId: old.id,
        decision: "approve",
        checked: [...sections],
      }),
    "stale_design",
  );
});
test("T05: approval withdrawal and new blocking comments invalidate old queue decisions", () => {
  const w = approved();
  const designId = latestDesign(w.features[1])!.id;
  apply(w, "jun", { type: "queue_run", featureId, designId });
  review(w, "mina", "withdraw");
  assert.equal(w.runs[0].status, "blocked");
  review(w, "mina");
  apply(w, "sora", {
    type: "add_thread",
    featureId,
    designId,
    section: "예외 상황",
    quote: "",
    body: "추가 검토 필요",
    blocking: true,
  });
  assert.equal(gate(w, w.features[1]).approved, 0);
});
test("T06: saving a stale draft cannot overwrite a newer revision", () => {
  const w = seed();
  const c: Command = {
    type: "save_draft",
    featureId,
    expectedRevision: 1,
    body: "새로운 설계",
    requirements: "새 요구",
  };
  apply(w, "jun", c);
  fails(
    () => apply(w, "jun", { ...c, body: "오래된 설계" }),
    "revision_conflict",
  );
  assert.equal(w.features[1].draft.body, "새로운 설계");
});
test("T07: policy restrictions cannot be weakened by project or team update", () => {
  const w = seed();
  fails(
    () =>
      apply(w, "jun", {
        type: "update_project_policy",
        projectId: "commerce",
        requiredChecks: ["test"],
        reviewerIds: ["mina", "sora"],
      }),
    "policy_weakening",
  );
  const p = w.policies[0];
  fails(
    () =>
      apply(w, "jun", {
        ...p,
        type: "publish_policy",
        expectedVersion: 1,
        requiredChecks: ["test"],
      }),
    "policy_weakening",
  );
  fails(
    () =>
      apply(w, "mina", { ...p, type: "publish_policy", expectedVersion: 1 }),
    "forbidden",
  );
});
test("T07: newly added team checks make the old design ineligible", () => {
  const w = approved();
  const p = w.policies[0];
  apply(w, "jun", {
    ...p,
    type: "publish_policy",
    expectedVersion: 1,
    requiredChecks: [...p.requiredChecks, "e2e"],
  });
  assert.equal(gate(w, w.features[1]).eligible, false);
});
test("T09: dependency cycles are rejected and changing dependencies invalidates approval", () => {
  const w = approved();
  apply(w, "jun", {
    type: "set_dependencies",
    featureId,
    dependencyIds: ["feature-webhook"],
  });
  assert.equal(gate(w, w.features[1]).eligible, false);
  fails(
    () =>
      apply(w, "jun", {
        type: "set_dependencies",
        featureId: "feature-webhook",
        dependencyIds: [featureId],
      }),
    "dependency_cycle",
  );
});
test("T06: previous-version comments remain linked to their original design", () => {
  const w = seed();
  const f = w.features[0];
  const oldId = f.threads[0].designId;
  apply(w, "jun", {
    type: "publish_design",
    featureId: f.id,
    expectedRevision: 1,
  });
  assert.equal(f.threads[0].designId, oldId);
  assert.equal(gate(w, f).blockers, 1);
});
test("invalid command input is rejected before domain execution", () => {
  assert.equal(
    commandSchema.safeParse({
      type: "review",
      featureId,
      decision: "approve",
      checked: [],
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: "publish_policy",
      expectedVersion: 1,
      global: "",
      requiredChecks: [],
    }).success,
    false,
  );
});

test("author in reviewer pool is excluded, with an independent reviewer still mandatory", () => {
  const w = seed();
  const f = w.features[1];
  f.authorId = "mina";
  apply(w, "mina", {
    type: "publish_design",
    featureId: f.id,
    expectedRevision: 1,
  });
  assert.deepEqual(latestDesign(f)!.reviewers, ["sora"]);
  apply(w, "sora", {
    type: "review",
    featureId: f.id,
    designId: latestDesign(f)!.id,
    decision: "approve",
    checked: [...sections],
  });
  assert.equal(gate(w, f).eligible, true);
  w.projects.find((p) => p.id === f.projectId)!.reviewerIds = ["mina"];
  fails(
    () =>
      apply(w, "mina", {
        type: "publish_design",
        featureId: f.id,
        expectedRevision: 1,
      }),
    "independent_reviewer_required",
  );
});

test("run retains all instruction scopes after later policy edits", () => {
  const w = approved();
  const f = w.features[1];
  const project = w.projects.find((p) => p.id === f.projectId)!;
  project.instructions = "프로젝트 계약 테스트 명령: npm test";
  apply(w, "jun", {
    type: "queue_run",
    featureId: f.id,
    designId: latestDesign(f)!.id,
  });
  const saved = w.runs[0].effectivePolicy;
  for (const scope of [
    w.policies[0].global,
    w.policies[0].design,
    w.policies[0].implementation,
    w.policies[0].reviewer,
    project.instructions,
    f.draft.requirements,
  ])
    assert(saved.includes(scope));
  apply(w, "jun", {
    type: "update_project_policy",
    projectId: project.id,
    requiredChecks: project.requiredChecks,
    reviewerIds: project.reviewerIds,
    instructions: "수정된 프로젝트 지침",
  });
  assert.equal(w.runs[0].effectivePolicy, saved);
  assert.equal(w.runs[0].status, "blocked");
});
