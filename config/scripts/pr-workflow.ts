import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  reportSchema,
  assertCurrent,
  assertMergeReady,
  canRecommend,
  type ReviewReport,
  type PullRequest,
} from "../review/policy.ts";
import { approveAndMerge } from "../review/merge.ts";
import { authenticateOwner } from "../../src/main/approval/native.ts";
const root = resolve(import.meta.dirname, "../..");
const run = (exe: string, args: string[], input?: string) =>
  execFileSync(exe, args, {
    cwd: root,
    encoding: "utf8",
    input,
    maxBuffer: 20_000_000,
  }).trim();
const gh = (args: string[], input?: unknown) =>
  JSON.parse(
    run("gh", args, input === undefined ? undefined : JSON.stringify(input)),
  );
const repo = gh(["repo", "view", "--json", "nameWithOwner"])
  .nameWithOwner as string;
if (repo !== "benny1020/roopre") throw Error("Roopre 저장소에서만 실행하세요.");
const snapshot = (number: number): PullRequest =>
  gh([
    "pr",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "number,headRefOid,baseRefOid,baseRefName,state,isDraft,mergeable,url,statusCheckRollup",
  ]);
const api = (path: string, body?: unknown) =>
  gh(
    ["api", path, ...(body ? ["--method", "POST", "--input", "-"] : [])],
    body,
  );
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const directory = (r: { pr: number; headSha: string }) =>
  join(root, "artifacts/reviews", `pr-${r.pr}-${r.headSha}`);
const bodyFor = (r: ReviewReport) =>
  `<!-- roopre-pr-review:${digest(JSON.stringify(r))} -->\n## 전담 에이전트 리뷰\n\nPR #${r.pr} · head \`${r.headSha}\` · base \`${r.baseSha}\`\n\n판정: **${canRecommend(r) ? "차단 지적 없음 · 사용자 머지 승인 대기" : "수정 후 재리뷰 필요"}**\n\n${r.findings.map((f) => `- **${f.severity} ${f.title}** — ${f.file}:${f.line}\n  ${f.body}`).join("\n") || "확인된 차단 지적 없음."}\n\n검증: ${r.checks.map((c) => `${c.name}: ${c.result} (${c.detail})`).join("; ")}\n\n제한: ${r.limitations.join("; ") || "추가 제한 없음"}\n\n이 결과는 AI 검토 의견이며 사용자 승인이나 GitHub APPROVE가 아닙니다. 코드/기준 브랜치가 바뀌면 재리뷰합니다.\n`;
async function published(r: ReviewReport) {
  const receipt = JSON.parse(
    await readFile(join(directory(r), "published.json"), "utf8"),
  );
  if (receipt.digest !== digest(JSON.stringify(r)))
    throw Error("게시된 보고서와 다릅니다. 리뷰를 다시 게시하세요.");
  const comment = api(`repos/${repo}/issues/comments/${receipt.commentId}`);
  if (comment.body !== bodyFor(r))
    throw Error("원격 리뷰 기록이 변경되거나 삭제됐습니다.");
  return receipt;
}
const [action, arg] = process.argv.slice(2);
if (action === "prepare") {
  if (!/^[1-9]\d*$/.test(arg ?? ""))
    throw Error("사용법: pnpm pr:prepare <PR 번호>");
  const pr = snapshot(Number(arg));
  if (pr.state !== "OPEN" || pr.baseRefName !== "main")
    throw Error("열린 main 대상 PR을 선택하세요.");
  run("git", ["fetch", "origin", pr.headRefOid, pr.baseRefOid]);
  const dir = directory({ pr: pr.number, headSha: pr.headRefOid });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "input.json"), JSON.stringify(pr, null, 2));
  await writeFile(
    join(dir, "diff.patch"),
    run("git", [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      `${pr.baseRefOid}...${pr.headRefOid}`,
    ]),
  );
  console.log(
    `전담 리뷰 입력: ${dir}\n새 pr_reviewer 에이전트에 agents/pr-reviewer.md와 이 경로를 전달하세요. 구현 에이전트가 보고서를 대신 작성하지 않습니다.`,
  );
} else if (["publish", "check", "merge"].includes(action)) {
  if (!arg) throw Error(`사용법: pnpm pr:${action} <전담 리뷰 report.json>`);
  const report = reportSchema.parse(
    JSON.parse(await readFile(resolve(arg), "utf8")),
  );
  const pr = snapshot(report.pr);
  assertCurrent(pr, report);
  const dir = directory(report);
  await mkdir(dir, { recursive: true });
  if (action === "publish") {
    const comment = api(`repos/${repo}/issues/${report.pr}/comments`, {
      body: bodyFor(report),
    });
    await writeFile(
      join(dir, "published.json"),
      JSON.stringify(
        {
          digest: digest(JSON.stringify(report)),
          commentId: comment.id,
          url: comment.html_url,
        },
        null,
        2,
      ),
    );
    await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
    api(`repos/${repo}/statuses/${report.headSha}`, {
      state: canRecommend(report) ? "success" : "failure",
      context: "roopre/pr-review",
      description: canRecommend(report)
        ? "Reviewer passed; human merge approval still required"
        : "Reviewer requests changes",
      target_url: comment.html_url,
    });
    console.log(comment.html_url);
  } else {
    assertMergeReady(pr, report);
    const receipt = await published(report);
    console.log(
      `PR #${pr.number} ${pr.url}\n리뷰: ${receipt.url}\n검사 통과 · 사용자 머지 승인 대기 · ${pr.headRefOid}`,
    );
    if (action === "merge") {
      if (process.platform !== "darwin")
        throw Error("머지는 macOS 본인 승인 환경에서 수행하세요.");
      // No CI/reviewer may call this. Authentication is the user's merge approval.
      const result = await approveAndMerge(report, {
        snapshot: async () => snapshot(report.pr),
        publication: () => published(report),
        approve: async (current) =>
          authenticateOwner(
            join(root, "resources/bin/roopre-approve"),
            `루프리 PR #${current.number} (${current.headRefOid.slice(0, 12)})을 main에 머지하도록 승인`,
          ),
        ready: async () => {
          run("gh", ["pr", "ready", String(report.pr), "--repo", repo]);
        },
        merge: async (head) => {
          // GitHub atomically refuses a changed head; base is rechecked above.
          run("gh", [
            "pr",
            "merge",
            String(report.pr),
            "--repo",
            repo,
            "--squash",
            "--match-head-commit",
            head,
          ]);
        },
      });
      await writeFile(
        join(dir, "merged.json"),
        JSON.stringify(
          {
            headSha: report.headSha,
            baseSha: report.baseSha,
            at: new Date().toISOString(),
            approval: "macos-owner",
            url: result.url,
          },
          null,
          2,
        ),
      );
      console.log(`머지 완료: ${result.url}`);
    }
  }
} else throw Error("prepare <PR> | publish/check/merge <report.json>");
