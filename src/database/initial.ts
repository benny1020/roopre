import type { Workspace } from "../shared/contracts.ts";
import { defaultExecutionCapacity } from "../shared/runtime.ts";

// Product initialization contains only the real local owner and mandatory
// defaults. Projects, features, approvals and executions come from the user.
export function emptyWorkspace(
  key: string,
  mode: NonNullable<Workspace["mode"]>,
): Workspace {
  return {
    teamId: key,
    mode,
    revision: 0,
    people: [
      { id: "owner", name: "You · Project owner", role: "admin", teamId: key },
    ],
    projects: [],
    features: [],
    runs: [],
    executionCapacity: { ...defaultExecutionCapacity },
    policies: [
      {
        version: 1,
        global:
          "Work from approved requirements and designs. Never report completion without verification evidence.",
        design:
          "Specify requirements, architecture, API and data contracts, failure cases, change impact, verification and rollback. Obtain required human design approval before implementation.",
        implementation:
          "Implement and test within the approved scope. Diagnose and fix failures. Request approval again for material design changes.",
        reviewer:
          "Compare the actual design, code and verification results. Do not rely only on the implementer's explanation. Report reproducible findings.",
        requiredChecks: ["typecheck", "test", "review"],
        at: new Date().toISOString(),
        authorId: "owner",
      },
    ],
  };
}
