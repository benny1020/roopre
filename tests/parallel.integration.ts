import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { ownerFixture } from "./fixtures/workspace.ts";
import { sections } from "../src/shared/contracts.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { RunnerManager } from "../src/runner/manager.ts";
import type { ConnectionVault } from "../src/main/connections/vault.ts";
import { git, command } from "../src/runner/process.ts";

test(
  "Docker parallel stages: isolated models/workspaces, fan-in, planning synthesis, conflict and cancellation",
  { timeout: 240000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-parallel-docker-"));
    const store = new Store(
      `test-parallel-${randomUUID()}`,
      undefined,
      "local-owner",
      ownerFixture,
    );
    let runner: RunnerManager | undefined;
    const runIds: string[] = [];
    const image = "roopre-parallel-fixture:0.2";
    try {
      await store.init();
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
      await writeFile(join(repo, "README.md"), "fixture\n");
      await git(repo, "add", "-A");
      await git(repo, "commit", "-m", "base");
      const base = await git(repo, "rev-parse", "HEAD");
      const connections: string[] = [randomUUID(), randomUUID()];
      const vault = {
        get: (id: string) => ({
          info: {
            id,
            name: "Fixture",
            endpoint: "https://invalid.example",
            auth: "api-key",
            model: `fixture-${connections.indexOf(id)}`,
            version: 1,
            hasKey: true,
            testStatus: "passed",
          },
          key: `not-real-${id}`,
        }),
      } as unknown as ConnectionVault;
      const send = async (c: Parameters<Store["execute"]>[2]) =>
        store.execute("owner", randomUUID(), c);
      await send({
        type: "configure_execution",
        projectId: "first-project",
        profile: {
          repositoryPath: repo,
          baseBranch: "main",
          baseCommit: base,
          connectionId: connections[0],
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
              timeoutSeconds: 15,
            },
            {
              name: "test",
              argv: [
                "node",
                "-e",
                "if(require('fs').readFileSync('right.txt','utf8')!=='right')process.exit(1)",
              ],
              timeoutSeconds: 15,
            },
          ],
          webRequired: false,
          budgetUsd: 1,
          timeoutMinutes: 2,
          repairLimit: 0,
        },
      });
      const stages = [
        "requirements",
        "requirements",
        "design",
        "design",
        "implementation",
        "implementation",
        "verification",
        "verification",
        "review",
        "review",
      ] as const;
      const agents = stages.map((stage, i) => ({
        id: randomUUID(),
        revision: 1,
        name: `${stage}-${i}`,
        description: "Fixture",
        capability:
          stage === "implementation"
            ? ("implementation" as const)
            : ("read-only" as const),
        connectionId: connections[i % 2],
        connectionVersion: 1,
        markdown: `PARALLEL_FIXTURE ${i === 5 ? "RIGHT_ONLY_FIXTURE" : ""}`,
        archived: false,
      }));
      for (const agent of agents)
        await send({ type: "save_agent", expectedRevision: 0, agent });
      await send({
        type: "save_workflow",
        projectId: "first-project",
        expectedRevision: 0,
        workflow: {
          revision: 1,
          instructions: {
            requirements: "",
            design: "",
            implementation: "",
            verification: "",
            review: "",
          },
          assignments: agents.map((a, i) => ({
            id: randomUUID(),
            agentId: a.id,
            stage: stages[i],
            required: true,
          })),
        },
      });
      runner = new RunnerManager(
        store,
        vault,
        join(root, "runs"),
        resolve("resources"),
      );
      const queueApproved = async (title: string) => {
        const featureId = (
          await send({
            type: "create_feature",
            projectId: "first-project",
            title,
            template: "feature",
            requirements: "AC01 create hello.txt and right.txt",
          })
        ).entityId!;
        await send({
          type: "save_draft",
          featureId,
          expectedRevision: 0,
          requirements: "AC01 create hello.txt and right.txt",
          body: sections.map((s) => `## ${s}\n${title} details`).join("\n\n"),
        });
        await send({ type: "publish_design", featureId, expectedRevision: 1 });
        const w = await store.read("owner");
        const f = w.features.find((f) => f.id === featureId)!;
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
      const id = await queueApproved("Parallel success");
      await runner.execute(id, new AbortController());
      const result = (await store.read("owner")).runs.find((r) => r.id === id)!;
      assert.equal(result.status, "ready_for_merge", JSON.stringify(result));
      const executions = result.runtime!.agents!;
      for (const stage of ["implementation", "verification", "review"]) {
        const pair = executions.filter((a) => a.stage === stage);
        assert.equal(pair.length, 2);
        assert.equal(pair[0].inputTree, pair[1].inputTree);
        assert.notEqual(pair[0].worktree, pair[1].worktree);
        assert.notEqual(pair[0].model, pair[1].model);
        assert(
          Math.max(...pair.map((a) => Date.parse(a.startedAt))) <
            Math.min(...pair.map((a) => Date.parse(a.endedAt!))),
          `No parallel overlap: ${stage}`,
        );
      }
      const latestEnd = (stage: string) =>
        Math.max(
          ...executions
            .filter((a) => a.stage === stage)
            .map((a) => Date.parse(a.endedAt!)),
        );
      const firstStart = (stage: string) =>
        Math.min(
          ...executions
            .filter((a) => a.stage === stage)
            .map((a) => Date.parse(a.startedAt)),
        );
      assert(firstStart("verification") >= latestEnd("implementation"));
      assert(firstStart("review") >= latestEnd("verification"));
      assert(
        executions
          .filter((a) => a.stage === "implementation")
          .every((a) => a.output?.includes("budget=0.5")),
      );
      assert.equal(
        await readFile(join(result.runtime!.worktree!, "right.txt"), "utf8"),
        "right",
      );
      assert.equal(result.runtime!.evidence.length, 2);
      assert.equal(result.runtime!.terminationConfirmed, true);
      await send({ type: "cancel_run", runId: id });
      // Planning has two parallel stages, each followed by one recorded synthesis.
      const featureId = (
        await send({
          type: "create_feature",
          projectId: "first-project",
          title: "Parallel plan",
          template: "feature",
          requirements: "AC01 plan",
        })
      ).entityId!;
      const planId = (
        await send({ type: "queue_planning", featureId, expectedRevision: 0 })
      ).entityId!;
      runIds.push(planId);
      await runner.execute(planId, new AbortController());
      const plannedState = await store.read("owner");
      const plan = plannedState.runs.find((r) => r.id === planId)!;
      assert.equal(plan.status, "completed", JSON.stringify(plan));
      assert.equal(plan.runtime!.agents!.length, 6);
      assert.equal(
        plan.runtime!.agents!.filter((a) => a.name.includes("결과 통합"))
          .length,
        2,
      );
      assert.equal(
        plannedState.features.find((f) => f.id === featureId)!.designs.length,
        0,
      );
      // A required invalid draft blocks the next stage, retaining every peer result.
      await send({
        type: "save_agent",
        expectedRevision: 1,
        agent: {
          ...agents[0],
          revision: 2,
          markdown: "PARALLEL_FIXTURE INVALID_JSON_FIXTURE",
        },
      });
      const invalidFeature = (
        await send({
          type: "create_feature",
          projectId: "first-project",
          title: "Invalid parallel plan",
          template: "feature",
          requirements: "AC01 preserve input",
        })
      ).entityId!;
      const invalidId = (
        await send({
          type: "queue_planning",
          featureId: invalidFeature,
          expectedRevision: 0,
        })
      ).entityId!;
      runIds.push(invalidId);
      await runner.execute(invalidId, new AbortController());
      const invalidState = await store.read("owner");
      const invalid = invalidState.runs.find((r) => r.id === invalidId)!;
      assert.equal(invalid.status, "failed");
      assert.equal(invalid.runtime!.agents!.length, 2);
      assert.deepEqual(invalid.runtime!.agents!.map((a) => a.status).sort(), [
        "failed",
        "passed",
      ]);
      assert.equal(
        invalidState.features.find((f) => f.id === invalidFeature)!.draft
          .revision,
        0,
      );
      // Same-path changes fail without modifying canonical checkout or starting checks.
      await send({
        type: "save_agent",
        expectedRevision: 1,
        agent: { ...agents[5], revision: 2, markdown: "PARALLEL_FIXTURE" },
      });
      const conflictId = await queueApproved("Parallel conflict");
      await runner.execute(conflictId, new AbortController());
      const conflict = (await store.read("owner")).runs.find(
        (r) => r.id === conflictId,
      )!;
      assert.equal(conflict.status, "failed");
      assert.match(conflict.reason, /병렬 구현 충돌/);
      assert.equal(conflict.runtime!.evidence.length, 0);
      assert.equal(conflict.runtime!.agents!.length, 2);
      await assert.rejects(
        readFile(join(conflict.runtime!.worktree!, "hello.txt")),
        { code: "ENOENT" },
      );
      for (const a of conflict.runtime!.agents!)
        assert.equal(
          await readFile(join(a.worktree!, "hello.txt"), "utf8"),
          "hello from fixture",
        );
      // Cancellation drains all active processes, not only the most recent agent.
      const cancelId = await queueApproved("SLOW_SCENARIO");
      const controller = new AbortController();
      const job = runner.execute(cancelId, controller);
      let seen = false;
      for (let i = 0; i < 200; i++) {
        const current = (await store.read("owner")).runs.find(
          (r) => r.id === cancelId,
        )!;
        if (
          current.runtime!.agents?.filter((a) => a.status === "running")
            .length === 2
        ) {
          seen = true;
          break;
        }
        if (["failed", "blocked"].includes(current.status))
          throw Error(JSON.stringify(current));
        await new Promise((r) => setTimeout(r, 100));
      }
      controller.abort();
      await job;
      assert(seen, "two active workers were never observed");
      const cancelled = (await store.read("owner")).runs.find(
        (r) => r.id === cancelId,
      )!;
      assert.equal(cancelled.status, "interrupted");
      assert.equal(cancelled.runtime!.terminationConfirmed, true);
      assert(cancelled.runtime!.agents!.every((a) => a.status === "failed"));
      assert.equal(cancelled.runtime!.evidence.length, 0);
      for (const runId of runIds) {
        const remaining = await command("docker", [
          "ps",
          "-aq",
          "--filter",
          `label=roopre.run=${runId}`,
        ]);
        assert.equal(remaining.code, 0);
        assert.equal(remaining.output.trim(), "");
      }
      assert.equal(await git(repo, "rev-parse", "HEAD"), base);
    } finally {
      if (runner)
        for (const id of runIds) await runner.cleanup(id).catch(() => {});
      for (const table of ["commands", "events"])
        await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
          store.key,
        ]);
      await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
      await store.close();
      await rm(root, { recursive: true, force: true });
      await command("docker", ["image", "rm", image]);
    }
  },
);
