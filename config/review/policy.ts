import { z } from "zod";
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  pr: z.number().int().positive(),
  headSha: sha,
  baseSha: sha,
  verdict: z.enum(["pass", "changes_requested"]),
  reviewedBy: z.literal("pr_reviewer"),
  findings: z.array(
    z.object({
      id: z.string().min(1),
      severity: z.enum(["P0", "P1", "P2", "P3"]),
      file: z.string().min(1),
      line: z.number().int().positive(),
      title: z.string().min(1),
      body: z.string().min(1),
    }),
  ),
  checks: z
    .array(
      z.object({
        name: z.string().min(1),
        result: z.enum(["passed", "failed", "not_run"]),
        detail: z.string().min(1),
      }),
    )
    .min(1),
  limitations: z.array(z.string()),
});
export type ReviewReport = z.infer<typeof reportSchema>;
export type PullRequest = {
  number: number;
  headRefOid: string;
  baseRefOid: string;
  baseRefName: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  url: string;
  statusCheckRollup: {
    __typename: string;
    name?: string;
    workflowName?: string;
    status?: string;
    conclusion?: string;
    state?: string;
    context?: string;
  }[];
};
export function assertCurrent(pr: PullRequest, report: ReviewReport) {
  if (pr.state !== "OPEN" || pr.baseRefName !== "main")
    throw Error("열린 main 대상 PR만 처리합니다.");
  if (
    pr.number !== report.pr ||
    pr.headRefOid !== report.headSha ||
    pr.baseRefOid !== report.baseSha
  )
    throw Error("PR 또는 기준 커밋이 바뀌었습니다. 최신 변경을 재리뷰하세요.");
}
export function canRecommend(report: ReviewReport) {
  return (
    report.verdict === "pass" &&
    !report.findings.some((f) => f.severity !== "P3") &&
    !report.checks.some((c) => c.result === "failed")
  );
}
export function assertMergeReady(pr: PullRequest, report: ReviewReport) {
  assertCurrent(pr, report);
  if (!canRecommend(report))
    throw Error("전담 리뷰의 차단 지적을 해결하고 재리뷰하세요.");
  if (pr.mergeable !== "MERGEABLE")
    throw Error("충돌 또는 병합 가능 여부 확인이 필요합니다.");
  const checks = pr.statusCheckRollup.filter(
    (c) => c.context !== "roopre/pr-review",
  );
  if (
    !checks.some(
      (c) =>
        c.__typename === "CheckRun" &&
        c.workflowName === "CI" &&
        c.name === "check",
    )
  )
    throw Error("필수 CI check 결과가 없습니다.");
  if (
    checks.some((c) =>
      c.__typename === "CheckRun"
        ? c.status !== "COMPLETED" || c.conclusion !== "SUCCESS"
        : c.state !== "SUCCESS",
    )
  )
    throw Error(
      "최신 CI/검사가 모두 통과해야 합니다. 대기·실패·skip은 통과가 아닙니다.",
    );
}
