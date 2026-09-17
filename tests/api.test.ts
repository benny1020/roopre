import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { createApp } from "../src/server/app.ts";
import { sections, type Command } from "../src/shared/contracts.ts";

test("PostgreSQL API: authorization, atomic competing edits, idempotency, approvals and reconnect events", async (t) => {
  const store = new Store(`test-${randomUUID()}`);
  await store.init();
  const app = await createApp(store);
  t.after(async () => {
    await app.close();
    await store.pool.query("DELETE FROM commands WHERE workspace_id=$1", [
      store.key,
    ]);
    await store.pool.query("DELETE FROM events WHERE workspace_id=$1", [
      store.key,
    ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  });
  const command = (actor: string, c: Command, requestId = randomUUID()) =>
    app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-devflow-actor": actor },
      payload: { requestId, command: c },
    });
  await t.test(
    "T01: reads are shared by two human identities, forbidden outside team",
    async () => {
      const a = await app.inject({
        url: "/state",
        headers: { "x-devflow-actor": "jun" },
      });
      const b = await app.inject({
        url: "/state",
        headers: { "x-devflow-actor": "mina" },
      });
      assert.equal(a.statusCode, 200);
      assert.deepEqual(a.json(), b.json());
      assert.equal(
        (
          await app.inject({
            url: "/state",
            headers: { "x-devflow-actor": "outside" },
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test("T06: exactly one simultaneous stale save commits", async () => {
    const base = {
      type: "save_draft" as const,
      featureId: "feature-audit",
      expectedRevision: 1,
      requirements: "검증 가능한 목표",
    };
    const results = await Promise.all([
      command("jun", { ...base, body: "A" }),
      command("jun", { ...base, body: "B" }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  });
  await t.test(
    "T10: same request returns original result and does not create duplicate event",
    async () => {
      const c: Command = {
        type: "create_feature",
        projectId: "portal",
        title: "멱등성 검증",
        template: "bug",
        requirements: "한 번만 생성",
      };
      const key = randomUUID();
      const before = (await store.read("jun")).sequence;
      const responses = await Promise.all([
        command("jun", c, key),
        command("jun", c, key),
      ]);
      assert.equal(responses[0].statusCode, 200);
      assert.deepEqual(responses[0].json(), responses[1].json());
      assert.equal((await store.events("jun", before)).length, 1);
      assert.equal(
        (await command("jun", { ...c, title: "다른 내용" }, key)).statusCode,
        409,
      );
    },
  );
  await t.test(
    "T02/T03/T04/T05: server gate rejects bypasses and invalidates previously queued execution",
    async () => {
      const f = (await store.read("jun")).features[1];
      const designId = f.designs[0].id;
      const queue: Command = { type: "queue_run", featureId: f.id, designId };
      assert.equal((await command("jun", queue)).statusCode, 409);
      const review: Command = {
        type: "review",
        featureId: f.id,
        designId,
        decision: "approve",
        checked: [...sections],
      };
      assert.equal((await command("agent", review)).statusCode, 403);
      assert.equal((await command("jun", review)).statusCode, 403);
      assert.equal((await command("mina", review)).statusCode, 200);
      assert.equal((await command("jun", queue)).statusCode, 409);
      assert.equal((await command("sora", review)).statusCode, 200);
      assert.equal((await command("jun", queue)).statusCode, 200);
      assert.equal(
        (await command("mina", { ...review, decision: "withdraw" })).statusCode,
        200,
      );
      assert.equal((await store.read("jun")).runs[0].status, "blocked");
    },
  );
  await t.test(
    "T10: live SSE and replay preserve committed events across two sessions",
    async () => {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      assert(address && typeof address !== "string");
      const before = (await store.read("mina")).sequence;
      const abort = new AbortController();
      const response = await fetch(
        `http://127.0.0.1:${address.port}/events?actor=mina&after=${before}`,
        { signal: abort.signal },
      );
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      const created = await command("jun", {
        type: "create_feature",
        projectId: "portal",
        title: "실시간 이벤트",
        template: "feature",
        requirements: "다른 세션에 즉시 보인다",
      });
      assert.equal(created.statusCode, 200);
      let stream = "";
      const deadline = setTimeout(() => abort.abort(), 4000);
      try {
        while (!stream.includes("create_feature")) {
          const next = await reader.read();
          if (next.done) break;
          stream += new TextDecoder().decode(next.value);
        }
        assert.match(stream, /create_feature/);
      } finally {
        clearTimeout(deadline);
        abort.abort();
      }
      const replay = await store.events("sora", before);
      assert.equal(replay.length, 1);
      assert.equal(replay[0].sequence, created.json().sequence);
    },
  );
  await t.test(
    "T10 storage recovery: recreating a store preserves existing state and revision",
    async () => {
      const before = await store.read("jun");
      const second = new Store(store.key);
      await second.init();
      const after = await second.read("mina");
      await second.close();
      assert.deepEqual(before, after);
    },
  );
});
