import {
  harnessPackageSchema,
  packageSourceSchema,
  bindingSchema,
  type HarnessInstallation,
} from "./harness-package.ts";
import {
  agentSchema,
  workflowSchema,
  workflowIssues,
  type AgentDefinition,
  type Workflow,
} from "./harness.ts";
import { z } from "zod";
import {
  profileSchema,
  executionCapacitySchema,
  executionProfileIssues,
  type ExecutionProfile,
  type ExecutionCapacity,
  type RuntimeDetails,
  type RuntimeStatus,
} from "./runtime.ts";
import { workMemorySchema, type WorkMemory } from "./memory.ts";

export const sections = [
  "요구사항",
  "구조",
  "API·데이터",
  "예외 상황",
  "변경 영향",
  "검증 계획",
  "적용·복구",
] as const;
// Stable wire keys preserve existing approvals and review comments. Labels and
// new documents use English; both heading formats remain valid on disk.
export const sectionLabels: Record<(typeof sections)[number], string> = {
  요구사항: "Requirements",
  구조: "Architecture",
  "API·데이터": "API & Data",
  "예외 상황": "Failure cases",
  "변경 영향": "Change impact",
  "검증 계획": "Verification plan",
  "적용·복구": "Rollout & Recovery",
};
export function designSectionKey(title: string) {
  return sections.find(
    (key) => key === title.trim() || sectionLabels[key] === title.trim(),
  );
}
export function designSectionLabel(title: string) {
  const key = designSectionKey(title);
  return key ? sectionLabels[key] : title;
}
export function hasDesignSections(body: string) {
  const headings = new Set(
    body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("## "))
      .map((line) => designSectionKey(line.slice(3))),
  );
  return sections.every((key) => headings.has(key));
}
export const designPrompts = [
  "Describe existing components and change responsibilities.",
  "Describe input/output contracts and data changes.",
  "Describe failure, duplicate request and authorization handling.",
  "Describe affected features and dependencies.",
  "Describe verification for each acceptance criterion.",
  "Describe rollout order and recovery steps.",
];
export function hasDesignPlaceholders(body: string) {
  return (
    body.includes("작성하세요.") ||
    designPrompts.some((prompt) => body.includes(prompt))
  );
}
export type Person = {
  id: string;
  name: string;
  role: "admin" | "developer" | "agent";
  teamId: string;
};
export type Project = {
  harness?: HarnessInstallation;
  workflow?: Workflow;
  id: string;
  name: string;
  description: string;
  color: string;
  instructions?: string;
  ownerId?: string;
  executionProfile?: ExecutionProfile;
  reviewerIds: string[];
  requiredChecks: string[];
  // Omitted in legacy workspace rows. New writes always create this collection.
  memories?: WorkMemory[];
};
export type Decision = {
  actorId: string;
  decision: "approve" | "request_changes" | "withdraw";
  checked: string[];
  binding?: string;
  // macos-owner is retained so older persisted local workspaces remain usable.
  authentication?: "app-confirmation" | "macos-owner";
  at: string;
};
export type Design = {
  id: string;
  number: number;
  body: string;
  requirements: string;
  hash: string;
  at: string;
  policyVersion: number;
  reviewers: string[];
  decisions: Decision[];
  policyBinding?: string;
};
export type Thread = {
  id: string;
  designId: string;
  section: string;
  quote: string;
  authorId: string;
  body: string;
  blocking: boolean;
  status: "open" | "addressed" | "resolved";
  replies: { actorId: string; body: string; at: string }[];
  at: string;
  resolvedBy?: string;
};
export type Feature = {
  harnessScope?: string;
  id: string;
  projectId: string;
  title: string;
  template: "feature" | "bug";
  authorId: string;
  createdAt: string;
  updatedAt: string;
  draft: { revision: number; body: string; requirements: string };
  designs: Design[];
  threads: Thread[];
  dependencies: string[];
};
export type Run = {
  id: string;
  featureId: string;
  designId: string;
  status: RuntimeStatus;
  runtime?: RuntimeDetails;
  reason: string;
  policyVersion: number;
  effectivePolicy: string;
  at: string;
  actorId: string;
};
export type Policy = {
  version: number;
  global: string;
  design: string;
  implementation: string;
  reviewer: string;
  requiredChecks: string[];
  at: string;
  authorId: string;
};
export type Workspace = {
  agents?: AgentDefinition[];
  teamId: string;
  mode?: "local-owner" | "development-fixture";
  revision: number;
  people: Person[];
  projects: Project[];
  features: Feature[];
  runs: Run[];
  policies: Policy[];
  // Legacy local workspaces omit this. The runner resolves a safe default.
  executionCapacity?: ExecutionCapacity;
};
export type Gate = {
  eligible: boolean;
  status: "draft" | "in_review" | "changes_requested" | "approved";
  reasons: string[];
  approved: number;
  required: number;
  blockers: number;
};
export type Snapshot = Workspace & {
  gates: Record<string, Gate>;
  // Current, feature-scoped approval contract. The renderer must send this
  // value back only after a human explicitly confirms the displayed report.
  approvalBindings?: Record<string, string>;
  sequence: number;
  mode: "development-fixture" | "local-owner";
  runnerConnected: boolean;
};
export type Event = {
  sequence: number;
  type: string;
  actorId: string;
  featureId?: string;
  at: string;
  revision: number;
};

