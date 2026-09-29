import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connect, type Socket } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { _electron as electron, expect } from "@playwright/test";
import { databaseUrl } from "../src/database/store.ts";
import { Store } from "../src/database/store.ts";
import { ownerFixture } from "./fixtures/workspace.ts";

test(
  "real IPC records app confirmation, rejects stale reports, and persists a fixture consultation across restart",
  { timeout: 120000 },
  async () => {
    const upstream = new URL(databaseUrl);
    assert(["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname));
    const schema = `conversation_native_${randomUUID().replaceAll("-", "")}`;
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const root = await mkdtemp(join(tmpdir(), "roopre-conversation-native-"));
    const sockets = new Set<Socket>();
    let online = true;
    const proxy = createServer((client) => {
      if (!online) return client.destroy();
      const target = connect(Number(upstream.port || 5432), upstream.hostname);
      const destroy = () => {
        client.destroy();
        target.destroy();
      };
      for (const socket of [client, target]) {
        sockets.add(socket);
        socket.on("error", destroy);
        socket.on("close", () => sockets.delete(socket));
      }
      client.pipe(target).pipe(client);
    });
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let fixtureStore: Store | undefined;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const address = proxy.address();
      assert(address && typeof address !== "string");
      const url = new URL(databaseUrl);
      url.hostname = "127.0.0.1";
      url.port = String(address.port);
      url.searchParams.set("options", `-c search_path=${schema}`);
      // This preloads a test-only execution profile through the domain. It is
      // only a state fixture for the approval IPC test; no Docker run occurs.
      fixtureStore = new Store(
        "roopre-owner-v02",
        url.href,
        "local-owner",
        ownerFixture,
      );
      await fixtureStore.init();
      await fixtureStore.execute("owner", randomUUID(), {
        type: "configure_execution",
        projectId: "first-project",
        profile: {
          repositoryPath: "/fixture/no-execution",
          baseBranch: "main",
          baseCommit: "a".repeat(40),
          connectionId: "00000000-0000-4000-8000-000000000070",
          connectionVersion: 1,
          image: "fixture/no-execution:latest",
          checks: [
            {
              name: "typecheck",
              argv: ["pnpm", "typecheck"],
              timeoutSeconds: 60,
            },
            { name: "test", argv: ["pnpm", "test"], timeoutSeconds: 60 },
          ],
          webRequired: false,
          budgetUsd: 2,
          timeoutMinutes: 10,
          repairLimit: 1,
        },
      });
      const fixtureFeature = await fixtureStore.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "Approval IPC fixture",
        template: "feature",
        requirements: "AC01 records an explicit app confirmation.",
      });
      const body = [
        "## 요구사항\nAC01 records an explicit app confirmation.",
        "## 구조\nThe desktop process verifies the displayed report binding.",
        "## API·데이터\nThe review command includes the current confirmation binding.",
        "## 예외 상황\nA changed report rejects the stale binding.",
        "## 변경 영향\nOnly this fixture approval is affected.",
        "## 검증 계획\nIPC records app-confirmation and rejects stale input.",
        "## 적용·복구\nThis test fixture creates no execution and needs no rollback.",
      ].join("\n\n");
      await fixtureStore.execute("owner", randomUUID(), {
        type: "save_draft",
        featureId: fixtureFeature.entityId!,
        expectedRevision: 0,
        requirements: "AC01 records an explicit app confirmation.",
        body,
      });
      await fixtureStore.execute("owner", randomUUID(), {
        type: "publish_design",
        featureId: fixtureFeature.entityId!,
        expectedRevision: 1,
      });
      await fixtureStore.close();
      fixtureStore = undefined;
      const fixtureEndpoint = "https://conversation-fixture.invalid";
      const delayedProvider = join(root, "delay-provider");
      const providerRequests = join(root, "provider-requests.log");
      const entry = join(root, "main.mjs");
      await writeFile(
        entry,
        `import { app } from 'electron';
app.setPath('appData',${JSON.stringify(root)});
app.getAppPath=()=>${JSON.stringify(resolve("."))};
const {appendFile,existsSync}=await import('node:fs');
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,init)=>{
  if(String(input)===${JSON.stringify(fixtureEndpoint + "/v1/messages")}) {
    appendFile(${JSON.stringify(providerRequests)},'request\\n',()=>{});
    if(existsSync(${JSON.stringify(delayedProvider)})) return new Promise(()=>{});
    return new Response(JSON.stringify({type:'message',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({answer:'fixture consultation answer'})}],usage:{input_tokens:7,output_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});
  }
  return originalFetch(input,init);
};
await import(${JSON.stringify(pathToFileURL(resolve("out/main/index.js")).href)});`,
      );
      const launch = () =>
        electron.launch({
          args: [entry],
          env: {
            PATH: process.env.PATH!,
            HOME: root,
            DEVFLOW_DATABASE_URL: url.href,
          },
        });
      application = await launch();
      let page = await application.firstWindow();
      await page
        .getByRole("button", { name: "나중에 · 앱 열기", exact: true })
        .click();
      await page.evaluate(async (featureId) => {
        const api = (globalThis as any).roopre;
        let snapshot = await api.snapshot();
        const feature = snapshot.features.find(
          (item: any) => item.id === featureId,
        );
        const design = feature.designs.at(-1);
        const binding = snapshot.approvalBindings?.[featureId];
        if (!binding) throw Error("approval binding was not exposed");
        await api.command({
          type: "review",
          featureId,
          designId: design.id,
          decision: "approve",
          checked: [],
          confirmationBinding: binding,
        });
        snapshot = await api.snapshot();
        const decision = snapshot.features
          .find((item: any) => item.id === featureId)
          .designs.at(-1).decisions[0];
        if (decision?.authentication !== "app-confirmation")
          throw Error("app confirmation was not persisted");
        await api.command({
          type: "update_project_policy",
          projectId: "first-project",
          instructions: "The design report changed after the first approval.",
          requiredChecks: ["typecheck", "test", "review"],
          reviewerIds: ["owner"],
        });
        let staleRejected = false;
        try {
          await api.command({
            type: "review",
            featureId,
            designId: design.id,
            decision: "approve",
            checked: [],
            confirmationBinding: binding,
          });
        } catch {
          staleRejected = true;
        }
        if (!staleRejected) throw Error("stale approval binding was accepted");
      }, fixtureFeature.entityId);
      const created = await page.evaluate(
        async (input) => {
          const api = (globalThis as any).roopre;
          const project = await api.command({
            type: "create_project",
            name: "Conversation fixture",
            description: "native IPC fixture",
            reviewerIds: ["owner"],
          });
          const feature = await api.command({
            type: "create_feature",
            projectId: project.entityId,
            title: "Fixture feature",
            template: "feature",
            requirements: "Consultation persists.",
          });
          let snapshot = await api.snapshot();
          const agentId = "00000000-0000-4000-8000-000000000071";
          const connections = await api.saveConnection({
            name: "Fixture Messages",
            endpoint: input.fixtureEndpoint,
            auth: "api-key",
            model: "fixture-model",
            key: "fixture-only-key",
          });
          const connectionId = connections[0].id;
          const tested = await api.testConnection(connectionId);
          if (tested[0]?.testStatus !== "passed")
            throw Error("fixture connection did not pass");
          snapshot = await api.snapshot();
          const implementationId = "00000000-0000-4000-8000-000000000072";
          const reviewerId = "00000000-0000-4000-8000-000000000074";
          await api.command({
            type: "save_agent",
            expectedRevision: 0,
            agent: {
              id: agentId,
              revision: 1,
              name: "Fixture consultant",
              description: "Read-only fixture",
              capability: "read-only",
              connectionId,
              connectionVersion: 1,
              markdown: "Read-only consultation.",
              archived: false,
            },
          });
          await api.command({
            type: "save_agent",
            expectedRevision: 0,
            agent: {
              id: implementationId,
              revision: 1,
              name: "Fixture implementer",
              description: "Required fixture implementation role",
              capability: "implementation",
              connectionId,
              connectionVersion: 1,
              markdown: "Implement only approved fixture work.",
              archived: false,
            },
          });
          await api.command({
            type: "save_agent",
            expectedRevision: 0,
            agent: {
              id: reviewerId,
              revision: 1,
              name: "Fixture reviewer",
              description: "Required fixture review role",
              capability: "read-only",
              connectionId,
              connectionVersion: 1,
              markdown: "Review fixture work.",
              archived: false,
            },
          });
          await api.command({
            type: "save_workflow",
            projectId: project.entityId,
            expectedRevision: 0,
            workflow: {
              revision: 1,
              instructions: {
                requirements: "Fixture requirements context.",
                design: "Fixture design context.",
                implementation: "Fixture implementation context.",
                verification: "Fixture verification context.",
                review: "Fixture review context.",
              },
              assignments: [
                {
                  id: "00000000-0000-4000-8000-000000000075",
                  agentId,
                  stage: "requirements",
                  required: true,
                },
                {
                  id: "00000000-0000-4000-8000-000000000076",
                  agentId: implementationId,
                  stage: "implementation",
                  required: true,
                },
                {
                  id: "00000000-0000-4000-8000-000000000077",
                  agentId: reviewerId,
                  stage: "review",
                  required: true,
                },
              ],
            },
          });
          snapshot = await api.snapshot();
          const scope = {
            workspaceId: snapshot.teamId,
            projectId: project.entityId,
            agentDefinitionId: agentId,
            featureId: feature.entityId,
          };
          const pending = await api.conversations.sendTurn({
            scope,
            requestId: "00000000-0000-4000-8000-000000000073",
            message: "What is persisted?",
          });
          return {
            scope,
            threadId: pending.thread.id,
            turnId: pending.turn.id,
          };
        },
        {
          fixtureEndpoint,
        },
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              async (created) =>
                (
                  await (globalThis as any).roopre.conversations.listTurns({
                    threadId: created.threadId,
                    limit: 30,
                  })
                )[0]?.status,
              created,
            ),
          { timeout: 10000 },
        )
        .toBe("completed");
      const completed = await page.evaluate(
        async (created) =>
          (
            await (globalThis as any).roopre.conversations.listTurns({
              threadId: created.threadId,
              limit: 30,
            })
          )[0],
        created,
      );
      assert.equal(completed.status, "completed", completed.error);
      assert.equal(completed.answer, "fixture consultation answer");
      assert.deepEqual(completed.usage, { inputTokens: 7, outputTokens: 5 });
      await page
        .getByRole("button", { name: "전역 관제", exact: true })
        .click();
      await page
        .getByRole("button", { name: /Fixture feature/ })
        .first()
        .click();
      await page.getByRole("tab", { name: "대화", exact: true }).click();
      await page.getByLabel("상담 메시지").fill("Rendered compose request");
      await page
        .getByRole("button", { name: "질문 보내기", exact: true })
        .click();
      await expect(
        page.getByText("fixture consultation answer", { exact: true }),
      ).toHaveCount(2, { timeout: 10000 });
      await page.screenshot({
        path: resolve("artifacts/conversation-native-rendered-compose.png"),
      });
      const requestCount = async () =>
        readFile(providerRequests, "utf8")
          .then((value) => value.trim().split("\n").filter(Boolean).length)
          .catch(() => 0);
      const beforePending = await requestCount();
      await writeFile(delayedProvider, "delay");
      const stale = await page.evaluate(async (created) => {
        const api = (globalThis as any).roopre;
        return api.conversations.sendTurn({
          scope: created.scope,
          requestId: "00000000-0000-4000-8000-000000000078",
          message: "Pending startup recovery fixture",
        });
      }, created);
      await expect
        .poll(requestCount, { timeout: 5000 })
        .toBe(beforePending + 1);
      const fixtureProcess = application.process();
      fixtureProcess.kill("SIGKILL");
      await once(fixtureProcess, "exit");
      application = undefined;
      await rm(delayedProvider, { force: true });
      application = await launch();
      page = await application.firstWindow();
      await expect
        .poll(
          () =>
            page.evaluate(
              async ({ threadId, turnId }) =>
                (
                  await (globalThis as any).roopre.conversations.listTurns({
                    threadId,
                    limit: 30,
                  })
                ).find((turn: any) => turn.id === turnId)?.status,
              { threadId: stale.thread.id, turnId: stale.turn.id },
            ),
          { timeout: 10000 },
        )
        .toBe("interrupted");
      assert.equal(await requestCount(), beforePending + 1);
      const reserved = await pool.query(
        `SELECT reserved_bytes FROM "${schema}".conversation_threads WHERE id=$1`,
        [stale.thread.id],
      );
      assert.equal(Number(reserved.rows[0]?.reserved_bytes), 0);
      online = false;
      for (const socket of sockets) socket.destroy();
      await assert.rejects(
        page.evaluate(
          (threadId) =>
            (globalThis as any).roopre.conversations.listTurns({
              threadId,
              limit: 30,
            }),
          created.threadId,
        ),
      );
      online = true;
      const recovered = await page.evaluate(
        (threadId) =>
          (globalThis as any).roopre.conversations.listTurns({
            threadId,
            limit: 30,
          }),
        created.threadId,
      );
      assert.equal(recovered.length, 3);
      await application.close();
      application = await launch();
      page = await application.firstWindow();
      const restored = await page.evaluate(async (created) => {
        const api = (globalThis as any).roopre;
        return api.conversations.listTurns({
          threadId: created.threadId,
          limit: 30,
        });
      }, created);
      assert.equal(restored.length, 3);
      assert.equal(restored[0].answer, "fixture consultation answer");
    } finally {
      await application?.close().catch(() => {});
      await fixtureStore?.close().catch(() => {});
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve())).catch(
        () => {},
      );
      await pool
        .query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
        .catch(() => {});
      await pool.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
