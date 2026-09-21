import { seed } from "./workspace";
import { gate, type Snapshot, type Run } from "../../src/shared/contracts";
import type { ExecutionProfile } from "../../src/shared/runtime";
export const patch = `diff --git a/src/payment.ts b/src/payment.ts
index 1234567..7654321 100644
--- a/src/payment.ts
+++ b/src/payment.ts
@@ -10,3 +10,4 @@ export function payment(error) {
-  return "failed";
+  if (error.retryable) return "retry";
+  return "contact-support";
 }
 
diff --git a/tests/payment.test.ts b/tests/payment.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/payment.test.ts
@@ -0,0 +1,2 @@
+test("duplicate payment is never retried", () => {
+  expect(retryable(duplicate)).toBe(false);
`;
export function adeFixture(): Snapshot {
  const w = seed();
  w.mode = "local-owner";
  w.people[0].id = "owner";
  w.features.forEach((f) => (f.authorId = "owner"));
  w.projects.forEach((p) => (p.ownerId = "owner"));
  const f = w.features[0];
  const at = new Date().toISOString();
  const profile: ExecutionProfile = {
    repositoryPath: "/workspace/commerce",
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    connectionId: "00000000-0000-4000-8000-000000000001",
    connectionVersion: 1,
    image: "roopre-runner:0.2",
    checks: [
      { name: "typecheck", argv: ["pnpm", "typecheck"], timeoutSeconds: 60 },
      { name: "test", argv: ["pnpm", "test"], timeoutSeconds: 60 },
    ],
    webRequired: false,
    budgetUsd: 5,
    timeoutMinutes: 30,
    repairLimit: 2,
  };
  const run: Run = {
    id: "ade-run-current",
    featureId: f.id,
    designId: f.designs.at(-1)!.id,
    status: "verifying",
    policyVersion: 1,
    actorId: "owner",
    at,
    reason: "재시도 조건 수정 후 회귀 검사 실행 중",
    effectivePolicy:
      "# Team standard v1\nVerify acceptance criteria and preserve human design approval.",
    runtime: {
      profile,
      attempt: 2,
      binding: "b".repeat(64),
      costEstimated: true,
      costReported: true,
      costUsd: 0.184,
      head: "c".repeat(40),
      branch: "roopre/payment-retry",
      worktree: "/workspace/commerce/.worktrees/payment-retry",
      heartbeat: at,
      terminationConfirmed: false,
      events: [
        { at, message: "승인된 설계 계약을 확인했습니다." },
        { at, message: "격리된 작업 공간에 payment.ts 변경을 적용했습니다." },
        { at, message: "pnpm typecheck 종료 코드 0" },
        { at, message: "pnpm test 실행 중" },
      ],
      evidence: [
        {
          name: "test",
          attempt: 1,
          tree: "d".repeat(40),
          status: "failed",
          code: 1,
          at,
          log: "Expected false, received true: duplicate payment retry",
        },
        {
          name: "typecheck",
          attempt: 2,
          tree: "e".repeat(40),
          status: "passed",
          code: 0,
          at,
          log: "TypeScript: no errors",
        },
      ],
      agents: [
        {
          id: "ade-agent",
          assignmentId: "assignment",
          name: "구현 에이전트",
          stage: "implementation",
          revision: 2,
          connectionId: profile.connectionId,
          connectionVersion: 1,
          model: "configured-model",
          required: true,
          status: "passed",
          attempt: 2,
          startedAt: at,
          endedAt: at,
          inputTree: "d".repeat(40),
          outputTree: "e".repeat(40),
          instructionHash: "f".repeat(64),
          instructions:
            "# Implementation\nPreserve idempotency. Test duplicate and retryable responses.",
          output:
            "중복 결제와 일시적 오류를 분리했습니다. 회귀 검사를 실행합니다.",
        },
      ],
      artifacts: [
        {
          path: "tests/report.txt",
          hash: "a".repeat(64),
          bytes: 240,
          attempt: 2,
        },
      ],
    },
  };
  w.runs = [
    {
      ...structuredClone(run),
      id: "ade-run-previous",
      status: "failed",
      reason: "첫 시도 테스트 실패",
      runtime: {
        ...structuredClone(run.runtime!),
        attempt: 1,
        terminationConfirmed: true,
      },
    },
    run,
  ];
  return {
    ...w,
    mode: "local-owner",
    sequence: 0,
    runnerConnected: true,
    gates: Object.fromEntries(w.features.map((f) => [f.id, gate(w, f)])),
  };
}