const id = z.string().min(1).max(100);
const body = z.string().trim().min(1).max(60000);
const featureId = { featureId: id };
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("apply_harness_package"),
    projectId: id,
    expectedRevision: z.number().int().nonnegative(),
    package: harnessPackageSchema,
    profileId: z.string(),
    bindings: bindingSchema,
    source: packageSourceSchema,
  }),
  z.object({
    type: z.literal("save_memory"),
    projectId: id,
    expectedRevision: z.number().int().nonnegative(),
    promoteToProject: z.boolean().default(false),
    memory: workMemorySchema.omit({
      createdAt: true,
      updatedAt: true,
      authorId: true,
    }),
  }),
  z.object({
    type: z.literal("deactivate_memory"),
    projectId: id,
    memoryId: id,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("set_feature_scope"),
    featureId: id,
    expectedRevision: z.number().int().nonnegative(),
    scopeId: z.string().optional(),
  }),
  z.object({
    type: z.literal("save_agent"),
    expectedRevision: z.number().int().nonnegative(),
    agent: agentSchema,
  }),
  z.object({
    type: z.literal("save_workflow"),
    projectId: id,
    expectedRevision: z.number().int().nonnegative(),
    workflow: workflowSchema,
  }),
  z.object({
    type: z.literal("queue_planning"),
    featureId: id,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("configure_execution"),
    projectId: id,
    profile: profileSchema,
  }),
  z.object({
    type: z.literal("configure_execution_capacity"),
    expectedRevision: z.number().int().nonnegative(),
    capacity: executionCapacitySchema,
  }),
  z.object({
    type: z.literal("create_project"),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(300),
    reviewerIds: z.array(id).min(1).max(10),
  }),
  z.object({
    type: z.literal("create_feature"),
    projectId: id,
    title: z.string().trim().min(1).max(160),
    template: z.enum(["feature", "bug"]),
    requirements: body,
  }),
  z.object({
    type: z.literal("save_draft"),
    ...featureId,
    expectedRevision: z.number().int().nonnegative(),
    body,
    requirements: body,
  }),
  z.object({
    type: z.literal("publish_design"),
    ...featureId,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("add_thread"),
    ...featureId,
    designId: id,
    section: z.enum(sections),
    quote: z.string().max(3000),
    body: z.string().min(1).max(10000),
    blocking: z.boolean(),
  }),
  z.object({
    type: z.literal("reply_thread"),
    ...featureId,
    threadId: id,
    body: z.string().min(1).max(10000),
  }),
  z.object({ type: z.literal("address_thread"), ...featureId, threadId: id }),
  z.object({ type: z.literal("resolve_thread"), ...featureId, threadId: id }),
  z.object({
    type: z.literal("review"),
    ...featureId,
    designId: id,
    decision: z.enum(["approve", "request_changes", "withdraw"]),
    checked: z.array(z.enum(sections)),
    confirmationBinding: z.string().length(64).optional(),
  }),
  z.object({ type: z.literal("queue_run"), ...featureId, designId: id }),
  z.object({ type: z.literal("cancel_run"), runId: id }),
  z.object({
    type: z.literal("set_dependencies"),
    ...featureId,
    dependencyIds: z.array(id).max(30),
  }),
  z.object({
    type: z.literal("publish_policy"),
    expectedVersion: z.number().int().positive(),
    global: body,
    design: body,
    implementation: body,
    reviewer: body,
    requiredChecks: z.array(z.string().min(1).max(100)).min(1).max(20),
  }),
  z.object({
    type: z.literal("update_project_policy"),
    instructions: z.string().max(20000).optional(),
    projectId: id,
    requiredChecks: z.array(z.string().min(1).max(100)).min(1).max(20),
    reviewerIds: z.array(id).min(1).max(10),
  }),
]);
export type Command = z.infer<typeof commandSchema>;

