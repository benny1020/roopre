import { randomUUID } from "node:crypto";
import { publishableRun } from "../../domain/handoff.ts";
import type { Workspace } from "../../shared/contracts.ts";
import type { GitHostAdapter } from "./adapter.ts";

type Dependencies = {
  read: () => Promise<Workspace>;
  mutate: (fn: (w: Workspace) => void) => Promise<void>;
  git: (cwd: string, ...args: string[]) => Promise<string>;
  adapter?: GitHostAdapter;
  provider: "github" | "gitlab" | "generic";
};

/** Serialized admission, durable external-write intents, and explicit uncertain outcomes. */
export async function deliverVerifiedRun(
  deps: Dependencies,
  input: { runId: string; title: string; body: string },
) {
  const attemptId = randomUUID();
  await deps.mutate((w) => {
    const run = publishableRun(w, input.runId);
    if (run.runtime.handoff)
      throw Error("Remote publishing is already in progress.");
    if (!run.runtime.profile.gitHost)
      throw Error("Detect the Git remote in project execution settings first.");
    run.runtime.handoff = {
      attemptId,
      binding: run.runtime.binding,
      startedAt: new Date().toISOString(),
    };
    run.runtime.delivery ??= {
      provider: deps.provider,
      branch: run.runtime.branch!,
      headSha: run.runtime.head!,
      baseSha: run.runtime.profile.baseCommit,
      deliveredAt: new Date().toISOString(),
      status: "unverified",
    };
  });
  const current = async () => {
    const run = publishableRun(await deps.read(), input.runId);
    if (run.runtime.handoff?.attemptId !== attemptId)
      throw Error("Publishing ownership changed. Reconcile remote evidence.");
    return run;
  };
  const record = async (fn: (r: ReturnType<typeof publishableRun>) => void) => {
    await deps.mutate((w) => {
      const run = publishableRun(w, input.runId);
      if (run.runtime.handoff?.attemptId !== attemptId)
        throw Error("Publishing ownership changed.");
      fn(run);
    });
  };
  try {
    const run = await current();
    const { worktree, branch, head, profile } = run.runtime;
    const binding = profile.gitHost!;
    if (!worktree || !branch || !head)
      throw Error(
        "Missing worktree, branch or commit evidence for publishing.",
      );
    const localEvidence = async () => {
      if ((await deps.git(worktree, "rev-parse", "HEAD")) !== head)
        throw Error("Worktree changed since verification. Start a new run.");
      if (
        (await deps.git(worktree, "rev-parse", profile.baseBranch)) !==
        profile.baseCommit
      )
        throw Error(
          "Local base branch changed. Verify against the latest base.",
        );
    };
    await localEvidence();
    const targetTip = async () => {
      const refs = await deps.git(
        worktree,
        "ls-remote",
        "--heads",
        binding.remote.url,
        `refs/heads/${profile.baseBranch}`,
      );
      if (refs.trim().split(/\s+/)[0] !== profile.baseCommit)
        throw Error(
          "Remote target branch changed. Verify against the latest target before publishing.",
        );
    };
    await targetTip();
    const remote = await deps.git(
      worktree,
      "ls-remote",
      "--heads",
      binding.remote.url,
      `refs/heads/${branch}`,
    );
    const existing = remote.trim().split(/\s+/)[0];
    if (existing && existing !== head)
      throw Error(
        "Remote branch points to another commit. Use a new attempt branch.",
      );
    if (!existing) {
      if (run.runtime.delivery?.pushIntent)
        throw Error(
          "A previous push has an unknown outcome. Inspect the remote branch before starting a new run; no push was repeated.",
        );
      await record((r) => {
        r.runtime.delivery!.pushIntent = new Date().toISOString();
      });
      await current();
      await localEvidence();
      await deps.git(
        worktree,
        "push",
        binding.remote.url,
        `${head}:refs/heads/${branch}`,
      );
    }
    const marker = `<!-- roopre-run:${input.runId}:${head} -->`;
    const changeInput = {
      remote: binding.remote,
      head: branch,
      base: profile.baseBranch,
      title: input.title,
      body: `${input.body}\n\n${marker}`,
    };
    if (deps.adapter) {
      let change = run.runtime.delivery?.changeId
        ? await deps.adapter.snapshotChange(
            binding.remote,
            run.runtime.delivery.changeId,
          )
        : await deps.adapter.findChange(changeInput, marker);
      if (!change) {
        if (run.runtime.delivery?.createIntent)
          throw Error(
            "A previous PR/MR request has an unknown outcome. Reconcile again or inspect the Git host; no duplicate request was sent.",
          );
        await targetTip();
        await record((r) => {
          r.runtime.delivery!.createIntent = new Date().toISOString();
        });
        await current();
        await localEvidence();
        change = await deps.adapter.createDraftChange(changeInput);
      }
      // Identity is durable before waiting or validating provider-populated SHA fields.
      await record((r) => {
        r.runtime.delivery!.changeId = change!.id;
        r.runtime.delivery!.url = change!.url;
      });
      change = await deps.adapter.waitForRefs(binding.remote, change);
      await targetTip();
      if (change.state !== "open" || !change.draft)
        throw Error(
          "The remote change is not an open draft. Inspect it on the Git host.",
        );
      if (
        !change.sameRepository ||
        change.headRef !== branch ||
        change.baseRef !== profile.baseBranch
      )
        throw Error(
          "PR/MR repository or branch differs from this run. Inspect the remote change.",
        );
      if (change.headSha !== head || change.baseSha !== profile.baseCommit)
        throw Error(
          "PR/MR head or target SHA differs from verification evidence. Remote identity was preserved.",
        );
    }
    await targetTip();
    await record((r) => {
      r.runtime.delivery!.status = "verified";
      r.runtime.delivery!.diagnostic = undefined;
      r.reason = deps.adapter
        ? "Draft PR/MR verified. Git host checks and human merge approval are still required."
        : "Remote branch published. Create a PR/MR using your host's review process.";
    });
    const delivery = (await current()).runtime.delivery!;
    return { url: delivery.url, branch };
  } catch (error) {
    await deps.mutate((w) => {
      const run = w.runs.find((r) => r.id === input.runId);
      if (
        run?.runtime?.handoff?.attemptId === attemptId &&
        run.runtime.delivery
      ) {
        run.runtime.delivery.status = "unverified";
        run.runtime.delivery.diagnostic = (error as Error).message;
      }
    });
    throw error;
  } finally {
    await deps.mutate((w) => {
      const runtime = w.runs.find((r) => r.id === input.runId)?.runtime;
      if (runtime?.handoff?.attemptId === attemptId) delete runtime.handoff;
    });
  }
}

