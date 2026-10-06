import { randomUUID } from "node:crypto";
import { git, command } from "./process.ts";

// Wait for every started task, including its cleanup, before surfacing failure.
export async function runBatches<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number, batchSize: number) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw Error("Invalid execution capacity");
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    signal.throwIfAborted();
    const batch = items.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map((item, i) => run(item, offset + i, batch.length)),
    );
    const failed = settled.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    signal.throwIfAborted();
    results.push(...settled.map((r) => (r as PromiseFulfilledResult<R>).value));
  }
  return results;
}

export async function snapshotStage(checkout: string) {
  await git(checkout, "add", "-A");
  const tree = await git(checkout, "write-tree");
  const commit = await git(
    checkout,
    "commit-tree",
    tree,
    "-p",
    "HEAD",
    "-m",
    "Roopre stage input",
  );
  // Advertise the immutable checkpoint to independent --no-local clones.
  await git(
    checkout,
    "update-ref",
    `refs/heads/roopre-stage-${randomUUID()}`,
    commit,
  );
  return { tree, commit };
}

export async function cloneStage(
  source: string,
  destination: string,
  commit: string,
) {
  await git(
    source,
    "clone",
    "--no-hardlinks",
    "--no-local",
    source,
    destination,
  );
  await git(destination, "checkout", "--detach", commit);
  await git(destination, "remote", "remove", "origin");
  await git(destination, "config", "user.name", "Roopre Agent");
  await git(destination, "config", "user.email", "agent@roopre.local");
}

export async function integrateStage(
  checkout: string,
  inputTree: string,
  workers: { name: string; checkout: string }[],
) {
  const claimed = new Map<string, string>();
  const patches: string[] = [];
  for (const worker of workers) {
    const paths = (
      await git(
        worker.checkout,
        "diff",
        "--cached",
        "--no-renames",
        "--name-only",
        "-z",
        inputTree,
      )
    )
      .split("\0")
      .filter(Boolean);
    for (const path of paths) {
      for (const [previous, name] of claimed)
        if (
          path === previous ||
          path.startsWith(previous + "/") ||
          previous.startsWith(path + "/")
        )
          throw Error(
            `Parallel implementation conflict: ${name} / ${worker.name} · ${path}. Each workspace is preserved. Separate agent scopes or use sequential execution.`,
          );
    }
    for (const path of paths) claimed.set(path, worker.name);
    const patch = await git(
      worker.checkout,
      "diff",
      "--cached",
      "--binary",
      inputTree,
    );
    if (patch) patches.push(patch + "\n");
  }
  if (!patches.length) return;
  await git(checkout, "add", "-A");
  if ((await git(checkout, "write-tree")) !== inputTree)
    throw Error("Integration source changed after the stage started.");
  const patch = patches.join("");
  if (patch.length > 180000)
    throw Error(
      "Parallel changes exceed the integration limit. Inspect the workspaces.",
    );
  // Without --reject, git apply checks every hunk before modifying any files.
  const result = await command(
    "git",
    ["-c", "core.hooksPath=/dev/null", "apply", "--index", "--binary", "-"],
    {
      cwd: checkout,
      input: patch,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  );
  if (result.code !== 0)
    throw Error(
      "Could not integrate parallel results. Individual workspaces are preserved.",
    );
}
