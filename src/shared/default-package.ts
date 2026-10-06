import {
  harnessPackageSchema,
  type HarnessPackage,
} from "./harness-package.ts";
import { stages } from "./harness-stages.ts";
export function defaultPackage(): HarnessPackage {
  const roles = [
    [
      "requirements",
      "Requirements analyst",
      "requirements",
      "Clarify goals, scope and acceptance criteria. Identify unresolved questions.",
    ],
    [
      "designer",
      "Architect",
      "design",
      "Design architecture, data contracts, failure handling, impact, verification and recovery in concrete terms.",
    ],
    [
      "design-reviewer",
      "Design reviewer",
      "design",
      "Check the design for gaps, impact and unnecessary complexity, then propose an improved draft. Never replace human approval.",
    ],
    [
      "developer",
      "Implementer",
      "implementation",
      "Implement within the approved design and repair failures using evidence. Never weaken tests or policies.",
    ],
    [
      "acceptance-reviewer",
      "Acceptance verifier",
      "verification",
      "Compare each acceptance criterion with implementation and test evidence. Report unsupported completion claims as failures.",
    ],
    [
      "convention-reviewer",
      "Convention reviewer",
      "verification",
      "Check global and project instructions, naming, structure and error-handling conventions.",
    ],
    [
      "code-reviewer",
      "Code reviewer",
      "review",
      "Read the actual diff and report defects, regressions and maintainability issues with evidence.",
    ],
  ];
  return harnessPackageSchema.parse({
    schema: "roopre.harness/v1",
    id: "roopre.standard",
    version: "1.1.0",
    name: "Roopre development standard",
    instructions:
      "Implement only after human design approval. Preserve required check and review evidence. Never mark failed work as complete.",
    agents: roles.map(([id, name, stage, instructions]) => ({
      id,
      name,
      description: "Default role",
      capability: stage === "implementation" ? "implementation" : "read-only",
      instructions,
      connection: "project",
    })),
    profiles: [
      {
        id: "standard",
        name: "Default workflow",
        instructions: "",
        stageInstructions: Object.fromEntries(stages.map((s) => [s, ""])),
        assignments: roles.map(([id, , stage]) => ({
          id,
          agentId: id,
          stage,
          required: true,
        })),
        requiredChecks: ["typecheck", "test", "review"],
        checks: [],
        scopes: [],
      },
    ],
  });
}
