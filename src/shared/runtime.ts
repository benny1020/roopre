import { z } from "zod";
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
  profile: ExecutionProfile;
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
  cancelRequested?: boolean;
};
export const standardSteps = [
  {
    id: "requirements",
    name: "요구사항",
    artifact: "문제·범위·완료 기준 AC",
    gate: "검증할 결과 명시",
  },
  {
    id: "design",
    name: "설계",
    artifact: "7개 설계 항목·검증/복구 계획",
    gate: "본인 OS 인증 승인",
  },
  {
    id: "implementation",
    name: "구현",
    artifact: "격리된 작업 공간·변경 diff",
    gate: "승인 계약 유지",
  },
  {
    id: "verification",
    name: "리뷰·테스트",
    artifact: "고정 검사·AC별 리뷰·웹 테스트",
    gate: "모든 필수 검사 통과",
  },
  {
    id: "delivery",
    name: "결과 확인",
    artifact: "commit·검증·수정 이력",
    gate: "기존 병합 정책 적용",
  },
] as const;
