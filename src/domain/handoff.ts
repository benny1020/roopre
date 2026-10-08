import { gate, latestDesign, type Workspace } from "../shared/contracts.ts";
import { approvalBinding } from "./runtime.ts";

/** This is an admission check, not an approval. Only existing human approval qualifies. */
export function publishableRun(w: Workspace, id: string) {
  const run = w.runs.find((r) => r.id === id);
  const feature = w.features.find((f) => f.id === run?.featureId);
  if (
    !run?.runtime ||
    !feature ||
    !latestDesign(feature) ||
    run.status !== "ready_for_merge" ||
    run.runtime.terminationConfirmed !== true ||
    run.designId !== latestDesign(feature)?.id ||
    run.policyVersion !== w.policies.at(-1)?.version ||
    run.runtime.binding !== approvalBinding(w, feature) ||
    !gate(w, feature, approvalBinding(w, feature)).eligible
  )
    throw Error(
      "Current design approval and verified execution evidence are required for publishing.",
    );
  return run as typeof run & { runtime: NonNullable<typeof run.runtime> };
}

/** Called under the workspace row lock. External I/O never holds a DB transaction. */
export function assertHandoffContractsUnchanged(
  before: Workspace,
  after: Workspace,
) {
  for (const old of before.runs.filter((r) => r.runtime?.handoff)) {
    try {
      const run = publishableRun(after, old.id);
      if (
        run.runtime.binding !== old.runtime!.handoff!.binding ||
        run.runtime.head !== old.runtime!.head ||
        run.runtime.branch !== old.runtime!.branch ||
        run.runtime.worktree !== old.runtime!.worktree ||
        JSON.stringify(run.runtime.profile) !==
          JSON.stringify(old.runtime!.profile)
      )
        throw Error("Changed publishing contract");
    } catch {
      throw Error(
        "Remote publishing is in progress. Wait for it to finish before changing this feature's approval, instructions or execution contract.",
      );
    }
  }
}
