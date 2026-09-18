import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCurrent,
  assertMergeReady,
  canRecommend,
  reportSchema,
  type PullRequest,
  type ReviewReport,
} from "../config/review/policy.ts";
const report: ReviewReport = {
  schemaVersion: 1,
  pr: 1,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  verdict: "pass",
  reviewedBy: "pr_reviewer",
  findings: [],
  checks: [
    { name: "source review", result: "passed", detail: "Checked pinned code" },
  ],
  limitations: ["No live API test"],
};
const pr: PullRequest = {
  number: 1,
  headRefOid: report.headSha,
  baseRefOid: report.baseSha,
  baseRefName: "main",
  state: "OPEN",
  isDraft: true,
  mergeable: "MERGEABLE",
  url: "https://github.com/benny1020/roopre/pull/1",
  statusCheckRollup: [
    {
      __typename: "CheckRun",
      workflowName: "CI",
      name: "check",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    },
  ],
};
test("PR gate permits only the reviewed PR/head/base and never equates review with human approval", () => {
  assert.doesNotThrow(() => assertMergeReady(pr, report));
  for (const patch of [
    { number: 2 },
    { headRefOid: "c".repeat(40) },
    { baseRefOid: "d".repeat(40) },
    { state: "CLOSED" },
    { baseRefName: "other" },
  ])
    assert.throws(() => assertCurrent({ ...pr, ...patch }, report));
  // The gate intentionally returns no approval token; native authentication is separate.
  assert.equal(assertMergeReady(pr, report), undefined);
  assert.throws(() =>
    reportSchema.parse({ ...report, reviewedBy: "implementation_agent" }),
  );
});
test("PR gate rejects blocking findings, failed evidence, unknown conflicts and missing/pending/skipped checks", () => {
  for (const severity of ["P0", "P1", "P2"] as const)
    assert.equal(
      canRecommend({
        ...report,
        findings: [
          {
            id: "R1",
            severity,
            file: "file.ts",
            line: 1,
            title: "Bug",
            body: "Reproducible failure",
          },
        ],
      }),
      false,
    );
  assert.throws(() =>
    assertMergeReady(pr, { ...report, verdict: "changes_requested" }),
  );
  assert.throws(() =>
    assertMergeReady(pr, {
      ...report,
      checks: [{ name: "regression", result: "failed", detail: "Reproduced" }],
    }),
  );
  assert.throws(() =>
    assertMergeReady({ ...pr, mergeable: "UNKNOWN" }, report),
  );
  assert.throws(() =>
    assertMergeReady({ ...pr, statusCheckRollup: [] }, report),
  );
  for (const conclusion of ["FAILURE", "CANCELLED", "SKIPPED", "NEUTRAL", ""])
    assert.throws(() =>
      assertMergeReady(
        {
          ...pr,
          statusCheckRollup: [{ ...pr.statusCheckRollup[0], conclusion }],
        },
        report,
      ),
    );
  assert.throws(() =>
    assertMergeReady(
      {
        ...pr,
        statusCheckRollup: [
          ...pr.statusCheckRollup,
          { __typename: "StatusContext", context: "extra", state: "PENDING" },
        ],
      },
      report,
    ),
  );
});

// Test ordering without invoking macOS authentication or mutating GitHub.
test("cancelled human authentication cannot mark ready or merge", async () => {
  const { approveAndMerge } = await import("../config/review/merge.ts");
  let mutated = false;
  await assert.rejects(
    approveAndMerge(report, {
      snapshot: async () => pr,
      publication: async () => {},
      approve: async () => {
        throw Error("cancelled");
      },
      ready: async () => {
        mutated = true;
      },
      merge: async () => {
        mutated = true;
      },
    }),
    /cancelled/,
  );
  assert.equal(mutated, false);
});
test("changes during approval invalidate merge, and successful approval merges only the checked head", async () => {
  const { approveAndMerge } = await import("../config/review/merge.ts");
  let approved = false,
    merged = false;
  await assert.rejects(
    approveAndMerge(report, {
      snapshot: async () => ({
        ...pr,
        headRefOid: approved ? "d".repeat(40) : pr.headRefOid,
      }),
      publication: async () => {},
      approve: async () => {
        approved = true;
      },
      ready: async () => {
        merged = true;
      },
      merge: async () => {
        merged = true;
      },
    }),
    /바뀌었/,
  );
  assert.equal(merged, false);
  const events: string[] = [];
  const result = await approveAndMerge(report, {
    snapshot: async () => ({ ...pr, state: merged ? "MERGED" : "OPEN" }),
    publication: async () => {
      events.push("publication");
    },
    approve: async () => {
      events.push("approve");
    },
    ready: async () => {
      events.push("ready");
    },
    merge: async (head) => {
      assert.equal(head, report.headSha);
      events.push("merge");
      merged = true;
    },
  });
  assert.equal(result.state, "MERGED");
  assert.deepEqual(events, [
    "publication",
    "approve",
    "publication",
    "ready",
    "merge",
  ]);
});
