import test from "node:test";
import assert from "node:assert/strict";
import { approvedRun } from "./fixtures/approved-run.ts";
import { apply } from "../src/domain/index.ts";
import { assertHandoffContractsUnchanged } from "../src/domain/handoff.ts";
import {
  deliverVerifiedRun,
  inspectRunDelivery,
} from "../src/main/git-hosts/handoff.ts";
import type {
  GitHostAdapter,
  ChangeSnapshot,
} from "../src/main/git-hosts/adapter.ts";
import type { Workspace } from "../src/shared/contracts.ts";

function harness() {
  let { w, f, run } = approvedRun();
  const calls: string[] = [];
  let remoteHead = "";
  let target = "b".repeat(40);
  const snapshot: ChangeSnapshot = {
    id: "7",
    url: "https://gitlab.com/fixture/app/-/merge_requests/7",
    state: "open",
    draft: true,
    headRef: "roopre/fixture",
    baseRef: "main",
    sameRepository: true,
    headSha: "a".repeat(40),
    baseSha: target,
  };
  const adapter = {
    findChange: async () => {
      calls.push("find");
      return undefined;
    },
    createDraftChange: async () => {
      calls.push("create");
      return { ...snapshot };
    },
    snapshotChange: async () => {
      calls.push("snapshot");
      return { ...snapshot };
    },
    waitForRefs: async () => ({ ...snapshot }),
  } as unknown as GitHostAdapter;
  const mutate = async (fn: (w: Workspace) => void) => {
    const next = structuredClone(w);
    fn(next);
    assertHandoffContractsUnchanged(w, next);
    w = next;
  };
  const deps = {
    read: async () => structuredClone(w),
    mutate,
    adapter,
    provider: "gitlab" as const,
    git: async (_cwd: string, ...args: string[]) => {
      calls.push(args[0]);
      if (args[0] === "rev-parse")
        return args[1] === "HEAD" ? "a".repeat(40) : "b".repeat(40);
      if (args[0] === "ls-remote")
        return args.at(-1) === "refs/heads/main"
          ? `${target}\trefs/heads/main`
          : remoteHead;
      if (args[0] === "push") {
        remoteHead = `${"a".repeat(40)}\trefs/heads/roopre/fixture`;
        return "";
      }
      throw Error("Unexpected Git command");
    },
  };
  const input = { runId: run.id, title: "Fixture", body: "Fixture" };
  return {
    deps,
    input,
    calls,
    snapshot,
    get: () => w,
    featureId: f.id,
    setTarget: (sha: string) => {
      target = sha;
    },
  };
}

test("stale approval cannot push or create a remote change", async () => {
  const h = harness();
  await h.deps.mutate((w) => {
    w.features[0].designs[0].decisions = [];
  });
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /Current design approval/,
  );
  assert.deepEqual(h.calls, []);
});

test("publishing freezes its own contract, allows unrelated projects, and rejects simultaneous attempts", async () => {
  const h = harness();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  h.deps.adapter.findChange = async () => {
    entered();
    await gate;
    return undefined;
  };
  const first = deliverVerifiedRun(h.deps, h.input);
  await ready;
  await assert.rejects(
    h.deps.mutate((w) =>
      apply(w, "owner", {
        type: "review",
        featureId: h.featureId,
        designId: w.features[0].designs[0].id,
        decision: "withdraw",
        checked: [],
      }),
    ),
    /publishing is in progress/,
  );
  await h.deps.mutate((w) =>
    apply(w, "owner", {
      type: "create_project",
      name: "Unrelated",
      description: "",
      reviewerIds: ["owner"],
    }),
  );
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /already in progress/,
  );
  release();
  await first;
  assert.equal(h.calls.filter((c) => c === "create").length, 1);
  assert.equal(h.get().runs[0].runtime!.delivery!.status, "verified");
  assert.equal(h.get().runs[0].runtime!.handoff, undefined);
});

test("MR identity survives failed validation and retry reuses it without a second POST", async () => {
  const h = harness();
  h.snapshot.baseSha = "c".repeat(40);
  await assert.rejects(deliverVerifiedRun(h.deps, h.input), /SHA differs/);
  assert.equal(h.get().runs[0].runtime!.delivery!.changeId, "7");
  assert.equal(h.get().runs[0].runtime!.delivery!.status, "unverified");
  h.snapshot.baseSha = "b".repeat(40);
  await deliverVerifiedRun(h.deps, h.input);
  assert.equal(h.calls.filter((c) => c === "create").length, 1);
  assert.equal(h.get().runs[0].runtime!.delivery!.status, "verified");
});

test("unknown create response is never automatically sent twice, including after restart", async () => {
  const h = harness();
  h.deps.adapter.createDraftChange = async () => {
    h.calls.push("create");
    throw Error("Response lost");
  };
  await assert.rejects(deliverVerifiedRun(h.deps, h.input), /Response lost/);
  assert(h.get().runs[0].runtime!.delivery!.createIntent);
  await assert.rejects(deliverVerifiedRun(h.deps, h.input), /unknown outcome/);
  assert.equal(h.calls.filter((c) => c === "create").length, 1);
});

test("target advancement blocks publishing and a non-draft result preserves inspection evidence", async () => {
  const h = harness();
  h.setTarget("c".repeat(40));
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /Remote target branch changed/,
  );
  assert(!h.calls.includes("push"));
  assert(!h.calls.includes("create"));
  h.setTarget("b".repeat(40));
  h.snapshot.draft = false;
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /not an open draft/,
  );
  assert(h.get().runs[0].runtime!.delivery!.url);
  await h.deps.mutate((w) => {
    w.features[0].designs[0].decisions = [];
    w.runs[0].status = "blocked";
  });
  const writes = h.calls.filter((c) => ["push", "create"].includes(c)).length;
  const result = await inspectRunDelivery(h.deps, h.input.runId);
  assert.equal(result.verified, false);
  assert(result.url);
  assert.equal(
    h.calls.filter((c) => ["push", "create"].includes(c)).length,
    writes,
  );
});

test("unknown push is preserved and never retried when the branch cannot be observed", async () => {
  const h = harness();
  const git = h.deps.git;
  h.deps.git = async (cwd, ...args) => {
    if (args[0] === "push") {
      h.calls.push("push");
      throw Error("Push response lost");
    }
    return git(cwd, ...args);
  };
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /Push response lost/,
  );
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /previous push has an unknown outcome/,
  );
  assert.equal(h.calls.filter((c) => c === "push").length, 1);
});

test("same-SHA target branch retargeting cannot verify a saved MR", async () => {
  const h = harness();
  await deliverVerifiedRun(h.deps, h.input);
  h.snapshot.baseRef = "release";
  await assert.rejects(
    deliverVerifiedRun(h.deps, h.input),
    /repository or branch differs/,
  );
  const result = await inspectRunDelivery(h.deps, h.input.runId);
  assert.equal(result.verified, false);
  assert.equal(h.calls.filter((c) => c === "create").length, 1);
});
