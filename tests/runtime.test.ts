import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed, ownerFixture } from "./fixtures/workspace.ts";
import { apply } from "../src/domain/index.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { sections, gate, type Workspace } from "../src/shared/contracts.ts";
import {
  ConnectionVault,
  validateEndpoint,
  modelUrl,
} from "../src/main/connections/vault.ts";
import { sameToken, startBroker } from "../src/runner/broker.ts";
import { Store } from "../src/database/store.ts";
import { createApp } from "../src/server/app.ts";
import { RunnerManager } from "../src/runner/manager.ts";
const profile = {
  repositoryPath: "/repo",
  baseBranch: "main",
  baseCommit: "a".repeat(40),
  connectionId: randomUUID(),
  connectionVersion: 1,
  image: "roopre-runner:0.2",
  checks: [
    { name: "typecheck", argv: ["pnpm", "typecheck"], timeoutSeconds: 60 },
    { name: "test", argv: ["pnpm", "test"], timeoutSeconds: 60 },
  ],
  webRequired: false,
  budgetUsd: 2,
  timeoutMinutes: 10,
  repairLimit: 1,
};
function fixture() {
  const w = seed();
  w.mode = "local-owner";
  for (const p of w.projects) {
    p.ownerId = "jun";
    p.reviewerIds = ["jun"];
    p.executionProfile = structuredClone(profile);
  }
  const f = w.features[1];
  f.draft.requirements = "AC01 영수증을 다운로드한다.";
  apply(w, "jun", {
    type: "publish_design",
    featureId: f.id,
    expectedRevision: f.draft.revision,
  });
  return {
    w,
    f,
    review: {
      type: "review" as const,
      featureId: f.id,
      designId: f.designs.at(-1)!.id,
      decision: "approve" as const,
      checked: [...sections],
    },
  };
}
test("owner approval requires a native proof tied to current immutable contract", () => {
  const { w, f, review } = fixture();
  assert.throws(() => apply(w, "jun", review), /본인 확인/);
  assert.throws(() => apply(w, "agent", review), /에이전트/);
  assert.throws(
    () =>
      apply(w, "jun", review, {
        authentication: "macos-owner",
        binding: "forged",
      }),
    /본인 확인/,
  );
  apply(w, "jun", review, {
    authentication: "macos-owner",
    binding: approvalBinding(w, f),
  });
  assert.equal(gate(w, f).eligible, true);
  apply(w, "jun", {
    type: "queue_run",
    featureId: f.id,
    designId: review.designId,
  });
  assert.equal(w.runs[0].runtime!.profile.budgetUsd, 2);
  apply(w, "jun", { ...review, decision: "withdraw" });
  assert.equal(w.runs[0].status, "blocked");
});
test("profile mutation cannot reuse authenticated approval, or weaken required checks", () => {
  const { w, f, review } = fixture();
  const proof = {
    authentication: "macos-owner" as const,
    binding: approvalBinding(w, f),
  };
  apply(w, "jun", review, proof);
  assert.throws(
    () =>
      apply(w, "jun", {
        type: "configure_execution",
        projectId: f.projectId,
        profile: { ...profile, checks: [profile.checks[0]] },
      }),
    /필수 검사/,
  );
  apply(w, "jun", {
    type: "configure_execution",
    projectId: f.projectId,
    profile: { ...profile, budgetUsd: 3 },
  });
  assert.equal(gate(w, f).eligible, false);
  assert.throws(() => apply(w, "jun", review, proof), /본인 확인/);
  assert.throws(
    () =>
      apply(w, "jun", {
        type: "queue_run",
        featureId: f.id,
        designId: review.designId,
      }),
    /승인 계약/,
  );
});
test("project rule changes invalidate only that project; team rules invalidate all", () => {
  const { w, f, review } = fixture();
  apply(w, "jun", review, {
    authentication: "macos-owner",
    binding: approvalBinding(w, f),
  });
  apply(w, "jun", {
    type: "update_project_policy",
    projectId: "platform",
    instructions: "새 지침",
    requiredChecks: ["typecheck", "test", "review"],
    reviewerIds: ["jun"],
  });
  assert.equal(gate(w, f).eligible, true);
  const p = w.policies.at(-1)!;
  apply(w, "jun", {
    type: "publish_policy",
    expectedVersion: p.version,
    global: p.global + " 추가",
    design: p.design,
    implementation: p.implementation,
    reviewer: p.reviewer,
    requiredChecks: p.requiredChecks,
  });
  assert.equal(gate(w, f).eligible, false);
});
test("native owner cannot remove its required approval or publish without AC evidence contract", () => {
  const { w, f } = fixture();
  assert.throws(
    () =>
      apply(w, "jun", {
        type: "update_project_policy",
        projectId: f.projectId,
        reviewerIds: ["mina"],
        requiredChecks: ["typecheck", "test", "review"],
      }),
    /본인/,
  );
  f.draft.requirements = "그냥 잘 만든다";
  assert.throws(
    () =>
      apply(w, "jun", {
        type: "publish_design",
        featureId: f.id,
        expectedRevision: f.draft.revision,
      }),
    /AC01/,
  );
});

