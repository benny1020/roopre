import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createServer, connect, type Socket } from "node:net";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm, cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store, databaseUrl } from "../src/database/store.ts";
import { ownerFixture } from "./fixtures/workspace.ts";
import { sections, type Command } from "../src/shared/contracts.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { RunnerManager } from "../src/runner/manager.ts";
import type { ConnectionVault } from "../src/main/connections/vault.ts";
import { git, command } from "../src/runner/process.ts";

async function until(
  check: () => Promise<boolean>,
  label: string,
  timeout = 60000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`Timed out: ${label}`);
}

test(
  "real process/Docker/DB resilience: project capacity, cancellation, SIGKILL restart and connection loss",
  { timeout: 300000 },
  async () => {
    const upstream = new URL(databaseUrl);
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname),
      "Local development DB only",
    );
    const root = await mkdtemp(join(tmpdir(), "roopre-resilience-"));
    const store = new Store(
      `test-resilience-${randomUUID()}`,
      undefined,
      "local-owner",
      ownerFixture,
    );
    const image = `roopre-resilience-${randomUUID()}:fixture`;
    const sockets = new Set<Socket>();
    let online = true;
    const proxy = createServer((client) => {
      if (!online) {
        client.destroy();
        return;
      }
      const target = connect(Number(upstream.port || 5432), upstream.hostname);
      for (const socket of [client, target]) {
        sockets.add(socket);
        socket.on("error", () => {
          client.destroy();
          target.destroy();
        });
        socket.on("close", () => {
          sockets.delete(socket);
          client.destroy();
          target.destroy();
        });
      }
      client.pipe(target).pipe(client);
    });
    let worker: ChildProcess | undefined;
    const runIds: string[] = [];
    const evidence: Record<string, unknown> = {
      realDocker: true,
      realPostgreSQL: true,
      realWorkerProcess: true,
      model: "explicit fixture",
      nativeApproval: false,
    };
    const send = (c: Command) => store.execute("owner", randomUUID(), c);
    const recovery = new RunnerManager(
      store,
      {} as ConnectionVault,
      join(root, "runs"),
      resolve("resources"),
    );
    const launch = async () => {
      const address = proxy.address();
      assert(address && typeof address !== "string");
      const url = new URL(databaseUrl);
      url.hostname = "127.0.0.1";
      url.port = String(address.port);
      const child = fork(
        resolve("tests/fixtures/resilience-worker.ts"),
        [join(root, "worker.json")],
        {
          execArgv: ["--import", "tsx"],
          env: {
            PATH: process.env.PATH,
            HOME: root,
            DEVFLOW_DATABASE_URL: url.href,
          },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      worker = child;
      await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw Error("Worker exited before ready");
        }),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(Error("Worker startup timed out")),
            30000,
          );
          timer.unref();
        }),
      ]);
    };
    const stop = async (crash = false) => {
      if (!worker || worker.exitCode !== null || worker.signalCode) return;
      const child = worker;
      const exited = once(child, "exit");
      if (crash) child.kill("SIGKILL");
      else child.send("stop");
      await exited;
      worker = undefined;
    };
    try {
      await store.init();
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      await writeFile(
        join(root, "worker.json"),
        JSON.stringify({
          workspace: store.key,
          runs: join(root, "runs"),
          resources: resolve("resources"),
        }),
      );
      await cp(resolve("tests/fixtures/claude.cjs"), join(root, "claude.cjs"));
      await writeFile(
        join(root, "Dockerfile"),
        `FROM roopre-runner:0.2\nUSER root\nCOPY claude.cjs /opt/fixture-claude.cjs\nRUN rm -f /usr/bin/claude /usr/local/bin/claude && printf '#!/bin/sh\\nexec node /opt/fixture-claude.cjs "$@"\\n' > /usr/local/bin/claude && chmod +x /usr/local/bin/claude\nUSER pwuser\n`,
      );
      const build = await command("docker", ["build", "-t", image, root], {
        timeout: 120000,
      });
      assert.equal(build.code, 0, build.output);
      const repo = join(root, "repo");
      await mkdir(repo);
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "Fixture");
      await git(repo, "config", "user.email", "fixture@example.invalid");
      await writeFile(
        join(repo, "README.md"),
        "Disposable resilience repository\n",
      );
      await git(repo, "add", "-A");
      await git(repo, "commit", "-m", "baseline");
      const base = await git(repo, "rev-parse", "HEAD");
      const projects = ["first-project"];
      for (const name of ["Second fixture", "Third fixture"])
        projects.push(
          (
            await send({
              type: "create_project",
              name,
              description: "Disposable",
              reviewerIds: ["owner"],
            })
          ).entityId!,
        );
      const profile = {
        repositoryPath: repo,
        baseBranch: "main",
        baseCommit: base,
        connectionId: randomUUID(),
        connectionVersion: 1,
        image: (
          await command("docker", [
            "image",
            "inspect",
            "--format",
            "{{.Id}}",
            image,
          ])
        ).output.trim(),
        checks: [
          {
            name: "typecheck",
            argv: [
              "node",
              "-e",
              "if(require('fs').readFileSync('hello.txt','utf8')!=='hello from fixture')process.exit(1)",
            ],
            timeoutSeconds: 10,
          },
          {
            name: "test",
            argv: [
              "node",
              "-e",
              "if(require('fs').readFileSync('checkpoint.txt','utf8')!=='preserved checkpoint')process.exit(1)",
            ],
            timeoutSeconds: 10,
          },
        ],
        webRequired: false,
        budgetUsd: 1,
        timeoutMinutes: 2,
        repairLimit: 0,
      };
      for (const projectId of projects)
        await send({ type: "configure_execution", projectId, profile });
      const queue = async (projectId: string, title: string) => {
        const requirements =
          "AC01 SLOW_SCENARIO create hello.txt and preserve checkpoint.txt";
        const featureId = (
          await send({
            type: "create_feature",
            projectId,
            title,
            requirements,
            template: "feature",
          })
        ).entityId!;
        await send({
          type: "save_draft",
          featureId,
          expectedRevision: 0,
          requirements,
          body: sections
            .map((s) => `## ${s}\nIsolated fault injection fixture`)
            .join("\n\n"),
        });
        await send({ type: "publish_design", featureId, expectedRevision: 1 });
        const w = await store.read("owner");
        const f = w.features.find((f) => f.id === featureId)!;
        // Domain fixture proof, not a real user's authentication or product approval.
        await store.execute(
          "owner",
          randomUUID(),
          {
            type: "review",
            featureId,
            designId: f.designs[0].id,
            checked: [...sections],
            decision: "approve",
          },
          { authentication: "macos-owner", binding: approvalBinding(w, f) },
        );
        const id = (
          await send({
            type: "queue_run",
            featureId,
            designId: f.designs[0].id,
          })
        ).entityId!;
        runIds.push(id);
        return id;
      };
      const checkpoint = (id: string) =>
        readFile(join(root, "runs", id, "checkout", "checkpoint.txt"), "utf8")
          .then((text) => text === "preserved checkpoint")
          .catch(() => false);
      const run = async (id: string) =>
        (await store.read("owner")).runs.find((r) => r.id === id)!;
      const clean = async (id: string) =>
        !(
          await command("docker", [
            "ps",
            "-aq",
            "--filter",
            `label=roopre.run=${id}`,
          ])
        ).output.trim();
      const a1 = await queue(projects[0], "First project A");
      const a2 = await queue(projects[0], "First project B");
      const b = await queue(projects[1], "Second project A");
      const c = await queue(projects[2], "Third project A");
      await launch();
      await until(
        async () => (await checkpoint(a1)) && (await checkpoint(b)),
        "two projects running simultaneously",
      );
      assert.equal((await run(a2)).status, "queued");
      assert.equal((await run(c)).status, "queued");
      assert.equal(
        (await store.read("owner")).runs.filter(
          (r) => r.runtime?.terminationConfirmed === false,
        ).length,
        2,
      );
      for (const id of [a2, c, a1, b])
        await send({ type: "cancel_run", runId: id });
      await until(
        async () =>
          (await run(a1)).runtime!.terminationConfirmed === true &&
          (await run(b)).runtime!.terminationConfirmed === true,
        "cancelled containers cleaned",
      );
      assert(await clean(a1));
      assert(await clean(b));
      evidence.parallelProjects = {
        globalSlots: 2,
        perProjectSlots: 1,
        sameProjectWaited: true,
        excessProjectWaited: true,
        cancellationCleaned: true,
      };

      const killed = await queue(projects[0], "SIGKILL recovery");
      await until(() => checkpoint(killed), "checkpoint before worker crash");
      await stop(true);
      assert.equal((await run(killed)).runtime!.terminationConfirmed, false);
      await launch();
      assert.equal((await run(killed)).status, "interrupted");
      assert.equal((await run(killed)).runtime!.terminationConfirmed, true);
      assert(
        (await run(killed)).runtime!.agents!.every(
          (a) => a.status !== "running",
        ),
      );
      assert(await checkpoint(killed));
      assert(await clean(killed));
      const resumed = (await recovery.retry(killed)).entityId;
      runIds.push(resumed);
      await until(
        async () =>
          (await run(resumed)).status === "ready_for_merge" &&
          (await run(resumed)).runtime!.terminationConfirmed === true,
        "crash checkpoint resumed",
      );
      evidence.processCrash = {
        signal: "SIGKILL",
        checkpointPreserved: true,
        explicitRetryPassed: true,
      };

      const disconnected = await queue(projects[0], "DB loss recovery");
      await until(
        () => checkpoint(disconnected),
        "checkpoint before DB outage",
      );
      online = false;
      for (const socket of sockets) socket.destroy();
      await until(
        () => clean(disconnected),
        "work stopped while database unavailable",
        45000,
      );
      assert.equal(
        (await run(disconnected)).runtime!.terminationConfirmed,
        false,
      );
      const samePid = worker!.pid;
      online = true;
      await until(
        async () =>
          (await run(disconnected)).status === "interrupted" &&
          (await run(disconnected)).runtime!.terminationConfirmed === true,
        "DB reconnect reconciles orphan state",
      );
      assert.equal(worker!.pid, samePid);
      assert(await checkpoint(disconnected));
      const retry = (await recovery.retry(disconnected)).entityId;
      runIds.push(retry);
      await until(
        async () =>
          (await run(retry)).status === "ready_for_merge" &&
          (await run(retry)).runtime!.terminationConfirmed === true,
        "DB outage retry passed",
      );
      evidence.databaseLoss = {
        realTcpConnectionsDestroyed: true,
        workerRestarted: false,
        checkpointPreserved: true,
        explicitRetryPassed: true,
      };
      await stop();
      assert.equal(await git(repo, "rev-parse", "HEAD"), base);
      assert.equal(await git(repo, "status", "--porcelain"), "");
      for (const id of runIds) assert(await clean(id));
      evidence.originalRepositoryUnchanged = true;
      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/resilience-results.json",
        JSON.stringify(evidence, null, 2),
      );
    } finally {
      online = true;
      await stop(true);
      for (const id of runIds) await recovery.cleanup(id).catch(() => {});
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      for (const table of ["commands", "events"])
        await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
          store.key,
        ]);
      await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
      await store.close();
      await command("docker", ["image", "rm", image]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
