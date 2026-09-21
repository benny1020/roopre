import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { apply } from "../src/domain/index.ts";
import { policyBinding, approvalBinding } from "../src/domain/runtime.ts";
import { ownerFixture } from "./fixtures/workspace.ts";
import {
  exportAgentMarkdown,
  importAgentMarkdown,
  resolveHarness,
  stages,
  workflowIssues,
  type AgentDefinition,
} from "../src/shared/harness.ts";
import { sections, gate } from "../src/shared/contracts.ts";
function fixture() {
  const w = ownerFixture("test-harness");
  const p = w.projects[0];
  p.executionProfile = {
    repositoryPath: "/repo",
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    connectionId: randomUUID(),
    connectionVersion: 1,
    image: "roopre-runner:0.2",
    checks: [
      { name: "typecheck", argv: ["true"], timeoutSeconds: 5 },
      { name: "test", argv: ["true"], timeoutSeconds: 5 },
    ],
    webRequired: false,
    budgetUsd: 1,
    timeoutMinutes: 10,
    repairLimit: 0,
  };
  const agents: AgentDefinition[] = stages.map((stage) => ({
    id: randomUUID(),
    revision: 1,
    name: stage,
    description: "role",
    capability: stage === "implementation" ? "implementation" : "read-only",
    markdown: `# ${stage}\n역할 지침`,
    archived: false,
  }));
  for (const agent of agents)
    apply(w, "owner", { type: "save_agent", expectedRevision: 0, agent });
  apply(w, "owner", {
    type: "save_workflow",
    projectId: p.id,
    expectedRevision: 0,
    workflow: {
      revision: 1,
      instructions: {
        requirements: "scope",
        design: "design",
        implementation: "code",
        verification: "conventions",
        review: "review",
      },
      assignments: agents.map((a, i) => ({
        id: randomUUID(),
        agentId: a.id,
        stage: stages[i],
        required: true,
      })),
    },
  });
  apply(w, "owner", {
    type: "create_feature",
    projectId: p.id,
    title: "Task",
    template: "feature",
    requirements: "AC01 verify behavior",
  });
  const f = w.features[0];
  f.draft.body = sections
    .map((s) => `## ${s}\nConcrete design details`)
    .join("\n\n");
  return { w, p, f, agents };
}
test("Markdown import/export preserves instructions and rejects hooks, duplicate keys and wrong schema", () => {
  const { agents } = fixture();
  assert.deepEqual(importAgentMarkdown(exportAgentMarkdown(agents[0])), {
    name: agents[0].name,
    description: agents[0].description,
    capability: agents[0].capability,
    markdown: agents[0].markdown,
  });
  for (const invalid of ["hooks: run-me", "name: A\nname: B", "schema: other"])
    assert.throws(() =>
      importAgentMarkdown(
        `---\nschema: roopre-agent/v1\n${invalid}\n---\nbody`,
      ),
    );
  assert.throws(() => importAgentMarkdown("a".repeat(25000)));
});
test("required implementation/review and stage capabilities cannot be removed", () => {
  const { w, p } = fixture();
  assert(
    workflowIssues(w, p, {
      ...p.workflow!,
      assignments: p.workflow!.assignments.filter((a) => a.stage !== "review"),
    }).length,
  );
  assert(
    workflowIssues(w, p, {
      ...p.workflow!,
      assignments: p.workflow!.assignments.map((a) =>
        a.stage === "implementation"
          ? { ...a, agentId: p.workflow!.assignments[0].agentId }
          : a,
      ),
    }).length,
  );
  assert.throws(() =>
    apply(w, "owner", {
      type: "save_workflow",
      projectId: p.id,
      expectedRevision: 1,
      workflow: {
        ...p.workflow!,
        revision: 2,
        assignments: p.workflow!.assignments.map((a) => ({
          ...a,
          required: false,
        })),
      },
    }),
  );
});
test("agent revisions invalidate only referenced contracts and immutable execution snapshots survive edits", () => {
  const { w, p, f, agents } = fixture();
  const before = policyBinding(w, f);
  const snapshot = resolveHarness(w, p)!;
  apply(w, "owner", {
    type: "save_agent",
    expectedRevision: 0,
    agent: { ...agents[0], id: randomUUID(), name: "unused" },
  });
  assert.equal(policyBinding(w, f), before);
  apply(w, "owner", {
    type: "save_agent",
    expectedRevision: 1,
    agent: { ...agents[0], revision: 2, markdown: "new instructions" },
  });
  assert.notEqual(policyBinding(w, f), before);
  assert.equal(snapshot.agents[0].agent.revision, 1);
  assert(snapshot.agents[0].instructions.includes("역할 지침"));
  assert.equal(w.agents!.filter((a) => a.id === agents[0].id).length, 2);
  assert.throws(
    () =>
      apply(w, "owner", {
        type: "save_agent",
        expectedRevision: 1,
        agent: { ...agents[0], revision: 2 },
      }),
    /최신/,
  );
});
test("planning does not need human approval but does not approve a design or permit implementation", () => {
  const { w, f } = fixture();
  apply(w, "owner", {
    type: "queue_planning",
    featureId: f.id,
    expectedRevision: 0,
  });
  assert.equal(w.runs[0].runtime!.kind, "planning");
  assert.equal(f.designs.length, 0);
  assert.equal(gate(w, f).eligible, false);
  assert.throws(() =>
    apply(w, "owner", {
      type: "queue_run",
      featureId: f.id,
      designId: "absent",
    }),
  );
  assert.throws(
    () =>
      apply(w, "owner", {
        type: "queue_planning",
        featureId: f.id,
        expectedRevision: 0,
      }),
    /진행/,
  );
});
test("referenced definition changes stop queued work and invalidate owner approval", () => {
  const { w, f, agents } = fixture();
  apply(w, "owner", {
    type: "publish_design",
    featureId: f.id,
    expectedRevision: 0,
  });
  apply(
    w,
    "owner",
    {
      type: "review",
      featureId: f.id,
      designId: f.designs[0].id,
      decision: "approve",
      checked: [...sections],
    },
    { binding: approvalBinding(w, f), authentication: "macos-owner" },
  );
  apply(w, "owner", {
    type: "queue_run",
    featureId: f.id,
    designId: f.designs[0].id,
  });
  apply(w, "owner", {
    type: "save_agent",
    expectedRevision: 1,
    agent: { ...agents[4], revision: 2, archived: true },
  });
  assert.equal(w.runs[0].status, "blocked");
  assert.equal(gate(w, f).eligible, false);
  assert.doesNotThrow(() => approvalBinding(w, f));
  assert.equal(w.runs[0].runtime!.harness!.agents[4].agent.archived, false);
});
test("project-scoped definitions cannot be assigned to another project", () => {
  const { w, p, agents } = fixture();
  apply(w, "owner", {
    type: "create_project",
    name: "Other",
    description: "",
    reviewerIds: ["owner"],
  });
  apply(w, "owner", {
    type: "save_agent",
    expectedRevision: 1,
    agent: { ...agents[0], revision: 2, projectId: w.projects[1].id },
  });
  assert(workflowIssues(w, p).length);
  assert.throws(() => resolveHarness(w, p));
});

test("new execution defaults to parallel, mode changes invalidate approval and preserve frozen snapshots", () => {
  const { w, p, f } = fixture();
  const before = policyBinding(w, f);
  const frozen = resolveHarness(w, p)!;
  assert.deepEqual(
    Object.values(frozen.execution!),
    stages.map(() => "parallel"),
  );
  apply(w, "owner", {
    type: "save_workflow",
    projectId: p.id,
    expectedRevision: p.workflow!.revision,
    workflow: {
      ...p.workflow!,
      revision: p.workflow!.revision + 1,
      execution: { design: "sequential" },
    },
  });
  assert.notEqual(policyBinding(w, f), before);
  assert.equal(resolveHarness(w, p)!.execution!.design, "sequential");
  assert.equal(resolveHarness(w, p)!.execution!.review, "parallel");
  assert.equal(frozen.execution!.design, "parallel");
});
