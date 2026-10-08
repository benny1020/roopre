import { randomUUID } from "node:crypto";
import { ownerFixture } from "./workspace.ts";
import { apply } from "../../src/domain/index.ts";
import { approvalBinding } from "../../src/domain/runtime.ts";
import { sections } from "../../src/shared/contracts.ts";
import type { ExecutionProfile } from "../../src/shared/runtime.ts";
import { parseGitRemote } from "../../src/shared/git-host.ts";

/** Disposable test state, never a product/user approval. */
export function approvedRun(
  key: string = randomUUID(),
  overrides: Partial<ExecutionProfile> = {},
) {
  const w = ownerFixture(key);
  apply(w, "owner", {
    type: "configure_execution",
    projectId: "first-project",
    profile: {
      repositoryPath: "/fixture",
      baseBranch: "main",
      baseCommit: "b".repeat(40),
      connectionId: randomUUID(),
      connectionVersion: 1,
      image: "roopre-runner:0.3",
      checks: [
        { name: "typecheck", argv: ["node", "--version"], timeoutSeconds: 10 },
        { name: "test", argv: ["node", "--version"], timeoutSeconds: 10 },
      ],
      webRequired: false,
      budgetUsd: 1,
      timeoutMinutes: 10,
      repairLimit: 1,
      gitHost: { remote: parseGitRemote("https://gitlab.com/fixture/app.git") },
      ...overrides,
    },
  });
  const id = apply(w, "owner", {
    type: "create_feature",
    projectId: "first-project",
    title: "Fixture",
    template: "feature",
    requirements: "AC01 fixture",
  }).entityId!;
  const f = w.features.find((f) => f.id === id)!;
  apply(w, "owner", {
    type: "save_draft",
    featureId: id,
    expectedRevision: 0,
    requirements: "AC01 fixture",
    body: sections.map((s) => `## ${s}\nFixture detail`).join("\n\n"),
  });
  apply(w, "owner", {
    type: "publish_design",
    featureId: id,
    expectedRevision: 1,
  });
  apply(
    w,
    "owner",
    {
      type: "review",
      featureId: id,
      designId: f.designs[0].id,
      decision: "approve",
      checked: [],
    },
    { authentication: "app-confirmation", binding: approvalBinding(w, f) },
  );
  apply(w, "owner", {
    type: "queue_run",
    featureId: id,
    designId: f.designs[0].id,
  });
  const run = w.runs[0];
  run.status = "ready_for_merge";
  Object.assign(run.runtime!, {
    terminationConfirmed: true,
    worktree: "/fixture/checkout",
    branch: "roopre/fixture",
    head: "a".repeat(40),
  });
  return { w, f, run };
}
