import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { ownerFixture } from "./fixtures/workspace.ts";
import { sections, type Command } from "../src/shared/contracts.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { RunnerManager } from "../src/runner/manager.ts";
import type { ConnectionVault } from "../src/main/connections/vault.ts";
import { command, git } from "../src/runner/process.ts";

test(
  "real Docker runner receives only frozen, agent-scoped memory and rejects stale retry bindings",
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-memory-docker-"));
    const store = new Store(
      `test-memory-${randomUUID()}`,
      undefined,
      "local-owner",
      ownerFixture,
    );
    const image = "roopre-memory-fixture:0.2";
    const runIds: string[] = [];
    let runner: RunnerManager | undefined;
    try {
      await store.init();
      // This fixture makes one denied broker request, then returns the exact CLI
      // stdin as base64. It is a Docker contract fixture, never a model call.
      await writeFile(
        join(root, "claude.cjs"),
        `#!/usr/bin/env node
const fs = require("node:fs");
(async () => {
  const stdin = fs.readFileSync(0, "utf8");
  const denied = await fetch("http://model-gateway:8080/v1/messages", {
    method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: JSON.stringify({ model: "unapproved-fixture" }), signal: AbortSignal.timeout(5000),
  });
  if (denied.status !== 403) throw Error("fixture broker contract failed: " + denied.status);
  const capture = Buffer.from(stdin).toString("base64");
  const review = process.argv[process.argv.indexOf("--tools") + 1] === "Read,Glob,Grep";
  if (!review) fs.writeFileSync("/workspace/hello.txt", "memory fixture");
  const result = review
    ? JSON.stringify({ passed: true, acceptance: [{ id: "AC01", passed: true, evidence: "stdin-base64:" + capture }], findings: [] })
    : "stdin-base64:" + capture;
  console.log(JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0, result }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
`,
      );
      await writeFile(
        join(root, "Dockerfile"),
        `FROM roopre-runner:0.2
USER root
COPY claude.cjs /opt/fixture-claude.cjs
RUN rm -f /usr/bin/claude /usr/local/bin/claude && printf '#!/bin/sh\\nexec node /opt/fixture-claude.cjs "$@"\\n' > /usr/local/bin/claude && chmod +x /usr/local/bin/claude
USER pwuser
`,
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
      await writeFile(join(repo, "README.md"), "memory runner fixture\n");
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({ name: "memory-fixture", private: true }),
      );
      await writeFile(
        join(repo, "package-lock.json"),
        JSON.stringify({
          name: "memory-fixture",
          lockfileVersion: 3,
          packages: { "": { name: "memory-fixture" } },
        }),
      );
      await git(repo, "add", ".");
      await git(repo, "commit", "-m", "fixture baseline");
      const base = await git(repo, "rev-parse", "HEAD");
      const connectionId = randomUUID();
      const vault = {
        get: () => ({
          info: {
            id: connectionId,
            name: "Fixture",
            endpoint: "https://invalid.example",
            auth: "api-key",
            model: "fixture-model",
            version: 1,
            hasKey: true,
            testStatus: "passed",
          },
          key: "not-a-real-key",
        }),
      } as unknown as ConnectionVault;
      const send = (c: Command) => store.execute("owner", randomUUID(), c);
      const imageId = (
        await command("docker", [
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          image,
        ])
      ).output.trim();
      await send({
        type: "configure_execution",
        projectId: "first-project",
        profile: {
          repositoryPath: repo,
          baseBranch: "main",
          baseCommit: base,
          connectionId,
          connectionVersion: 1,
          image: imageId,
          checks: [
            {
              name: "typecheck",
              argv: [
                "node",
                "-e",
                "if(require('fs').readFileSync('hello.txt','utf8')!=='memory fixture')process.exit(1)",
              ],
              timeoutSeconds: 20,
            },
            {
              name: "test",
              argv: ["node", "-e", "process.exit(0)"],
              timeoutSeconds: 20,
            },
          ],
          webRequired: false,
          budgetUsd: 1,
          timeoutMinutes: 2,
          repairLimit: 0,
        },
      });
      const implementation = {
        id: randomUUID(),
        revision: 1,
        name: "memory implementation",
        description: "fixture",
        capability: "implementation" as const,
        connectionId,
        connectionVersion: 1,
        markdown: "Fixture implementation agent",
        archived: false,
      };
      const reviewer = {
        id: randomUUID(),
        revision: 1,
        name: "memory reviewer",
        description: "fixture",
        capability: "read-only" as const,
        connectionId,
        connectionVersion: 1,
        markdown: "Fixture review agent",
        archived: false,
      };
      await send({
        type: "save_agent",
        expectedRevision: 0,
        agent: implementation,
      });
      await send({ type: "save_agent", expectedRevision: 0, agent: reviewer });
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
          assignments: [
            {
              id: randomUUID(),
              agentId: implementation.id,
              stage: "implementation",
              required: true,
            },
            {
              id: randomUUID(),
              agentId: reviewer.id,
              stage: "review",
              required: true,
            },
          ],
        },
      });

      const createFeature = async (title: string) => {
        const featureId = (
          await send({
            type: "create_feature",
            projectId: "first-project",
            title,
            template: "feature",
            requirements: "AC01 create fixture hello",
          })
        ).entityId!;
        await send({
          type: "save_draft",
          featureId,
          expectedRevision: 0,
          requirements: "AC01 create fixture hello",
          body: sections.map((s) => `## ${s}\nfixture`).join("\n\n"),
        });
        await send({ type: "publish_design", featureId, expectedRevision: 1 });
        return featureId;
      };
      const featureId = await createFeature("Memory fixture");
      const otherFeatureId = await createFeature(
        "Other feature memory must exclude",
      );
      const saveMemory = async (
        id: string,
        agentDefinitionId: string,
        body: string,
        featureId?: string,
        revision = 1,
      ) => {
        const w = await store.read("owner");
        await send({
          type: "save_memory",
          expectedRevision: w.revision,
          projectId: "first-project",
          promoteToProject: false,
          memory: {
            id,
            agentDefinitionId,
            featureId,
            title: id,
            body,
            revision,
            sourceRefs: [
              { type: "manual", label: "memory integration fixture" },
            ],
            active: true,
          },
        });
      };
      await saveMemory(
        "impl-project",
        implementation.id,
        "MEMORY_IMPL_PROJECT",
      );
      await saveMemory(
        "impl-feature",
        implementation.id,
        "MEMORY_IMPL_FEATURE",
        featureId,
      );
      await saveMemory("review-project", reviewer.id, "MEMORY_REVIEW_PROJECT");
      await saveMemory(
        "impl-other-feature",
        implementation.id,
        "MEMORY_IMPL_OTHER_FEATURE",
        otherFeatureId,
      );

      const approve = async (id: string) => {
        const w = await store.read("owner");
        const f = w.features.find((item) => item.id === id)!;
        await store.execute(
          "owner",
          randomUUID(),
          {
            type: "review",
            featureId: id,
            designId: f.designs.at(-1)!.id,
            checked: [...sections],
            decision: "approve",
          },
          {
            authentication: "app-confirmation",
            binding: approvalBinding(w, f),
          },
        );
      };
      // Test fixture analogue of the UI's edit → publish → owner approval path.
      const publishCurrent = async (id: string) => {
        const w = await store.read("owner");
        const f = w.features.find((item) => item.id === id)!;
        await send({
          type: "save_draft",
          featureId: id,
          expectedRevision: f.draft.revision,
          requirements: f.draft.requirements,
          body: f.draft.body,
        });
        await send({
          type: "publish_design",
          featureId: id,
          expectedRevision: f.draft.revision + 1,
        });
      };
      const queue = async () => {
        const w = await store.read("owner");
        const f = w.features.find((item) => item.id === featureId)!;
        const id = (
          await send({
            type: "queue_run",
            featureId,
            designId: f.designs.at(-1)!.id,
          })
        ).entityId!;
        runIds.push(id);
        return id;
      };
      const capture = (output: string, marker: string) => {
        const encoded = /stdin-base64:([A-Za-z0-9+/=]+)/.exec(output)?.[1];
        return (
          !!encoded &&
          Buffer.from(encoded, "base64").toString().includes(marker)
        );
      };

      await publishCurrent(featureId);
      await approve(featureId);
      runner = new RunnerManager(
        store,
        vault,
        join(root, "runs"),
        resolve("resources"),
      );
      const firstId = await queue();
      await runner.execute(firstId, new AbortController());
      let first = (await store.read("owner")).runs.find(
        (run) => run.id === firstId,
      )!;
      assert.equal(
        first.status,
        "ready_for_merge",
        JSON.stringify(first, null, 2),
      );
      const firstImplementation = first.runtime!.agents!.find(
        (agent) => agent.stage === "implementation",
      )!;
      const firstReview = first.runtime!.agents!.find(
        (agent) => agent.stage === "review",
      )!;
      assert(capture(firstImplementation.output!, "MEMORY_IMPL_PROJECT"));
      assert(capture(firstImplementation.output!, "MEMORY_IMPL_FEATURE"));
      assert(!capture(firstImplementation.output!, "MEMORY_REVIEW_PROJECT"));
      assert(
        !capture(firstImplementation.output!, "MEMORY_IMPL_OTHER_FEATURE"),
      );
      assert(capture(firstReview.output!, "MEMORY_REVIEW_PROJECT"));
      assert(!capture(firstReview.output!, "MEMORY_IMPL_PROJECT"));
      assert(!capture(firstReview.output!, "MEMORY_IMPL_FEATURE"));
      assert(!capture(firstReview.output!, "MEMORY_IMPL_OTHER_FEATURE"));
      assert.match(firstImplementation.instructions, /MEMORY_IMPL_PROJECT/);
      assert.match(firstImplementation.instructions, /MEMORY_IMPL_FEATURE/);
      assert.doesNotMatch(
        firstImplementation.instructions,
        /MEMORY_REVIEW_PROJECT|MEMORY_IMPL_OTHER_FEATURE/,
      );

      // Test-only transition: it supplies a completed, retry-eligible fixture
      // without inventing a failure path in the memory assertions.
      await store.mutate((w) => {
        const run = w.runs.find((item) => item.id === firstId)!;
        run.status = "failed";
        run.reason = "test-only retry fixture";
        run.runtime!.terminationConfirmed = true;
      });
      const unchangedRetry = await runner.retry(firstId);
      runIds.push(unchangedRetry.entityId);
      await runner.execute(unchangedRetry.entityId, new AbortController());
      const retried = (await store.read("owner")).runs.find(
        (run) => run.id === unchangedRetry.entityId,
      )!;
      assert.equal(
        retried.status,
        "ready_for_merge",
        JSON.stringify(retried, null, 2),
      );
      const retriedImplementation = retried.runtime!.agents!.find(
        (agent) => agent.stage === "implementation",
      )!;
      assert.equal(
        retried
          .runtime!.harness!.agents.find(
            (agent) => agent.stage === "implementation",
          )!
          .memory!.find((memory) => memory.id === "impl-feature")!.body,
        "MEMORY_IMPL_FEATURE",
      );
      assert(capture(retriedImplementation.output!, "MEMORY_IMPL_FEATURE"));

      // Test-only transition creates a retry-eligible completed attempt. Its
      // frozen harness remains the one used by the real Docker attempt.
      await store.mutate((w) => {
        const run = w.runs.find((item) => item.id === unchangedRetry.entityId)!;
        run.status = "failed";
        run.reason = "test-only stale binding fixture";
        run.runtime!.terminationConfirmed = true;
      });

      // The normal memory edit invalidates approval; republish and approve it
      // before queuing the next real Docker run.
      await saveMemory(
        "impl-feature",
        implementation.id,
        "MEMORY_IMPL_FEATURE_UPDATED",
        featureId,
        2,
      );
      await publishCurrent(featureId);
      await approve(featureId);
      // The invalidation blocks the previous run. Restore its test-only failed
      // status to exercise retry's binding check, then clear that fixture run.
      await store.mutate((w) => {
        const run = w.runs.find((item) => item.id === unchangedRetry.entityId)!;
        run.status = "failed";
        run.reason = "test-only stale binding fixture";
        run.runtime!.terminationConfirmed = true;
      });
      await assert.rejects(
        runner.retry(unchangedRetry.entityId),
        /Approve the current design again/,
      );
      await store.mutate((w) => {
        const run = w.runs.find((item) => item.id === unchangedRetry.entityId)!;
        run.status = "cancelled";
        run.reason = "test-only completed fixture cleanup";
      });
      const secondId = await queue();
      await runner.execute(secondId, new AbortController());
      const second = (await store.read("owner")).runs.find(
        (run) => run.id === secondId,
      )!;
      assert.equal(
        second.status,
        "ready_for_merge",
        JSON.stringify(second, null, 2),
      );
      const secondImplementation = second.runtime!.agents!.find(
        (agent) => agent.stage === "implementation",
      )!;
      assert(
        capture(secondImplementation.output!, "MEMORY_IMPL_FEATURE_UPDATED"),
      );
      assert(!capture(secondImplementation.output!, "MEMORY_IMPL_FEATURE\\n"));

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
