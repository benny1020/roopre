import { ownerFixture } from "./fixtures/workspace.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { sections } from "../src/shared/contracts.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { checkedArtifact } from "../src/runner/artifacts.ts";
import { RunnerManager } from "../src/runner/manager.ts";
import { ConnectionVault } from "../src/main/connections/vault.ts";
import { git, command } from "../src/runner/process.ts";
test(
  "real Docker lifecycle: isolated checkout, fixed checks, read-only review, commit evidence and cleanup (fake Claude, no model call)",
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-runner-test-"));
    const store = new Store(
      `test-runner-${randomUUID()}`,
      undefined,
      "local-owner",
      ownerFixture,
    );
    let runner: RunnerManager | undefined;
    let runId = "";
    const image = "roopre-runner-contract:0.2";
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
      await command("mkdir", ["-p", repo]);
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "Fixture");
      await git(repo, "config", "user.email", "fixture@example.invalid");
      await writeFile(join(repo, "README.md"), "fixture repository");
      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0", private: true }),
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
      const checks = [
        {
          name: "typecheck",
          argv: [
            "node",
            "-e",
            "if(require('fs').readFileSync('hello.txt','utf8')!=='hello from fixture')process.exit(1)",
          ],
          timeoutSeconds: 30,
        },
        {
          name: "test",
          argv: [
            "node",
            "-e",
            "const fs=require('fs');if(fs.existsSync('/run/docker.sock')||fs.existsSync('.roopre-artifacts/agent-only.json')||fs.existsSync('node_modules/.vite/agent-cache')||fs.existsSync('node_modules/.vite-temp/config.js'))process.exit(1);fs.writeFileSync('node_modules/.vite/verification-cache','fresh cache');fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/result.json',JSON.stringify({passed:true}))",
          ],
          timeoutSeconds: 30,
        },
      ];
      await store.execute("owner", randomUUID(), {
        type: "configure_execution",
        projectId: "first-project",
        profile: {
          repositoryPath: repo,
          baseBranch: "main",
          baseCommit: base,
          connectionId,
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
          checks,
          webRequired: false,
          budgetUsd: 1,
          timeoutMinutes: 2,
          repairLimit: 0,
        },
      });
      await store.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "Contract fixture",
        template: "feature",
        requirements: "AC01 create hello.txt with the expected fixture content",
      });
      let state = await store.read("owner");
      let feature = state.features[0];
      await store.execute("owner", randomUUID(), {
        type: "save_draft",
        featureId: feature.id,
        expectedRevision: 0,
        requirements: feature.draft.requirements,
        body: sections
          .map((s) => `## ${s}\nFixture evidence for ${s}`)
          .join("\n\n"),
      });
      await store.execute("owner", randomUUID(), {
        type: "publish_design",
        featureId: feature.id,
        expectedRevision: 1,
      });
      state = await store.read("owner");
      feature = state.features[0];
      await store.execute(
        "owner",
        randomUUID(),
        {
          type: "review",
          featureId: feature.id,
          designId: feature.designs[0].id,
          checked: [...sections],
          decision: "approve",
        },
        {
          authentication: "macos-owner",
          binding: approvalBinding(state, feature),
        },
      );
      runId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_run",
          featureId: feature.id,
          designId: feature.designs[0].id,
        })
      ).entityId!;
      runner = new RunnerManager(
        store,
        vault,
        join(root, "runs"),
        resolve("resources"),
      );
      await Promise.all([
        runner.execute(runId, new AbortController()),
        runner.execute(runId, new AbortController()),
      ]);
      const result = (await store.read("owner")).runs[0];
      assert.equal(
        result.status,
        "ready_for_merge",
        JSON.stringify(result, null, 2),
      );
      assert.equal(result.runtime!.evidence.length, 2);
      assert(result.runtime!.head);
      assert.equal(await git(repo, "rev-parse", "HEAD"), base);
      assert.equal(
        (
          await command("docker", [
            "ps",
            "-aq",
            "--filter",
            `name=roopre-${runId}`,
          ])
        ).output.trim(),
        "",
      );
      assert.match(await runner.diff(runId), /hello from fixture/);
      assert.equal(result.runtime!.artifacts?.length, 1);
      const artifact = result.runtime!.artifacts![0];
      assert.equal(
        JSON.parse(
          await readFile(
            await checkedArtifact(
              result.runtime!.artifactRoot!,
              artifact.path,
              artifact.hash,
            ),
            "utf8",
          ),
        ).passed,
        true,
      );
      // A killed process must not become a success; retry restores the saved changes.
      await store.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "Checkpoint fixture",
        template: "feature",
        requirements:
          "AC01 SLOW_SCENARIO create hello.txt and preserve checkpoint.txt",
      });
      state = await store.read("owner");
      feature = state.features.find((f) => f.title === "Checkpoint fixture")!;
      await store.execute("owner", randomUUID(), {
        type: "save_draft",
        featureId: feature.id,
        expectedRevision: 0,
        requirements: feature.draft.requirements,
        body: sections
          .map((s) => `## ${s}\nFixture evidence for ${s}`)
          .join("\n\n"),
      });
      await store.execute("owner", randomUUID(), {
        type: "publish_design",
        featureId: feature.id,
        expectedRevision: 1,
      });
      state = await store.read("owner");
      feature = state.features.find((f) => f.id === feature.id)!;
      await store.execute(
        "owner",
        randomUUID(),
        {
          type: "review",
          featureId: feature.id,
          designId: feature.designs[0].id,
          checked: [...sections],
          decision: "approve",
        },
        {
          authentication: "macos-owner",
          binding: approvalBinding(state, feature),
        },
      );
      const interruptedId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_run",
          featureId: feature.id,
          designId: feature.designs[0].id,
        })
      ).entityId!;
      runId = interruptedId;
      const abort = new AbortController();
      const execution = runner.execute(interruptedId, abort);
      let checkpoint = false;
      for (let i = 0; i < 200; i++) {
        checkpoint = await readFile(
          join(root, "runs", interruptedId, "checkout", "checkpoint.txt"),
          "utf8",
        )
          .then((x) => x === "preserved checkpoint")
          .catch(() => false);
        if (checkpoint) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      abort.abort();
      await execution;
      assert(checkpoint, "Implementation reached its checkpoint");
      const interrupted = (await store.read("owner")).runs.find(
        (r) => r.id === interruptedId,
      )!;
      assert.equal(interrupted.status, "interrupted");
      assert.equal(interrupted.runtime!.terminationConfirmed, true);
      const retried = await runner.retry(interruptedId);
      runId = retried.entityId;
      await runner.execute(runId, new AbortController());
      const resumed = (await store.read("owner")).runs.find(
        (r) => r.id === runId,
      )!;
      assert.equal(
        resumed.status,
        "ready_for_merge",
        JSON.stringify(resumed, null, 2),
      );
      assert.equal(resumed.runtime!.resumeFrom, interruptedId);
      assert.equal(
        await readFile(
          join(resumed.runtime!.worktree!, "checkpoint.txt"),
          "utf8",
        ),
        "preserved checkpoint",
      );
      assert.equal(await git(repo, "rev-parse", "HEAD"), base);
      // A timed-out exec must stop the attempt, destroy its process and never
      // overlap the next check. This fixture never contacts a real model.
      await store.execute("owner", randomUUID(), {
        type: "configure_execution",
        projectId: "first-project",
        profile: {
          ...resumed.runtime!.profile,
          checks: [
            {
              name: "typecheck",
              argv: [
                "node",
                "-e",
                "setTimeout(()=>require('fs').writeFileSync('late-write.txt','orphan'),8000);setInterval(()=>{},1000)",
              ],
              timeoutSeconds: 5,
            },
            {
              name: "test",
              argv: [
                "node",
                "-e",
                "require('fs').writeFileSync('next-check.txt','should not run')",
              ],
              timeoutSeconds: 5,
            },
          ],
        },
      });
      const created = await store.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "Timeout isolation",
        template: "feature",
        requirements: "AC01 create hello.txt with the expected fixture content",
      });
      await store.execute("owner", randomUUID(), {
        type: "save_draft",
        featureId: created.entityId!,
        expectedRevision: 0,
        requirements: "AC01 create hello.txt with the expected fixture content",
        body: sections
          .map((s) => `## ${s}\nFixture evidence for ${s}`)
          .join("\n\n"),
      });
      await store.execute("owner", randomUUID(), {
        type: "publish_design",
        featureId: created.entityId!,
        expectedRevision: 1,
      });
      state = await store.read("owner");
      feature = state.features.find((f) => f.id === created.entityId)!;
      await store.execute(
        "owner",
        randomUUID(),
        {
          type: "review",
          featureId: feature.id,
          designId: feature.designs[0].id,
          checked: [...sections],
          decision: "approve",
        },
        {
          authentication: "macos-owner",
          binding: approvalBinding(state, feature),
        },
      );
      runId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_run",
          featureId: feature.id,
          designId: feature.designs[0].id,
        })
      ).entityId!;
      await runner.execute(runId, new AbortController());
      const timedOut = (await store.read("owner")).runs.find(
        (r) => r.id === runId,
      )!;
      assert.equal(timedOut.status, "failed");
      assert.match(timedOut.reason, /시간 한도/);
      assert.equal(timedOut.runtime!.terminationConfirmed, true);
      assert.deepEqual(
        timedOut.runtime!.evidence.map((e) => e.name),
        ["typecheck"],
      );
      assert.equal(timedOut.runtime!.evidence[0].code, -1);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      for (const name of ["late-write.txt", "next-check.txt"])
        await assert.rejects(
          readFile(join(timedOut.runtime!.worktree!, name)),
          { code: "ENOENT" },
        );

      // Custom stages: planning is read-only, then two independent mandatory reviews.
      await store.execute("owner", randomUUID(), {
        type: "configure_execution",
        projectId: "first-project",
        profile: { ...resumed.runtime!.profile, checks, repairLimit: 0 },
      });
      const stageIds = [
        "requirements",
        "implementation",
        "verification",
        "review",
      ] as const;
      const defs = stageIds.map((stage) => ({
        id: randomUUID(),
        revision: 1,
        name: `custom-${stage}`,
        description: "fixture only",
        capability:
          stage === "implementation"
            ? ("implementation" as const)
            : ("read-only" as const),
        markdown: `# ${stage} instructions`,
        archived: false,
      }));
      for (const agent of defs)
        await store.execute("owner", randomUUID(), {
          type: "save_agent",
          expectedRevision: 0,
          agent,
        });
      await store.execute("owner", randomUUID(), {
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
          assignments: defs.map((a, i) => ({
            id: randomUUID(),
            agentId: a.id,
            stage: stageIds[i],
            required: true,
          })),
        },
      });
      const custom = await store.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "Custom harness",
        template: "feature",
        requirements: "AC01 create hello.txt",
      });
      runId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_planning",
          featureId: custom.entityId!,
          expectedRevision: 0,
        })
      ).entityId!;
      await runner.execute(runId, new AbortController());
      state = await store.read("owner");
      const planned = state.runs.find((r) => r.id === runId)!;
      assert.equal(planned.status, "completed", JSON.stringify(planned));
      assert.equal(planned.runtime!.agents!.length, 1);
      assert.equal(
        await git(planned.runtime!.worktree!, "rev-parse", "HEAD"),
        base,
      );
      feature = state.features.find((f) => f.id === custom.entityId)!;
      assert.equal(feature.designs.length, 0);
      assert.equal(feature.draft.revision, 1);
      await store.execute("owner", randomUUID(), {
        type: "publish_design",
        featureId: feature.id,
        expectedRevision: 1,
      });
      state = await store.read("owner");
      feature = state.features.find((f) => f.id === custom.entityId)!;
      await store.execute(
        "owner",
        randomUUID(),
        {
          type: "review",
          featureId: feature.id,
          designId: feature.designs.at(-1)!.id,
          decision: "approve",
          checked: [...sections],
        },
        {
          authentication: "macos-owner",
          binding: approvalBinding(state, feature),
        },
      );
      runId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_run",
          featureId: feature.id,
          designId: feature.designs.at(-1)!.id,
        })
      ).entityId!;
      await runner.execute(runId, new AbortController());
      const customResult = (await store.read("owner")).runs.find(
        (r) => r.id === runId,
      )!;
      assert.equal(
        customResult.status,
        "ready_for_merge",
        JSON.stringify(customResult),
      );
      assert.deepEqual(
        customResult.runtime!.agents!.map((a) => a.stage),
        ["implementation", "verification", "review"],
      );
      assert(
        customResult.runtime!.agents!.every(
          (a) =>
            a.status === "passed" &&
            a.inputTree &&
            a.outputTree &&
            a.instructionHash,
        ),
      );
      assert.equal(customResult.runtime!.evidence.length, 2);
      // A single required convention failure must prevent completion even if the final reviewer passes.
      await store.execute("owner", randomUUID(), {
        type: "save_agent",
        expectedRevision: 1,
        agent: { ...defs[2], revision: 2, markdown: "REQUIRED_FAIL_FIXTURE" },
      });
      await store.execute("owner", randomUUID(), {
        type: "cancel_run",
        runId: customResult.id,
      });
      await store.execute("owner", randomUUID(), {
        type: "publish_design",
        featureId: feature.id,
        expectedRevision: 1,
      });
      state = await store.read("owner");
      feature = state.features.find((f) => f.id === custom.entityId)!;
      await store.execute(
        "owner",
        randomUUID(),
        {
          type: "review",
          featureId: feature.id,
          designId: feature.designs.at(-1)!.id,
          decision: "approve",
          checked: [...sections],
        },
        {
          authentication: "macos-owner",
          binding: approvalBinding(state, feature),
        },
      );
      runId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_run",
          featureId: feature.id,
          designId: feature.designs.at(-1)!.id,
        })
      ).entityId!;
      await runner.execute(runId, new AbortController());
      const failedCustom = (await store.read("owner")).runs.find(
        (r) => r.id === runId,
      )!;
      assert.equal(failedCustom.status, "failed");
      assert.equal(failedCustom.runtime!.head, undefined);
      assert.deepEqual(
        failedCustom.runtime!.agents!.map((a) => a.status),
        ["passed", "failed", "passed"],
      );

      // Optional malformed planning results must not manufacture a successful draft.
      await store.execute("owner", randomUUID(), {
        type: "save_agent",
        expectedRevision: 1,
        agent: { ...defs[0], revision: 2, markdown: "INVALID_JSON_FIXTURE" },
      });
      const beforeOptional = await store.read("owner");
      const flow = beforeOptional.projects.find(
        (p) => p.id === "first-project",
      )!.workflow!;
      await store.execute("owner", randomUUID(), {
        type: "save_workflow",
        projectId: "first-project",
        expectedRevision: flow.revision,
        workflow: {
          ...flow,
          revision: flow.revision + 1,
          assignments: flow.assignments.map((a) =>
            a.stage === "requirements" ? { ...a, required: false } : a,
          ),
        },
      });
      const invalidPlan = await store.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "Preserve invalid planning input",
        template: "feature",
        requirements: "AC01 retain original draft",
      });
      const originalDraft = (await store.read("owner")).features.find(
        (f) => f.id === invalidPlan.entityId,
      )!.draft;
      runId = (
        await store.execute("owner", randomUUID(), {
          type: "queue_planning",
          featureId: invalidPlan.entityId!,
          expectedRevision: 0,
        })
      ).entityId!;
      await runner.execute(runId, new AbortController());
      const afterOptional = await store.read("owner");
      assert.equal(
        afterOptional.runs.find((r) => r.id === runId)!.status,
        "failed",
      );
      assert.deepEqual(
        afterOptional.features.find((f) => f.id === invalidPlan.entityId)!
          .draft,
        originalDraft,
      );
    } finally {
      await runner?.stop();
      if (runId) await runner?.cleanup(runId);
      await store.pool.query("DELETE FROM commands WHERE workspace_id=$1", [
        store.key,
      ]);
      await store.pool.query("DELETE FROM events WHERE workspace_id=$1", [
        store.key,
      ]);
      await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
      await store.close();
      await rm(root, { recursive: true, force: true });
      await command("docker", ["image", "rm", image]);
    }
  },
);