export function latestDesign(feature: Feature) {
  return feature.designs.at(-1);
}
export function gate(
  workspace: Workspace,
  feature: Feature,
  currentApprovalBinding?: string,
): Gate {
  const design = latestDesign(feature);
  if (!design)
    return {
      eligible: false,
      status: "draft",
      reasons: ["Publish the design and request review."],
      approved: 0,
      required: workspace.projects
        .find((p) => p.id === feature.projectId)!
        .reviewerIds.filter(
          (id) => workspace.mode === "local-owner" || id !== feature.authorId,
        ).length,
      blockers: 0,
    };
  const policy = workspace.policies.at(-1)!;
  const project = workspace.projects.find((p) => p.id === feature.projectId)!;
  const blockers = feature.threads.filter(
    (t) => t.blocking && t.status !== "resolved",
  ).length;
  const approved = design.reviewers.filter(
    (id) =>
      design.decisions.find((d) => d.actorId === id)?.decision === "approve",
  ).length;
  const changed = design.decisions.some(
    (d) => d.decision === "request_changes",
  );
  const reasons: string[] = workflowIssues(workspace, project);
  if (design.policyVersion !== policy.version)
    reasons.push("Team instructions changed. Publish a new design for review.");
  if (
    JSON.stringify([...design.reviewers].sort()) !==
    JSON.stringify(
      project.reviewerIds
        .filter(
          (id) => workspace.mode === "local-owner" || id !== feature.authorId,
        )
        .sort(),
    )
  )
    reasons.push("Required reviewers changed. Publish a new design.");
  if (workspace.mode === "local-owner")
    reasons.push(
      ...executionProfileIssues(project.executionProfile, [
        ...policy.requiredChecks,
        ...project.requiredChecks,
      ]),
    );
  if (
    workspace.mode === "local-owner" &&
    !design.decisions.some(
      (d) =>
        d.actorId === project.ownerId &&
        d.decision === "approve" &&
        (d.authentication === "app-confirmation" ||
          d.authentication === "macos-owner") &&
        d.binding &&
        (!currentApprovalBinding || d.binding === currentApprovalBinding),
    )
  )
    reasons.push("Your design approval is required.");
  if (blockers)
    reasons.push(`${blockers} blocking comments need confirmed resolution.`);
  if (changed)
    reasons.push("Reviewers who requested changes must approve again.");
  if (approved < design.reviewers.length)
    reasons.push(`Required approvals ${approved}/${design.reviewers.length}`);
  return {
    eligible: reasons.length === 0,
    status:
      reasons.length === 0
        ? "approved"
        : changed || blockers
          ? "changes_requested"
          : "in_review",
    reasons,
    approved,
    required: design.reviewers.length,
    blockers,
  };
}
