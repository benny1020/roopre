import {
  assertMergeReady,
  type PullRequest,
  type ReviewReport,
} from "./policy.ts";
export function assertConfirmedHead(head: string, args: string[]) {
  if (
    !/^[a-f0-9]{40}$/.test(head) ||
    args.length !== 2 ||
    args[0] !== "--confirm-head" ||
    args[1] !== head
  )
    throw Error(
      "리뷰 결과를 확인한 뒤 --confirm-head <검토한 전체 head SHA>로 머지를 확인하세요.",
    );
}
export async function approveAndMerge(
  report: ReviewReport,
  actions: {
    snapshot: () => Promise<PullRequest>;
    publication: () => Promise<unknown>;
    approve: (pr: PullRequest) => Promise<void>;
    ready: () => Promise<void>;
    merge: (headSha: string) => Promise<void>;
  },
) {
  let pr = await actions.snapshot();
  assertMergeReady(pr, report);
  await actions.publication();
  await actions.approve(pr);
  pr = await actions.snapshot();
  assertMergeReady(pr, report);
  await actions.publication();
  if (pr.isDraft) await actions.ready();
  await actions.merge(report.headSha);
  const result = await actions.snapshot();
  if (result.state !== "MERGED")
    throw Error("머지 완료를 확인하지 못했습니다. GitHub 상태를 확인하세요.");
  return result;
}
