import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runBatches,
  snapshotStage,
  cloneStage,
  integrateStage,
} from "../src/runner/parallel.ts";
import { git } from "../src/runner/process.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("parallel starts peers together, preserves result order, waits before next batch", async () => {
  const gates = Array.from({ length: 4 }, deferred);
  const started: number[] = [];
  const run = runBatches(
    [0, 1, 2, 3],
    3,
    async (i) => {
      started.push(i);
      await gates[i].promise;
      return i;
    },
    new AbortController().signal,
  );
  assert.deepEqual(started, [0, 1, 2]);
  gates[2].resolve();
  gates[1].resolve();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, [0, 1, 2]);
  gates[0].resolve();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[3].resolve();
  assert.deepEqual(await run, [0, 1, 2, 3]);
});
test("sequential waits for the previous output before starting next agent", async () => {
  const first = deferred();
  const started: number[] = [];
  const run = runBatches(
    [0, 1],
    1,
    async (i) => {
      started.push(i);
      if (!i) await first.promise;
      return i;
    },
    new AbortController().signal,
  );
  assert.deepEqual(started, [0]);
  first.resolve();
  assert.deepEqual(await run, [0, 1]);
});
test("failure drains already started work and prevents the next batch", async () => {
  const peer = deferred();
  const started: number[] = [];
  let settled = false;
  const run = runBatches(
    [0, 1, 2],
    2,
    async (i) => {
      started.push(i);
      if (i === 0) throw Error("agent failure");
      await peer.promise;
      return i;
    },
    new AbortController().signal,
  );
  const assertion = assert.rejects(run, /agent failure/).then(() => {
    settled = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  peer.resolve();
  await assertion;
  assert.deepEqual(started, [0, 1]);
});
test("cancellation prevents queued work even when active work resolves", async () => {
  const controller = new AbortController();
  const gate = deferred();
  const started: number[] = [];
  const run = runBatches(
    [0, 1, 2],
    2,
    async (i) => {
      started.push(i);
      await gate.promise;
      return i;
    },
    controller.signal,
  );
  controller.abort();
  gate.resolve();
  await assert.rejects(run);
  assert.deepEqual(started, [0, 1]);
});
async function repoFixture(fn: (root: string, repo: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "roopre-parallel-"));
  const repo = join(root, "repo");
  try {
    await mkdir(repo);
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.name", "Fixture");
    await git(repo, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, "base.txt"), "base\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "base");
    await fn(root, repo);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("isolated workers see identical staged input, disjoint outputs integrate without touching HEAD", async () =>
  repoFixture(async (root, repo) => {
    const head = await git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "checkpoint.txt"), "earlier attempt");
    const snapshot = await snapshotStage(repo);
    const a = join(root, "a"),
      b = join(root, "b");
    await Promise.all([
      cloneStage(repo, a, snapshot.commit),
      cloneStage(repo, b, snapshot.commit),
    ]);
    assert.equal(await git(a, "write-tree"), snapshot.tree);
    assert.equal(await git(b, "write-tree"), snapshot.tree);
    await writeFile(join(a, "left.txt"), "left");
    await assert.rejects(readFile(join(b, "left.txt")), { code: "ENOENT" });
    await writeFile(join(b, "right.txt"), "right");
    await git(a, "add", "-A");
    await git(b, "add", "-A");
    await integrateStage(repo, snapshot.tree, [
      { name: "left", checkout: a },
      { name: "right", checkout: b },
    ]);
    assert.equal(await readFile(join(repo, "left.txt"), "utf8"), "left");
    assert.equal(await readFile(join(repo, "right.txt"), "utf8"), "right");
    assert.equal(
      await readFile(join(repo, "checkpoint.txt"), "utf8"),
      "earlier attempt",
    );
    assert.equal(await git(repo, "rev-parse", "HEAD"), head);
  }));
test("overlapping edits preserve canonical source and both worker results", async () =>
  repoFixture(async (root, repo) => {
    const snapshot = await snapshotStage(repo);
    const a = join(root, "a"),
      b = join(root, "b");
    await cloneStage(repo, a, snapshot.commit);
    await cloneStage(repo, b, snapshot.commit);
    await writeFile(join(a, "base.txt"), "left");
    await writeFile(join(b, "base.txt"), "right");
    await git(a, "add", "-A");
    await git(b, "add", "-A");
    await assert.rejects(
      integrateStage(repo, snapshot.tree, [
        { name: "same name", checkout: a },
        { name: "same name", checkout: b },
      ]),
      /병렬 구현 충돌/,
    );
    assert.equal(await git(repo, "write-tree"), snapshot.tree);
    assert.equal(await readFile(join(repo, "base.txt"), "utf8"), "base\n");
    assert.equal(await readFile(join(a, "base.txt"), "utf8"), "left");
    assert.equal(await readFile(join(b, "base.txt"), "utf8"), "right");
  }));
