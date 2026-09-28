import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { seed } from "./fixtures/workspace.ts";
import { ConversationService } from "../src/main/conversations/service.ts";

const connectionId = "00000000-0000-4000-8000-000000000191";
const agentId = "00000000-0000-4000-8000-000000000192";
const vault = {
  get: () => ({
    info: {
      id: connectionId,
      name: "Fixture",
      version: 1,
      endpoint: "https://fixture.invalid",
      auth: "api-key" as const,
      model: "fixture",
      hasKey: true,
      testStatus: "passed" as const,
      testedAt: new Date().toISOString(),
    },
    key: "fixture",
  }),
};
async function settled(service: ConversationService, threadId: string) {
  for (let i = 0; i < 100; i++) {
    const turn = (await service.listTurns(threadId)).at(-1)!;
    if (turn.status !== "pending") return turn;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("pending did not settle");
}
test("service records truncated and oversized provider bodies as failures and ignores late cancelled answers", async (t) => {
  const store = new Store(
    `conversation-failures-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  t.after(async () => {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "fixture",
        archived: false,
      },
    ];
  });
  let release!: () => void;
  let providerEntered!: () => void;
  const providerEnteredPromise = new Promise<void>((resolve) => {
    providerEntered = resolve;
  });
  let calls = 0;
  const service = new ConversationService(store, vault, async () => {
    calls++;
    if (calls === 1)
      return new Response(
        JSON.stringify({ stop_reason: "max_tokens", content: [] }),
      );
    if (calls === 2) return new Response("x".repeat(128001));
    await new Promise<void>((resolve) => {
      release = resolve;
      providerEntered();
    });
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ answer: "late" }) }],
      }),
    );
  });
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  for (const message of ["truncated", "oversized"]) {
    const sent = await service.send({
      scope,
      requestId: randomUUID(),
      message,
    });
    assert.equal((await settled(service, sent.thread.id)).status, "failed");
  }
  const late = await service.send({
    scope,
    requestId: randomUUID(),
    message: "cancel",
  });
  await providerEnteredPromise;
  assert.equal(await service.cancel(late.thread.id, late.turn.id), true);
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    (await service.listTurns(late.thread.id)).at(-1)!.status,
    "cancelled",
  );
});

test("interruptAll closes admission while a send is preparing", async (t) => {
  const store = new Store(
    `conversation-admission-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  t.after(async () => {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "fixture",
        archived: false,
      },
    ];
  });
  const originalRead = store.read.bind(store);
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  const enteredPromise = new Promise<void>((r) => {
    entered = r;
  });
  let reads = 0;
  store.read = async (...args: Parameters<Store["read"]>) => {
    if (++reads === 1) {
      entered();
      await blocked;
    }
    return originalRead(...args);
  };
  let fetched = 0;
  const service = new ConversationService(store, vault, async () => {
    fetched++;
    return new Response("{}");
  });
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  const sending = service.send({
    scope,
    requestId: randomUUID(),
    message: "race",
  });
  await enteredPromise;
  let drained = false;
  const draining = service.interruptAll().then(() => {
    drained = true;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(drained, false);
  release();
  await draining;
  await assert.rejects(sending, /상담.*종료|중단|drain/i);
  assert.equal(fetched, 0);
  assert.equal(
    Number(
      (
        await store.pool.query(
          "SELECT count(*)::int AS n FROM conversation_turns c JOIN conversation_threads t ON t.id=c.thread_id WHERE t.workspace_id=$1 AND c.status='pending'",
          [store.key],
        )
      ).rows[0].n,
    ),
    0,
  );
  service.resumeAdmissions();
  const next = await service.send({
    scope,
    requestId: randomUUID(),
    message: "after",
  });
  assert.equal(next.turn.status, "pending");
});

test("terminal write failures preserve pending work until storage recovers", async (t) => {
  const store = new Store(
    `conversation-terminal-write-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  let restoreConnect: (() => void) | undefined;
  t.after(async () => {
    restoreConnect?.();
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "fixture",
        archived: false,
      },
    ];
  });
  const originalConnect = store.pool.connect.bind(store.pool) as any;
  let rejectTerminalWrite = true;
  const wrapped = new WeakSet<object>();
  const installFailure = (client: any) => {
    if (wrapped.has(client)) return client;
    wrapped.add(client);
    const originalQuery = client.query.bind(client);
    client.query = ((...args: any[]) => {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      if (
        rejectTerminalWrite &&
        typeof text === "string" &&
        /^UPDATE conversation_turns(?:\s+\w+)? SET (?:answer|status)=/i.test(
          text.trim(),
        )
      ) {
        const error = Error("fixture terminal write failed");
        const callback = args.at(-1);
        if (typeof callback === "function") {
          queueMicrotask(() => callback(error));
          return undefined;
        }
        return Promise.reject(error);
      }
      return originalQuery(...(args as Parameters<typeof originalQuery>));
    }) as typeof client.query;
  };
  // Pool.query uses connect(callback), while the conversation storage code uses
  // the Promise overload. Preserve both forms so the failure shim cannot stall
  // unrelated reads or cleanup queries.
  store.pool.connect = ((callback?: any) => {
    if (typeof callback === "function")
      return originalConnect((error: unknown, client: any, release: any) => {
        if (!error && client) installFailure(client);
        callback(error, client, release);
      });
    return originalConnect().then((client: any) => {
      installFailure(client);
      return client;
    });
  }) as typeof store.pool.connect;
  restoreConnect = () => {
    store.pool.connect = originalConnect;
  };
  let fetched = 0;
  const service = new ConversationService(store, vault, async () => {
    fetched++;
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ answer: "answer" }) }],
      }),
    );
  });
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  const sent = await service.send({
    scope,
    requestId: randomUUID(),
    message: "durable pending",
  });
  for (let i = 0; i < 40; i++) {
    if ((await service.listTurns(sent.thread.id)).at(-1)!.status === "pending")
      await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(
    (await service.listTurns(sent.thread.id)).at(-1)!.status,
    "pending",
  );
  assert.equal(fetched, 1);
  await assert.rejects(service.interruptAll(), /fixture terminal write failed/);
  assert.equal(
    (await service.listTurns(sent.thread.id)).at(-1)!.status,
    "pending",
  );
  rejectTerminalWrite = false;
  await service.interruptAll();
  assert.equal(
    (await service.listTurns(sent.thread.id)).at(-1)!.status,
    "interrupted",
  );
  assert.equal(fetched, 1);
});

test("prepared history is rejected when deletion or summary reset changes its thread", async (t) => {
  const store = new Store(
    `conversation-stale-context-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  t.after(async () => {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "fixture",
        archived: false,
      },
    ];
  });
  let fetches = 0;
  const service = new ConversationService(store, vault, async () => {
    fetches++;
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({ answer: "DELETED_PRIVATE_FACT" }),
          },
        ],
      }),
    );
  });
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  const start = async () => {
    const sent = await service.send({
      scope,
      requestId: randomUUID(),
      message: "private conversation",
    });
    await settled(service, sent.thread.id);
    return sent;
  };
  const pauseAfterSearch = () => {
    const originalQuery = store.pool.query.bind(store.pool);
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let paused = false;
    store.pool.query = ((...args: any[]) => {
      const result = (originalQuery as any)(...args);
      if (
        !paused &&
        typeof args.at(-1) !== "function" &&
        String(args[0]).includes("status='completed' AND")
      ) {
        paused = true;
        return result.then(async (value: any) => {
          entered();
          await barrier;
          return value;
        });
      }
      return result;
    }) as typeof store.pool.query;
    return {
      entered: enteredPromise,
      release: () => {
        store.pool.query = originalQuery as typeof store.pool.query;
        release();
      },
    };
  };
  const first = await start();
  const deletedRace = pauseAfterSearch();
  const staleAfterDelete = service.send({
    scope,
    requestId: randomUUID(),
    message: "after delete",
  });
  await deletedRace.entered;
  await service.deleteThread(first.thread.id);
  deletedRace.release();
  await assert.rejects(staleAfterDelete, /상담 맥락이 변경/);
  assert.equal(fetches, 1);

  const second = await start();
  await store.pool.query(
    "UPDATE conversation_threads SET summary='OLD_SUMMARY_PRIVATE',summary_through=1,summary_sources=$2,summary_revision=summary_revision+1,revision=revision+1 WHERE id=$1",
    [second.thread.id, JSON.stringify([second.turn.id])],
  );
  const resetRace = pauseAfterSearch();
  const staleAfterReset = service.send({
    scope,
    requestId: randomUUID(),
    message: "after summary reset",
  });
  await resetRace.entered;
  const thread = await service.getThread(second.thread.id);
  await service.resetSummary(second.thread.id, thread.revision);
  resetRace.release();
  await assert.rejects(staleAfterReset, /상담 맥락이 변경/);
  assert.equal((await service.getThread(second.thread.id)).summary, null);
  assert.equal(fetches, 2);
});

