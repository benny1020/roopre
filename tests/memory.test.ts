import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { apply } from "../src/domain/index.ts";
import { exportProject } from "../src/domain/harness-package.ts";
import { policyBinding } from "../src/domain/runtime.ts";
import { freezeHarnessMemory } from "../src/domain/memory.ts";
import {
  resolveHarness,
  stages,
  type AgentDefinition,
} from "../src/shared/harness.ts";
import { ownerFixture } from "./fixtures/workspace.ts";

const manualSource = () => [
  { type: "manual" as const, label: "Owner decision" },
];

function setup() {
  const w = ownerFixture("memory-test");
  const p = w.projects[0];
  const agents: AgentDefinition[] = stages.map((stage) => ({
    id: randomUUID(),
    revision: 1,
    name: stage,
    description: stage,
    capability: stage === "implementation" ? "implementation" : "read-only",
    markdown: `# ${stage}`,
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
      instructions: Object.fromEntries(
        stages.map((stage) => [stage, stage]),
      ) as Record<(typeof stages)[number], string>,
      assignments: agents.map((agent, index) => ({
        id: randomUUID(),
        agentId: agent.id,
        stage: stages[index],
        required: true,
      })),
    },
  });
  apply(w, "owner", {
    type: "create_feature",
    projectId: p.id,
    title: "One",
    template: "feature",
    requirements: "AC",
  });
  apply(w, "owner", {
    type: "create_feature",
    projectId: p.id,
    title: "Two",
    template: "feature",
    requirements: "AC",
  });
  return { w, p, agents, one: w.features[0], two: w.features[1] };
}

test("active memory is project/agent/feature scoped, bound canonically, and legacy empty binding is unchanged", () => {
  const { w, p, agents, one, two } = setup();
  const legacy = policyBinding(w, one);
  p.memories = [];
  assert.equal(policyBinding(w, one), legacy);
  const memory = {
    id: "memory-one",
    agentDefinitionId: agents[0].id,
    featureId: one.id,
    title: "Decision",
    body: "Keep the migration additive.",
    revision: 1,
    sourceRefs: manualSource(),
    active: true,
  };
  apply(w, "owner", {
    type: "save_memory",
    projectId: p.id,
    expectedRevision: w.revision,
    promoteToProject: false,
    memory,
  });
  assert.notEqual(policyBinding(w, one), legacy);
  const forOne = freezeHarnessMemory(resolveHarness(w, p, undefined, one.id)!);
  const forTwo = resolveHarness(w, p, undefined, two.id)!;
  assert.equal(forOne.agents[0].memory?.[0].id, memory.id);
  assert.equal(forTwo.agents[0].memory?.length, 0);
  assert.match(forOne.agents[0].instructions, /Reference memory/);
  assert.doesNotMatch(
    JSON.stringify(
      exportProject(w, p, { id: "fixture", version: "1.0.0", name: "Fixture" }),
    ),
    /Keep the migration additive/,
  );
});

test("memory edits require expected revision and stop while any project run is queued or unconfirmed", () => {
  const { w, p, agents, one } = setup();
  const memory = {
    id: "memory-guard",
    agentDefinitionId: agents[0].id,
    title: "Decision",
    body: "Use explicit confirmation.",
    revision: 1,
    sourceRefs: manualSource(),
    active: true,
  };
  assert.throws(
    () =>
      apply(w, "owner", {
        type: "save_memory",
        projectId: p.id,
        expectedRevision: w.revision + 1,
        promoteToProject: false,
        memory,
      }),
    /latest/,
  );
  w.runs.push({
    id: "run-waiting",
    featureId: one.id,
    designId: "draft",
    status: "queued",
    reason: "waiting",
    policyVersion: 1,
    effectivePolicy: "",
    at: new Date().toISOString(),
    actorId: "owner",
  });
  assert.throws(
    () =>
      apply(w, "owner", {
        type: "save_memory",
        projectId: p.id,
        expectedRevision: w.revision,
        promoteToProject: false,
        memory,
      }),
    /End|terminate|termination/,
  );
});

test("a resolved harness keeps frozen memory after later memory changes", () => {
  const { w, p, agents, one } = setup();
  apply(w, "owner", {
    type: "save_memory",
    projectId: p.id,
    expectedRevision: w.revision,
    promoteToProject: false,
    memory: {
      id: "memory-frozen",
      agentDefinitionId: agents[0].id,
      title: "Before",
      body: "First approved value.",
      revision: 1,
      sourceRefs: manualSource(),
      active: true,
    },
  });
  const frozen = structuredClone(resolveHarness(w, p, undefined, one.id)!);
  apply(w, "owner", {
    type: "save_memory",
    projectId: p.id,
    expectedRevision: w.revision,
    promoteToProject: false,
    memory: {
      id: "memory-frozen",
      agentDefinitionId: agents[0].id,
      title: "After",
      body: "Later value.",
      revision: 2,
      sourceRefs: manualSource(),
      active: true,
    },
  });
  const current = resolveHarness(w, p, undefined, one.id)!;
  assert.equal(frozen.agents[0].memory?.[0].body, "First approved value.");
  assert.equal(current.agents[0].memory?.[0].body, "Later value.");
  // Runner retry clones runtime.harness, so it receives this frozen value rather
  // than re-resolving current workspace memory.
  assert.deepEqual(
    structuredClone(frozen).agents[0].memory,
    frozen.agents[0].memory,
  );
});