/** Reconcile saved identity without any push or POST, even when approval has been invalidated. */
export async function inspectRunDelivery(deps: Dependencies, runId: string) {
  const initial = (await deps.read()).runs.find((r) => r.id === runId);
  const runtime = initial?.runtime;
  if (
    !runtime?.delivery ||
    !runtime.worktree ||
    !runtime.branch ||
    !runtime.head ||
    !runtime.profile.gitHost
  )
    throw Error("No remote publishing evidence to reconcile.");
  if (runtime.handoff)
    throw Error("Wait for publishing to finish before reconciling it.");
  const { profile, head, branch, worktree } = runtime;
  const remote = profile.gitHost!.remote;
  const branchTip = (
    await deps.git(
      worktree,
      "ls-remote",
      "--heads",
      remote.url,
      `refs/heads/${branch}`,
    )
  )
    .trim()
    .split(/\s+/)[0];
  const targetTip = (
    await deps.git(
      worktree,
      "ls-remote",
      "--heads",
      remote.url,
      `refs/heads/${profile.baseBranch}`,
    )
  )
    .trim()
    .split(/\s+/)[0];
  const marker = `<!-- roopre-run:${runId}:${head} -->`;
  const change = deps.adapter
    ? runtime.delivery.changeId
      ? await deps.adapter.snapshotChange(remote, runtime.delivery.changeId)
      : await deps.adapter.findChange(
          {
            remote,
            head: branch,
            base: profile.baseBranch,
            title: "",
            body: "",
          },
          marker,
        )
    : undefined;
  let verified = false;
  await deps.mutate((w) => {
    const run = w.runs.find((r) => r.id === runId);
    if (
      !run?.runtime?.delivery ||
      run.runtime.handoff ||
      run.runtime.head !== head
    )
      throw Error("Publishing evidence changed. Reconcile it again.");
    if (change) {
      run.runtime.delivery.changeId = change.id;
      run.runtime.delivery.url = change.url;
    }
    try {
      publishableRun(w, runId);
      verified =
        branchTip === head &&
        targetTip === profile.baseCommit &&
        (!deps.adapter ||
          (!!change &&
            change.state === "open" &&
            change.draft &&
            change.sameRepository &&
            change.headRef === branch &&
            change.baseRef === profile.baseBranch &&
            change.headSha === head &&
            change.baseSha === profile.baseCommit));
    } catch {
      verified = false;
    }
    run.runtime.delivery.status = verified ? "verified" : "unverified";
    run.runtime.delivery.diagnostic = verified
      ? undefined
      : "Remote evidence is incomplete or the approved contract changed. Inspect the Git host; no remote writes were made.";
  });
  return { url: change?.url ?? runtime.delivery.url, branch, verified };
}