test("new team/project checks block old execution profiles at publish, approval and execution", () => {
  for (const scope of ["team", "project"]) {
    const { w, f, review } = fixture();
    const p = w.policies.at(-1)!;
    if (scope === "team")
      apply(w, "jun", {
        type: "publish_policy",
        expectedVersion: p.version,
        global: p.global,
        design: p.design,
        implementation: p.implementation,
        reviewer: p.reviewer,
        requiredChecks: [...p.requiredChecks, "security"],
      });
    else
      apply(w, "jun", {
        type: "update_project_policy",
        projectId: f.projectId,
        reviewerIds: ["jun"],
        requiredChecks: [
          ...w.projects.find((p) => p.id === f.projectId)!.requiredChecks,
          "security",
        ],
      });
    assert.equal(gate(w, f).eligible, false);
    assert.match(gate(w, f).reasons.join(" "), /security/);
    assert.throws(
      () =>
        apply(w, "jun", {
          type: "publish_design",
          featureId: f.id,
          expectedRevision: f.draft.revision,
        }),
      /security/,
    );
    assert.throws(
      () =>
        apply(w, "jun", review, {
          authentication: "macos-owner",
          binding: approvalBinding(w, f),
        }),
      /security/,
    );
    assert.throws(() =>
      apply(w, "jun", {
        type: "queue_run",
        featureId: f.id,
        designId: review.designId,
      }),
    );
    apply(w, "jun", {
      type: "configure_execution",
      projectId: f.projectId,
      profile: {
        ...profile,
        checks: [
          ...profile.checks,
          { name: "security", argv: ["pnpm", "security"], timeoutSeconds: 60 },
        ],
      },
    });
    apply(w, "jun", {
      type: "publish_design",
      featureId: f.id,
      expectedRevision: f.draft.revision,
    });
    apply(
      w,
      "jun",
      { ...review, designId: f.designs.at(-1)!.id },
      { authentication: "macos-owner", binding: approvalBinding(w, f) },
    );
    apply(w, "jun", {
      type: "queue_run",
      featureId: f.id,
      designId: f.designs.at(-1)!.id,
    });
    assert(
      w.runs.at(-1)!.runtime!.profile.checks.some((c) => c.name === "security"),
    );
  }
});
test("endpoint rejects plaintext, userinfo and secret-bearing query; protocol path normalization", () => {
  for (const url of [
    "http://example.com",
    "https://key@example.com",
    "https://example.com?key=secret",
    "https://example.com#key",
  ])
    assert.throws(() => validateEndpoint(url));
  assert.equal(
    modelUrl("https://example.com/v1/"),
    "https://example.com/v1/messages",
  );
  assert.equal(
    modelUrl("https://example.com/gateway"),
    "https://example.com/gateway/v1/messages",
  );
});
test("vault persistence stores ciphertext, metadata does not expose secrets, replacement and deletion survive restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roopre-vault-test-"));
  try {
    const path = join(dir, "vault.json");
    const cipher = {
      encrypt: (s: string) => Buffer.from([...s].reverse().join("")),
      decrypt: (b: Buffer) => [...b.toString()].reverse().join(""),
    };
    const v = new ConnectionVault(path, cipher);
    await v.init();
    const list = await v.save({
      name: "Test",
      endpoint: "https://api.example.com",
      auth: "api-key",
      model: "model",
      key: "test-secret-unique",
    });
    assert.equal(JSON.stringify(list).includes("test-secret"), false);
    assert.equal((await readFile(path, "utf8")).includes("test-secret"), false);
    const id = list[0].id;
    await v.save({ ...list[0], key: "replacement-secret" });
    const reopened = new ConnectionVault(path, cipher);
    await reopened.init();
    assert.equal(reopened.get(id).key, "replacement-secret");
    assert.equal(reopened.list()[0].version, 2);
    await reopened.remove(id);
    assert.throws(() => reopened.get(id));
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("broker rejects bad tokens, arbitrary paths and model overrides before any upstream request", async () => {
  const abort = new AbortController();
  const broker = await startBroker(
    {
      id: randomUUID(),
      name: "test",
      endpoint: "https://invalid.example",
      auth: "api-key",
      model: "approved-model",
      version: 1,
      hasKey: true,
    },
    "never-leak-this-key",
    "run-token",
    abort.signal,
  );
  try {
    const url = `http://127.0.0.1:${broker.port}`;
    assert.equal(sameToken("run-token", "run-token"), true);
    assert.equal(sameToken("wrong", "run-token"), false);
    assert.equal(
      (await fetch(url + "/v1/messages", { method: "POST", body: "{}" }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(url + "/admin", {
          method: "POST",
          headers: { "x-api-key": "run-token" },
          body: "{}",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(url + "/v1/messages", {
          method: "POST",
          headers: { "x-api-key": "run-token" },
          body: JSON.stringify({ model: "unapproved" }),
        })
      ).status,
      403,
    );
  } finally {
    broker.close();
  }
});
test("owner PostgreSQL storage does not expose an HTTP approval bypass", async () => {
  const s = new Store(
    `test-owner-${randomUUID()}`,
    undefined,
    "local-owner",
    ownerFixture,
  );
  await s.init();
  const app = await createApp(s);
  try {
    const state = await s.read("owner");
    assert.equal(state.mode, "local-owner");
    assert.deepEqual(
      state.people.map((x) => x.id),
      ["owner"],
    );
    assert.equal(state.features.length, 0);
    await assert.rejects(s.read("jun"));
    const p = state.projects[0];
    await s.execute("owner", randomUUID(), {
      type: "configure_execution",
      projectId: p.id,
      profile,
    });
    const created = await s.execute("owner", randomUUID(), {
      type: "create_feature",
      projectId: p.id,
      title: "Owner test",
      template: "feature",
      requirements: "AC01 tested",
    });
    const f = (await s.read("owner")).features[0];
    const body = sections.map((x) => `## ${x}\nConcrete ${x}`).join("\n\n");
    await s.execute("owner", randomUUID(), {
      type: "save_draft",
      featureId: f.id,
      expectedRevision: 0,
      requirements: "AC01 tested",
      body,
    });
    await s.execute("owner", randomUUID(), {
      type: "publish_design",
      featureId: f.id,
      expectedRevision: 1,
    });
    const d = (await s.read("owner")).features[0].designs[0];
    const response = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-devflow-actor": "owner" },
      payload: {
        requestId: randomUUID(),
        command: {
          type: "review",
          featureId: f.id,
          designId: d.id,
          decision: "approve",
          checked: sections,
          binding: "forged",
          authentication: "macos-owner",
        },
      },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(
      (await s.read("owner")).features[0].designs[0].decisions.length,
      0,
    );
  } finally {
    await app.close();
    await s.pool.query("DELETE FROM commands WHERE workspace_id=$1", [s.key]);
    await s.pool.query("DELETE FROM events WHERE workspace_id=$1", [s.key]);
    await s.pool.query("DELETE FROM workspaces WHERE id=$1", [s.key]);
    await s.close();
  }
});

test("broker forwards stream and host credential while redacting gateway failures", async () => {
  let calls = 0;
  const upstream: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://gateway.example/proxy/v1/messages");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-host-secret");
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(init?.redirect, "error");
    if (calls === 2)
      return new Response("fixture-host-secret detailed upstream error", {
        status: 429,
      });
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode("event: message_start\ndata: {}\n\n"),
          );
          controller.enqueue(
            encoder.encode("event: message_stop\ndata: {}\n\n"),
          );
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const broker = await startBroker(
    {
      id: randomUUID(),
      name: "fixture",
      endpoint: "https://gateway.example/proxy",
      auth: "bearer",
      model: "approved",
      version: 1,
      hasKey: true,
    },
    "fixture-host-secret",
    "scoped-token",
    new AbortController().signal,
    upstream,
  );
  try {
    const send = () =>
      fetch(`http://127.0.0.1:${broker.port}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": "scoped-token" },
        body: JSON.stringify({ model: "approved", stream: true }),
      });
    const response = await send();
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.match(await response.text(), /message_start[\s\S]*message_stop/);
    const failure = await send();
    assert.equal(failure.status, 429);
    assert.equal((await failure.text()).includes("fixture-host-secret"), false);
  } finally {
    broker.close();
  }
});

test("an unconfirmed prior container occupies the project slot even after failure", async () => {
  const { w, f, review } = fixture();
  apply(w, "jun", review, {
    authentication: "macos-owner",
    binding: approvalBinding(w, f),
  });
  apply(w, "jun", {
    type: "queue_run",
    featureId: f.id,
    designId: review.designId,
  });
  const queued = w.runs[0];
  const other = structuredClone(f);
  other.id = "another-feature";
  w.features.push(other);
  const old = structuredClone(queued);
  old.id = "run-aaaaaaaa-aaaa";
  old.featureId = other.id;
  old.status = "blocked";
  old.runtime!.terminationConfirmed = false;
  w.runs.push(old);
  const store = {
    mutate: async (fn: (w: Workspace) => void) => fn(w),
  } as unknown as Store;
  const runner = new RunnerManager(
    store,
    {} as ConnectionVault,
    "/unused",
    "/unused",
  );
  await runner.execute(queued.id, new AbortController());
  assert.equal(queued.status, "queued");
  assert.equal(queued.runtime?.lease, undefined);
});

test("scheduler skips an occupied project's queue so another project can use the free slot", async () => {
  const { w, f, review } = fixture();
  apply(w, "jun", review, {
    authentication: "macos-owner",
    binding: approvalBinding(w, f),
  });
  apply(w, "jun", {
    type: "queue_run",
    featureId: f.id,
    designId: review.designId,
  });
  const queued = w.runs[0];
  const blocked = structuredClone(queued);
  blocked.id = "run-aaaaaaaa-bbbb";
  blocked.status = "blocked";
  blocked.runtime!.terminationConfirmed = false;
  w.runs.push(blocked);
  const otherFeature = structuredClone(f);
  otherFeature.id = "other-project-feature";
  otherFeature.projectId = "other-project";
  w.features.push(otherFeature);
  const otherRun = structuredClone(queued);
  otherRun.id = "run-cccccccc-dddd";
  otherRun.featureId = otherFeature.id;
  w.runs.push(otherRun);
  const store = {
    read: async () => w,
    mutate: async (fn: (w: Workspace) => void) => fn(w),
  } as unknown as Store;
  const runner = new RunnerManager(
    store,
    {} as ConnectionVault,
    "/unused",
    "/unused",
  );
  runner.cleanup = async () => {
    throw Error("Prior container remains unavailable");
  };
  const selected: string[] = [];
  runner.execute = async (id) => {
    selected.push(id);
  };
  await (runner as unknown as { tick: () => Promise<void> }).tick();
  assert.deepEqual(selected, [otherRun.id]);
  await runner.stop();
});

test("a new product workspace has no sample projects or reviewers and reopening preserves user data", async () => {
  const store = new Store(
    `test-empty-${randomUUID()}`,
    undefined,
    "local-owner",
  );
  try {
    await store.init();
    const fresh = await store.read("owner");
    assert.deepEqual(fresh.projects, []);
    assert.deepEqual(fresh.features, []);
    assert.deepEqual(fresh.runs, []);
    assert.deepEqual(
      fresh.people.map((p) => p.id),
      ["owner"],
    );
    const project = await store.execute("owner", randomUUID(), {
      type: "create_project",
      name: "실제 사용자 프로젝트",
      description: "사용자가 직접 생성",
      reviewerIds: ["owner"],
    });
    const before = await store.read("owner");
    await store.init();
    const after = await store.read("owner");
    assert.deepEqual(after, before);
    assert.equal(after.projects[0].id, project.entityId);
  } finally {
    for (const table of ["commands", "events"])
      await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        store.key,
      ]);
    await store.pool.query("DELETE FROM workspaces WHERE id=$1", [store.key]);
    await store.close();
  }
});

function scheduledFixture() {
  const { w, f, review } = fixture();
  apply(w, "jun", review, {
    authentication: "macos-owner",
    binding: approvalBinding(w, f),
  });
  apply(w, "jun", {
    type: "queue_run",
    featureId: f.id,
    designId: review.designId,
  });
  return { w, run: w.runs[0] };
}

test("shutdown fences a scheduler read already in flight", async () => {
  const { w } = scheduledFixture();
  let release!: (value: Workspace) => void;
  const read = new Promise<Workspace>((resolve) => {
    release = resolve;
  });
  const store = { read: () => read } as unknown as Store;
  const runner = new RunnerManager(
    store,
    {} as ConnectionVault,
    "/unused",
    "/unused",
  );
  const started: string[] = [];
  runner.execute = async (id) => {
    started.push(id);
  };
  const tick = (runner as unknown as { tick: () => Promise<void> }).tick();
  const stopping = runner.stop();
  release(w);
  await Promise.all([tick, stopping]);
  assert.deepEqual(started, [], "No execution may begin after shutdown starts");
});

test("a recovered database reconciles abandoned execution without restarting the app", async () => {
  const { w, run } = scheduledFixture();
  run.status = "implementing";
  run.runtime!.terminationConfirmed = false;
  run.runtime!.worktree = "/preserved-checkout";
  let offline = true;
  const store = {
    read: async () => {
      if (offline) throw Error("DB unavailable");
      return w;
    },
    mutate: async (fn: (w: Workspace) => void) => fn(w),
  } as unknown as Store;
  const runner = new RunnerManager(
    store,
    {} as ConnectionVault,
    "/unused",
    "/unused",
  );
  const cleaned: string[] = [];
  runner.cleanup = async (id) => {
    cleaned.push(id);
  };
  const tick = () =>
    (runner as unknown as { tick: () => Promise<void> }).tick();
  await tick();
  assert.equal(run.status, "implementing");
  offline = false;
  await tick();
  assert.deepEqual(cleaned, [run.id]);
  assert.equal(run.status, "interrupted");
  assert.equal(run.runtime!.terminationConfirmed, true);
  assert.equal(run.runtime!.worktree, "/preserved-checkout");
  await runner.stop();
});

test("startup keeps cancellation and evidence while unavailable Docker does not hide the workspace", async () => {
  const { w, run } = scheduledFixture();
  run.status = "cancelled";
  run.reason = "사용자가 취소했습니다.";
  run.runtime!.terminationConfirmed = false;
  const root = await mkdtemp(join(tmpdir(), "roopre-recovery-unit-"));
  const store = {
    read: async () => w,
    mutate: async (fn: (w: Workspace) => void) => fn(w),
  } as unknown as Store;
  const runner = new RunnerManager(
    store,
    {} as ConnectionVault,
    root,
    "/unused",
  );
  runner.cleanup = async () => {
    throw Error("Docker unavailable");
  };
  try {
    await runner.init();
    assert.equal(run.status, "cancelled");
    assert.equal(run.runtime!.terminationConfirmed, false);
    await runner.stop();
    const recovered = new RunnerManager(
      store,
      {} as ConnectionVault,
      root,
      "/unused",
    );
    recovered.cleanup = async () => {};
    try {
      await recovered.init();
      assert.equal(run.status, "cancelled");
      assert.equal(run.runtime!.terminationConfirmed, true);
      assert.equal(run.reason, "사용자가 취소했습니다.");
    } finally {
      await recovered.stop();
    }
  } finally {
    await runner.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup failure preserves cancellation and releases its slot only after confirmed cleanup", async () => {
  const { w, run } = scheduledFixture();
  const store = {
    read: async () => w,
    mutate: async (fn: (w: Workspace) => void) => fn(w),
  } as unknown as Store;
  const vault = {
    get: () => ({ info: { version: 1, testStatus: "passed" } }),
  } as unknown as ConnectionVault;
  const runner = new RunnerManager(store, vault, "/unused", "/unused");
  runner.cleanup = async () => {
    run.status = "cancelled";
    run.reason = "사용자가 취소했습니다.";
    throw Error("Docker unavailable");
  };
  await runner.execute(run.id, new AbortController());
  assert.equal(run.status, "cancelled");
  assert.equal(run.runtime!.terminationConfirmed, false);
  runner.cleanup = async () => {};
  await (runner as unknown as { tick: () => Promise<void> }).tick();
  assert.equal(run.status, "cancelled");
  assert.equal(run.reason, "사용자가 취소했습니다.");
  assert.equal(run.runtime!.terminationConfirmed, true);
  await runner.stop();
});
