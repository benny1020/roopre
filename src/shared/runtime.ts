import type { ResolvedHarness, AgentExecution } from "./harness.ts";
import { z } from "zod";
import { gitHostBindingSchema } from "./git-host.ts";
export const projectRuntimeSchema = z.enum(["node", "java-gradle"]);
export type ProjectRuntime = z.infer<typeof projectRuntimeSchema>;
export type RepositoryRuntime = {
  runtime: ProjectRuntime;
  framework?: "spring-boot";
};
export const executionCapacitySchema = z
  .object({
    maxConcurrentRuns: z.number().int().min(1).max(6),
    maxConcurrentRunsPerProject: z.number().int().min(1).max(4),
    maxAgentsPerStage: z.number().int().min(1).max(4),
  })
  .refine(
    (value) => value.maxConcurrentRunsPerProject <= value.maxConcurrentRuns,
    {
      message: "Per-project run limit cannot exceed the workspace limit.",
      path: ["maxConcurrentRunsPerProject"],
    },
  );
export type ExecutionCapacity = z.infer<typeof executionCapacitySchema>;
export const defaultExecutionCapacity: ExecutionCapacity = {
  maxConcurrentRuns: 3,
  maxConcurrentRunsPerProject: 2,
  maxAgentsPerStage: 3,
};
export function executionCapacityOf(value?: Partial<ExecutionCapacity>) {
  const parsed = executionCapacitySchema.safeParse({
    ...defaultExecutionCapacity,
    ...value,
  });
  return parsed.success ? parsed.data : defaultExecutionCapacity;
}
const nodeChecks = [
  {
    name: "typecheck",
    argv: ["pnpm", "run", "typecheck"],
    timeoutSeconds: 120,
  },
  { name: "test", argv: ["pnpm", "test"], timeoutSeconds: 300 },
  {
    name: "e2e",
    argv: ["pnpm", "exec", "playwright", "test"],
    timeoutSeconds: 600,
  },
] as const;
const javaGradleChecks = [
  {
    name: "typecheck",
    argv: ["gradle", "--no-daemon", "classes"],
    timeoutSeconds: 600,
  },
  {
    name: "test",
    argv: ["gradle", "--no-daemon", "test"],
    timeoutSeconds: 900,
  },
] as const;
export function defaultChecksForRuntime(runtime: ProjectRuntime) {
  return structuredClone(
    runtime === "java-gradle" ? javaGradleChecks : nodeChecks,
  );
}
export function runnerImageForRuntime(_runtime: ProjectRuntime) {
  return "roopre-runner:0.3";
}
export const checkSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  argv: z.array(z.string().min(1).max(500)).min(1).max(30),
  timeoutSeconds: z.number().int().min(5).max(1800),
});
export const profileSchema = z.object({
  repositoryPath: z.string().min(1).max(2000),
  baseBranch: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,150}$/),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  connectionId: z.string().uuid(),
  connectionVersion: z.number().int().positive(),
  image: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]{0,180}$/),
  checks: z.array(checkSchema).min(2).max(20),
  webRequired: z.boolean(),
  budgetUsd: z.number().positive().max(1000),
  timeoutMinutes: z.number().int().min(1).max(240),
  repairLimit: z.number().int().min(0).max(3),
  runtime: projectRuntimeSchema.optional(),
  gitHost: gitHostBindingSchema.optional(),
});
export type ExecutionProfile = z.infer<typeof profileSchema>;
export const connectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  endpoint: z.string().url().max(2000),
  auth: z.enum(["api-key", "bearer"]),
  model: z.string().trim().min(1).max(120),
  key: z.string().min(1).max(4096).optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
export type ConnectionInfo = Omit<ConnectionInput, "key" | "id"> & {
  id: string;
  version: number;
  hasKey: boolean;
  testedAt?: string;
  testStatus?: "passed" | "failed";
  diagnostic?: string;
};
export type Evidence = {
  name: string;
  status: "passed" | "failed";
  code: number;
  at: string;
  tree: string;
  log: string;
  attempt: number;
};
export type RuntimeStatus =
  | "completed"
  | "queued"
  | "preparing"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "repairing"
  | "ready_for_merge"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "blocked";
export const activeStatuses = [
  "queued",
  "preparing",
  "implementing",
  "verifying",
  "reviewing",
  "repairing",
];
export type RuntimeDetails = {
  kind?: "planning";
  draftRevision?: number;
  harness?: ResolvedHarness;
  agents?: AgentExecution[];
  profile: ExecutionProfile;
  capacity?: ExecutionCapacity;
  binding: string;
  attempt: number;
  lease?: string;
  heartbeat?: string;
  container?: string;
  worktree?: string;
  branch?: string;
  head?: string;
  costUsd: number;
  costReported?: boolean;
  terminationConfirmed?: boolean;
  resumeFrom?: string;
  artifactRoot?: string;
  artifacts?: { path: string; hash: string; bytes: number; attempt: number }[];
  costEstimated: true;
  events: { at: string; message: string }[];
  evidence: Evidence[];
  review?: string;
  delivery?: {
    provider: "github" | "gitlab" | "generic";
    branch: string;
    headSha: string;
    baseSha: string;
    changeId?: string;
    url?: string;
    deliveredAt: string;
  };
  cancelRequested?: boolean;
};
export const standardSteps = [
  {
    id: "requirements",
    name: "Requirements",
    artifact: "Problem, scope & acceptance criteria",
    gate: "Define verifiable outcomes",
  },
  {
    id: "design",
    name: "Design",
    artifact: "Seven design sections, verification & recovery plan",
    gate: "Your explicit approval",
  },
  {
    id: "implementation",
    name: "Implementation",
    artifact: "Isolated workspace & diff",
    gate: "Maintain approval contract",
  },
  {
    id: "verification",
    name: "Review & test",
    artifact: "Fixed checks, acceptance review & web tests",
    gate: "All required checks pass",
  },
  {
    id: "delivery",
    name: "Review results",
    artifact: "Commit, verification & repair history",
    gate: "Follow the existing merge policy",
  },
] as const;

export function executionProfileIssues(
  profile: ExecutionProfile | undefined,
  requiredChecks: string[],
) {
  if (!profile) return ["Connect a repository and execution profile first."];
  const names = profile.checks.map((check) => check.name);
  const issues: string[] = [];
  if (new Set(names).size !== names.length)
    issues.push("Duplicate check names.");
  const required = [
    ...new Set([
      ...requiredChecks.filter((name) => name !== "review"),
      ...(profile.webRequired ? ["e2e"] : []),
    ]),
  ];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length)
    issues.push(`Map required check commands: ${missing.join(", ")}`);
  return issues;
}