test(
  "bootstrap creates a private loopback DB, reconnects with persisted identity and preserves user records",
  { timeout: 120000 },
  async () => {
    const { Bootstrap } = await import("../src/main/bootstrap/environment.ts");
    const root = await mkdtemp(join(tmpdir(), "roopre-bootstrap-docker-"));
    const cipher = {
      encrypt: (s: string) => Buffer.from(s.split("").reverse().join("")),
      decrypt: (b: Buffer) => b.toString().split("").reverse().join(""),
    };
    let database: Store | undefined;
    let bootstrap: InstanceType<typeof Bootstrap> | undefined;
    let identity = "";
    const source = new Store(
      `test-transfer-${randomUUID()}`,
      undefined,
      "local-owner",
    );
    const { transferWorkspace } = await import("../src/database/transfer.ts");
    try {
      await source.init();
      await source.execute("owner", randomUUID(), {
        type: "create_project",
        name: "Original preserved",
        description: "",
        reviewerIds: ["owner"],
      });
      const sourceBefore = await source.read("owner");
      const connect = async (url: string) => {
        const next = new Store(source.key, url, "local-owner");
        await next.init();
        assert.equal((await next.read("owner")).projects.length, 0);
        database = next;
        const transferred = await transferWorkspace(
          source,
          next,
          join(root, "backup"),
        );
        assert.equal(
          (await readFile(transferred.backup, "utf8")).includes(
            "Original preserved",
          ),
          true,
        );
        assert.equal(transferred.hash.length, 64);
      };
      bootstrap = new Bootstrap(
        root,
        cipher,
        resolve("config/runner.Dockerfile"),
        connect,
        () => !!database,
      );
      await bootstrap.init();
      bootstrap.prepare();
      bootstrap.prepare();
      for (let i = 0; i < 500 && bootstrap.status().busy; i++)
        await new Promise((r) => setTimeout(r, 100));
      assert.equal(bootstrap.status().error, "");
      assert(database);
      assert.equal(bootstrap.status().busy, false);
      const saved = JSON.parse(
        await readFile(join(root, "onboarding.json"), "utf8"),
      );
      identity = saved.database.id;
      assert(
        !JSON.stringify(bootstrap.status()).includes(saved.database.sealed),
      );
      const state = await database.read("owner");
      assert.equal(state.projects.length, 1);
      assert.deepEqual(await source.read("owner"), sourceBefore);
      await database.execute("owner", randomUUID(), {
        type: "create_project",
        name: "Preserved real record",
        description: "",
        reviewerIds: ["owner"],
      });
      const key = database.key;
      await database.close();
      database = undefined;
      const reopened = new Bootstrap(
        root,
        cipher,
        resolve("config/runner.Dockerfile"),
        async (url) => {
          database = new Store(key, url, "local-owner");
          await database.init();
        },
        () => !!database,
      );
      await reopened.init();
      await reopened.restore("unused");
      assert.equal(reopened.status().connected, true);
      assert.equal(
        (await database!.read("owner")).projects[1].name,
        "Preserved real record",
      );
      const inspection = JSON.parse(
        (await command("docker", ["inspect", `roopre-db-${identity}`])).output,
      )[0];
      assert.equal(
        inspection.NetworkSettings.Ports["5432/tcp"][0].HostIp,
        "127.0.0.1",
      );
      assert.equal(inspection.Config.Labels["dev.roopre.profile"], identity);
    } finally {
      await bootstrap?.stop();
      await database?.close();
      for (const table of ["commands", "events"])
        await source.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
          source.key,
        ]);
      await source.pool.query("DELETE FROM workspaces WHERE id=$1", [
        source.key,
      ]);
      await source.close();
      if (!identity)
        identity = await readFile(join(root, "onboarding.json"), "utf8")
          .then((s) => JSON.parse(s).database?.id ?? "")
          .catch(() => "");
      // Only the random identity generated in this isolated test may be cleaned up.
      if (/^[a-f0-9-]{36}$/.test(identity)) {
        await command("docker", ["rm", "-f", `roopre-db-${identity}`]);
        await command("docker", ["volume", "rm", `roopre-data-${identity}`]);
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
