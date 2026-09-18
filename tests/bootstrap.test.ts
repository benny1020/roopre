import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bootstrap } from "../src/main/bootstrap/environment.ts";
import type { command } from "../src/runner/process.ts";
const cipher = {
  encrypt: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decrypt: (b: Buffer) => b.toString().split("").reverse().join(""),
};
test("bootstrap opens without a database and persists dismissed/step state without claiming readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-bootstrap-"));
  try {
    const boot = new Bootstrap(
      root,
      cipher,
      "unused",
      async () => {
        throw Error("secret-URL");
      },
      () => false,
    );
    await boot.init();
    await boot.restore("secret-URL");
    assert.equal(boot.status().connected, false);
    assert(!JSON.stringify(boot.status()).includes("secret-URL"));
    await boot.progress({ version: 1, step: "environment", dismissed: true });
    const reopened = new Bootstrap(
      root,
      cipher,
      "unused",
      async () => {},
      () => false,
    );
    await reopened.init();
    assert.equal(reopened.status().progress.step, "environment");
    assert.equal(reopened.status().progress.dismissed, true);
    assert.equal(reopened.status().connected, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("duplicate preparation shares one attempt; cancellation is reported and never deletes DB resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-bootstrap-cancel-"));
  const calls: string[][] = [];
  const run = (async (bin: string, args: string[], options: any) => {
    calls.push([bin, ...args]);
    if (bin === "git")
      return { code: 0, output: "git", outputTruncated: false };
    await new Promise<void>((resolve) => {
      if (options.signal.aborted) resolve();
      else
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
    });
    return { code: -1, output: "", outputTruncated: false };
  }) as typeof command;
  try {
    const boot = new Bootstrap(
      root,
      cipher,
      "unused",
      async () => {},
      () => false,
      run,
    );
    await boot.init();
    boot.prepare();
    boot.prepare();
    await new Promise((r) => setTimeout(r, 20));
    boot.cancel();
    await boot.stop();
    assert.equal(calls.filter((c) => c[0] === "git").length, 1);
    assert.match(boot.status().error, /중단/);
    assert(!calls.some((c) => c.includes("rm")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("corrupt bootstrap state is preserved and failed progress writes do not advance", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-bootstrap-corrupt-"));
  try {
    const file = join(root, "onboarding.json");
    await writeFile(file, "invalid");
    const boot = new Bootstrap(
      root,
      cipher,
      "unused",
      async () => {},
      () => false,
    );
    await assert.rejects(() => boot.init(), /복구/);
    assert.equal(await readFile(file, "utf8"), "invalid");
    await rm(file);
    await boot.init();
    await mkdir(file);
    await assert.rejects(() =>
      boot.progress({ version: 1, step: "requirements", dismissed: true }),
    );
    assert.equal(boot.status().progress.step, "connection");
    assert.equal(boot.status().progress.dismissed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
