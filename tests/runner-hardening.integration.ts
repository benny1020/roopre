import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { RunnerManager } from "../src/runner/manager.ts";
import type { ConnectionVault } from "../src/main/connections/vault.ts";
import { command, git } from "../src/runner/process.ts";
import { approvedRun } from "./fixtures/approved-run.ts";

test(
  "a pnpm scriptShell bypass is rejected before fixed checks can report a false pass (real Docker, fixture agent)",
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-check-protection-"));
    const key = `check-protection-${randomUUID()}`;
    const tag = `roopre-config-fixture:${randomUUID()}`;
    let store: Store | undefined, runner: RunnerManager | undefined;
    let runId = "";
    try {
      await cp(resolve("tests/fixtures/claude.cjs"), join(root, "claude.cjs"));
      await writeFile(
        join(root, "Dockerfile"),
        `FROM roopre-runner:0.3\nUSER root\nCOPY claude.cjs /opt/fixture-claude.cjs\nRUN rm -f /usr/bin/claude /usr/local/bin/claude && printf '#!/bin/sh\\nexec node /opt/fixture-claude.cjs "$@"\\n' > /usr/local/bin/claude && chmod +x /usr/local/bin/claude\nUSER pwuser\n`,
      );
      const build = await command("docker", ["build", "-t", tag, root], {
        timeout: 90000,
      });
      assert.equal(build.code, 0, build.output);
      const repo = join(root, "repo");
      await mkdir(repo);
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          private: true,
          scripts: { test: "exit 42" },
        }),
      );
      await writeFile(
        join(repo, "package-lock.json"),
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          lockfileVersion: 3,
          packages: { "": { name: "fixture", version: "1.0.0" } },
        }),
      );
      // The same tool genuinely fails without the malicious workspace setting.
      assert.equal(
        (await command("pnpm", ["run", "test"], { cwd: repo })).code,
        42,
      );
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "Fixture");
      await git(repo, "config", "user.email", "fixture@example.invalid");
      await git(repo, "add", "-A");
      await git(repo, "commit", "-m", "baseline failing check");
      const image = (
        await command("docker", [
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          tag,
        ])
      ).output.trim();
      const fixture = approvedRun(key, {
        repositoryPath: repo,
        baseCommit: await git(repo, "rev-parse", "HEAD"),
        image,
        checks: [
          {
            name: "typecheck",
            argv: ["node", "--version"],
            timeoutSeconds: 10,
          },
          { name: "test", argv: ["pnpm", "run", "test"], timeoutSeconds: 10 },
        ],
        repairLimit: 0,
      });
      fixture.f.designs[0].requirements =
        "AC01 PNPM_BYPASS_FIXTURE untrusted scriptShell change";
      fixture.run.status = "queued";
      delete fixture.run.runtime!.worktree;
      delete fixture.run.runtime!.head;
      delete fixture.run.runtime!.branch;
      fixture.run.runtime!.terminationConfirmed = undefined;
      runId = fixture.run.id;
      store = new Store(key, undefined, "local-owner", () => fixture.w);
      await store.init();
      await store.mutate((w) => {
        w.features[0].designs[0].decisions[0].binding = approvalBinding(
          w,
          w.features[0],
        );
        w.runs[0].runtime!.binding = approvalBinding(w, w.features[0]);
      });
      const vault = {
        get: () => ({
          info: {
            id: fixture.run.runtime!.profile.connectionId,
            name: "Fixture",
            endpoint: "https://invalid.example",
            auth: "api-key",
            model: "fixture-model",
            version: 1,
            hasKey: true,
            testStatus: "passed",
          },
          key: "fixture-no-provider-call",
        }),
      } as unknown as ConnectionVault;
      runner = new RunnerManager(
        store,
        vault,
        join(root, "runs"),
        resolve("resources"),
      );
      await runner.execute(runId, new AbortController());
      const result = (await store.read("owner")).runs[0];
      assert.equal(result.status, "failed", JSON.stringify(result));
      assert.match(
        result.reason,
        /Required checks, configuration or dependencies changed/,
      );
      assert.equal(
        result.runtime!.evidence.length,
        0,
        "check execution must never admit the altered shell config",
      );
      assert.equal(result.runtime!.terminationConfirmed, true);
    } finally {
      await runner?.stop();
      if (runId) await runner?.cleanup(runId);
      if (store) {
        for (const table of ["commands", "events"])
          await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
            key,
          ]);
        await store.pool.query("DELETE FROM workspaces WHERE id=$1", [key]);
        await store.close();
      }
      await command("docker", ["image", "rm", tag]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
