import { createHash } from "node:crypto";
import type { Workspace, Feature } from "../shared/contracts.ts";
export function policyBinding(w: Workspace, f: Feature) {
  const p = w.projects.find((p) => p.id === f.projectId)!;
  return createHash("sha256")
    .update(
      JSON.stringify({
        policy: w.policies.at(-1),
        project: {
          id: p.id,
          instructions: p.instructions,
          reviewers: p.reviewerIds,
          requiredChecks: p.requiredChecks,
          ownerId: p.ownerId,
          profile: p.executionProfile,
        },
        dependencies: f.dependencies,
      }),
    )
    .digest("hex");
}
export function approvalBinding(w: Workspace, f: Feature) {
  const d = f.designs.at(-1)!;
  return createHash("sha256")
    .update(
      JSON.stringify({
        feature: f.id,
        design: d.id,
        hash: d.hash,
        policy: policyBinding(w, f),
      }),
    )
    .digest("hex");
}