test("duplicate request IDs fetch once and a changed connection cannot save a late answer", async (t) => {
  const store = new Store(
    `conversation-duplicate-version-${randomUUID()}`,
    undefined,
    "development-fixture",
    seed,
  );
  await store.init();
  t.after(async () => {
    await store.pool.query(
      "DELETE FROM conversation_threads WHERE workspace_id=$1",
      [store.key],
    );
    await store.pool.query(
      "DELETE FROM conversation_tombstones WHERE workspace_id=$1",
      [store.key],
    );
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  await store.mutate((w) => {
    w.people.push({
      id: "owner",
      name: "Owner",
      role: "admin",
      teamId: w.teamId,
    });
    w.agents = [
      {
        id: agentId,
        revision: 1,
        name: "Consultant",
        description: "",
        capability: "read-only",
        connectionId,
        connectionVersion: 1,
        markdown: "fixture",
        archived: false,
      },
    ];
  });
  let version = 1;
  const mutableVault = {
    get: () => ({
      info: {
        id: connectionId,
        name: "Fixture",
        version,
        endpoint: "https://fixture.invalid",
        auth: "api-key" as const,
        model: "fixture",
        hasKey: true,
        testStatus: "passed" as const,
        testedAt: new Date().toISOString(),
      },
      key: "fixture",
    }),
  };
  const releases: (() => void)[] = [];
  let calls = 0;
  const service = new ConversationService(store, mutableVault, async () => {
    calls++;
    await new Promise<void>((resolve) => releases.push(resolve));
    return new Response(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ answer: "late" }) }],
      }),
    );
  });
  const scope = {
    workspaceId: store.key,
    projectId: "commerce",
    agentDefinitionId: agentId,
    featureId: "feature-checkout",
  };
  const requestId = randomUUID();
  const callCount = () => calls;
  const [first, duplicate] = await Promise.all([
    service.send({ scope, requestId, message: "same request" }),
    service.send({ scope, requestId, message: "same request" }),
  ]);
  assert.equal(first.turn.id, duplicate.turn.id);
  for (let i = 0; i < 20 && callCount() !== 1; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(callCount(), 1);
  releases.shift()!();
  assert.equal((await settled(service, first.thread.id)).status, "completed");

  const late = await service.send({
    scope,
    requestId: randomUUID(),
    message: "connection changes while waiting",
  });
  for (let i = 0; i < 20 && callCount() !== 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(callCount(), 2);
  version = 2;
  releases.shift()!();
  const terminal = await settled(service, late.thread.id);
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.answer, null);
});
