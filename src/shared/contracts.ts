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
  executionProfileIssues,
  type ExecutionProfile,
  type RuntimeDetails,
  type RuntimeStatus,
} from "./runtime.ts";

export const sections = [
  "요구사항",
  "구조",
  "API·데이터",
  "예외 상황",
  "변경 영향",
  "검증 계획",
  "적용·복구",
] as const;
export type Person = {
  id: string;
  name: string;
  role: "admin" | "developer" | "agent";
  teamId: string;
};
export type Project = {
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
};
export type Decision = {
  actorId: string;
  decision: "approve" | "request_changes" | "withdraw";
  checked: string[];
  binding?: string;
  authentication?: "macos-owner";
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
export function gate(workspace: Workspace, feature: Feature): Gate {
  const design = latestDesign(feature);
  if (!design)
    return {
      eligible: false,
      status: "draft",
      reasons: ["설계를 게시하고 개발자 리뷰를 요청하세요."],
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
    reasons.push("팀 지침이 변경됐습니다. 새 설계를 게시해 재리뷰하세요.");
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
    reasons.push("필수 검토자가 변경됐습니다. 새 설계를 게시하세요.");
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
        d.authentication === "macos-owner" &&
        d.binding,
    )
  )
    reasons.push("사용자 본인의 설계 승인이 필요합니다.");
  if (blockers)
    reasons.push(`차단 의견 ${blockers}건의 해결 확인이 필요합니다.`);
  if (changed) reasons.push("수정 요청한 검토자의 재승인이 필요합니다.");
  if (approved < design.reviewers.length)
    reasons.push(`필수 승인 ${approved}/${design.reviewers.length}`);
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
