import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/database/store.ts";
import { ownerFixture } from "./fixtures/workspace.ts";
import type { Command } from "../src/shared/contracts.ts";
import * as conversations from "../src/database/conversations.ts";

test("Store validates memory sources and persists mutation guards", async () => {
  const store = new Store(
    `memory-store-${randomUUID()}`,
    undefined,
    "local-owner",
    ownerFixture,
  );
  const agent = randomUUID();
  const otherAgent = randomUUID();
  const send = (command: Command) =>
    store.execute("owner", randomUUID(), command);
  const memory = async (
    id: string,
    body: string,
    refs: any[],
    featureId?: string,
    revision = 1,
    promoteToProject = false,
  ) => {
    const w = await store.read("owner");
    return send({
      type: "save_memory",
      expectedRevision: w.revision,
      projectId: "first-project",
      promoteToProject,
      memory: {
        id,
        agentDefinitionId: agent,
        featureId,
        title: id,
        body,
        revision,
        sourceRefs: refs,
        active: true,
      },
    });
  };
  try {
    await store.init();
    await send({
      type: "save_agent",
      expectedRevision: 0,
      agent: {
        id: agent,
        revision: 1,
        name: "memory agent",
        description: "fixture",
        capability: "implementation",
        markdown: "fixture",
        archived: false,
      },
    });
    await send({
      type: "save_agent",
      expectedRevision: 0,
      agent: {
        id: otherAgent,
        revision: 1,
        name: "other agent",
        description: "fixture",
        capability: "read-only",
        markdown: "fixture",
        archived: false,
      },
    });
    const featureId = (
      await send({
        type: "create_feature",
        projectId: "first-project",
        title: "memory feature",
        template: "feature",
        requirements: "AC01",
      })
    ).entityId!;
    const otherFeatureId = (
      await send({
        type: "create_feature",
        projectId: "first-project",
        title: "other feature",
        template: "feature",
        requirements: "AC01",
      })
    ).entityId!;
    const otherProjectId = (
      await send({
        type: "create_project",
        name: "Other",
        description: "fixture",
        reviewerIds: ["owner"],
      })
    ).entityId!;
    await store.mutate((w) => {
      const other = w.projects.find((p) => p.id === otherProjectId)!;
      const feature = {
        id: "other-approved",
        projectId: other.id,
        title: "other",
        template: "feature" as const,
        authorId: "owner",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        draft: { revision: 1, body: "", requirements: "AC01" },
        designs: [
          {
            id: "other-design",
            number: 1,
            body: "",
            requirements: "AC01",
            hash: "fixture",
            at: new Date().toISOString(),
            policyVersion: 1,
            reviewers: ["owner"],
            decisions: [
              {
                actorId: "owner",
                decision: "approve" as const,
                checked: [],
                at: new Date().toISOString(),
              },
            ],
          },
        ],
        threads: [],
        dependencies: [],
      };
      w.features.push(feature);
    });
    const manifest = {
      agentRevision: 1,
      memories: [],
      recentTurnIds: [],
      searchTurnIds: [],
      excluded: [],
    };
    const scope = {
      workspaceId: store.key,
      projectId: "first-project",
      agentDefinitionId: agent,
      featureId,
    };
    const pending = await conversations.createPending(
      store.pool,
      scope,
      randomUUID(),
      "fixture source",
      randomUUID(),
      1,
      manifest,
    );
    await conversations.finishPending(
      store.pool,
      pending,
      "answer",
      undefined,
      null,
    );
    await memory("manual", "manual source", [
      { type: "manual", label: "owner" },
    ]);
    await memory(
      "conversation",
      "conversation source",
      [
        {
          type: "conversation",
          threadId: pending.thread.id,
          turnId: pending.turn.id,
        },
      ],
      featureId,
    );
    const w = await store.read("owner");
    await assert.rejects(
      send({
        type: "save_memory",
        expectedRevision: w.revision,
        projectId: "first-project",
        promoteToProject: false,
        memory: {
          id: "wrong-agent",
          agentDefinitionId: otherAgent,
          featureId,
          title: "wrong agent",
          body: "bad",
          revision: 1,
          sourceRefs: [
            {
              type: "conversation",
              threadId: pending.thread.id,
              turnId: pending.turn.id,
            },
          ],
          active: true,
        },
      }),
      /대화 출처/,
    );
    await assert.rejects(
      memory("no-promote", "bad", [
        {
          type: "conversation",
          threadId: pending.thread.id,
          turnId: pending.turn.id,
        },
      ]),
      /대화 출처/,
    );
    await memory(
      "promoted",
      "project promotion",
      [
        {
          type: "conversation",
          threadId: pending.thread.id,
          turnId: pending.turn.id,
        },
      ],
      undefined,
      1,
      true,
    );
    await store.deleteConversation(pending.thread.id);
    await memory(
      "conversation",
      "retained after source deletion",
      [
        {
          type: "conversation",
          threadId: pending.thread.id,
          turnId: pending.turn.id,
        },
      ],
      featureId,
      2,
    );
    await store.mutate((w) => {
      w.runs.push({
        id: "run-source",
        featureId,
        designId: "fixture",
        status: "failed",
        reason: "fixture",
        policyVersion: 1,
        effectivePolicy: "",
        at: new Date().toISOString(),
        actorId: "owner",
        runtime: {
          profile: {} as any,
          harness: {
            version: 1,
            workflowRevision: 1,
            agents: [
              {
                id: "assignment",
                agentId: agent,
                stage: "implementation",
                required: true,
                connectionId: "",
                connectionVersion: 0,
                instructions: "",
                agent: {
                  id: agent,
                  revision: 1,
                  name: "memory agent",
                  description: "",
                  capability: "implementation",
                  markdown: "",
                  archived: false,
                },
              },
            ],
          },
          agents: [
            {
              id: "execution",
              assignmentId: "assignment",
              name: "memory agent",
              stage: "implementation",
              revision: 1,
              connectionId: "",
              connectionVersion: 0,
              model: "",
              required: true,
              status: "passed",
              attempt: 1,
              startedAt: new Date().toISOString(),
              inputTree: "",
              instructionHash: "fixture",
              instructions: "",
            },
          ],
          binding: "",
          attempt: 1,
          costUsd: 0,
          costEstimated: true,
          events: [],
          evidence: [],
          terminationConfirmed: true,
        },
      });
    });
    await memory(
      "run",
      "run source",
      [{ type: "run", runId: "run-source", executionId: "execution" }],
      featureId,
    );
    await assert.rejects(
      memory("run-no-promote", "bad", [{ type: "run", runId: "run-source" }]),
      /실행 출처/,
    );
    await memory(
      "run-promoted",
      "project run promotion",
      [{ type: "run", runId: "run-source" }],
      undefined,
      1,
      true,
    );
    await assert.rejects(
      memory(
        "wrong-feature",
        "bad",
        [{ type: "run", runId: "run-source" }],
        otherFeatureId,
      ),
      /실행 출처/,
    );
    const beforeOther = (await store.read("owner")).features.find(
      (f) => f.id === "other-approved",
    )!.designs[0].decisions;
    const first = (await store.read("owner")).projects[0].memories![0];
    await assert.rejects(
      memory(
        first.id,
        "stale",
        [{ type: "manual", label: "owner" }],
        undefined,
        1,
      ),
      /최신/,
    );
    await memory(
      first.id,
      "revised",
      [{ type: "manual", label: "owner" }],
      undefined,
      2,
    );
    const after = await store.read("owner");
    assert.deepEqual(
      after.features.find((f) => f.id === "other-approved")!.designs[0]
        .decisions,
      beforeOther,
    );
    const revised = after.projects[0].memories!.find(
      (item) => item.id === first.id,
    )!;
    await send({
      type: "deactivate_memory",
      expectedRevision: after.revision,
      projectId: "first-project",
      memoryId: revised.id,
    });
    assert.equal(
      (await store.read("owner")).projects[0].memories!.find(
        (item) => item.id === revised.id,
      )!.active,
      false,
    );
    const activeBeforeLimit = (
      await store.read("owner")
    ).projects[0].memories!.filter((item) => item.active).length;
    for (let i = 0; i < 20 - activeBeforeLimit; i++)
      await memory(`limit-${i}`, "x", [
        { type: "manual", label: `limit-${i}` },
      ]);
    await assert.rejects(
      memory("over-limit", "x", [{ type: "manual", label: "over" }]),
      /20개/,
    );
    await store.mutate((w) => {
      w.runs.push({
        id: "active-run",
        featureId,
        designId: "fixture",
        status: "queued",
        reason: "fixture",
        policyVersion: 1,
        effectivePolicy: "",
        at: new Date().toISOString(),
        actorId: "owner",
      });
    });
    await assert.rejects(
      memory("active-guard", "x", [{ type: "manual", label: "active" }]),
      /먼저 종료/,
    );
  } finally {
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
  }
});

test("Store.deleteConversation atomically deactivates selected derived memory", async () => {
  const store = new Store(
    `memory-delete-${randomUUID()}`,
    undefined,
    "local-owner",
    ownerFixture,
  );
  const agent = randomUUID();
  try {
    await store.init();
    await store.execute("owner", randomUUID(), {
      type: "save_agent",
      expectedRevision: 0,
      agent: {
        id: agent,
        revision: 1,
        name: "agent",
        description: "",
        capability: "read-only",
        markdown: "fixture",
        archived: false,
      },
    });
    const featureId = (
      await store.execute("owner", randomUUID(), {
        type: "create_feature",
        projectId: "first-project",
        title: "feature",
        template: "feature",
        requirements: "AC01",
      })
    ).entityId!;
    const otherProjectId = (
      await store.execute("owner", randomUUID(), {
        type: "create_project",
        name: "other",
        description: "",
        reviewerIds: ["owner"],
      })
    ).entityId!;
    const manifest = {
      agentRevision: 1,
      memories: [],
      recentTurnIds: [],
      searchTurnIds: [],
      excluded: [],
    };
    const pending = await conversations.createPending(
      store.pool,
      {
        workspaceId: store.key,
        projectId: "first-project",
        agentDefinitionId: agent,
        featureId,
      },
      randomUUID(),
      "source",
      randomUUID(),
      1,
      manifest,
    );
    await conversations.finishPending(
      store.pool,
      pending,
      "answer",
      undefined,
      null,
    );
    let w = await store.read("owner");
    await store.execute("owner", randomUUID(), {
      type: "save_memory",
      expectedRevision: w.revision,
      projectId: "first-project",
      promoteToProject: false,
      memory: {
        id: "derived",
        agentDefinitionId: agent,
        featureId,
        title: "derived",
        body: "keep",
        revision: 1,
        sourceRefs: [
          {
            type: "conversation",
            threadId: pending.thread.id,
            turnId: pending.turn.id,
          },
        ],
        active: true,
      },
    });
    await store.mutate((state) => {
      const decision = {
        actorId: "owner",
        decision: "approve" as const,
        checked: [],
        at: new Date().toISOString(),
      };
      const f = state.features.find((item) => item.id === featureId)!;
      f.designs.push({
        id: "design",
        number: 1,
        body: "",
        requirements: "",
        hash: "",
        at: new Date().toISOString(),
        policyVersion: 1,
        reviewers: ["owner"],
        decisions: [decision],
      });
      state.features.push({
        ...structuredClone(f),
        id: "unrelated",
        projectId: otherProjectId,
        designs: [
          { ...f.designs[0], id: "other-design", decisions: [decision] },
        ],
      });
      state.runs.push({
        id: "active",
        featureId,
        designId: "design",
        status: "queued",
        reason: "",
        policyVersion: 1,
        effectivePolicy: "",
        at: new Date().toISOString(),
        actorId: "owner",
      });
    });
    const before = await store.read("owner");
    await assert.rejects(
      store.deleteConversation(pending.thread.id, ["derived"]),
      /먼저 종료/,
    );
    assert.deepEqual(await store.read("owner"), before);
    await store.mutate((state) => {
      state.runs = [];
    });
    await store.deleteConversation(pending.thread.id, ["derived"]);
    const after = await store.read("owner");
    assert.equal(
      await conversations.getConversationThread(store.pool, pending.thread.id),
      undefined,
    );
    const derived = after.projects[0].memories!.find(
      (item) => item.id === "derived",
    )!;
    assert.equal(derived.active, false);
    assert.equal(derived.revision, 2);
    assert.equal(
      after.features.find((item) => item.id === featureId)!.designs[0].decisions
        .length,
      0,
    );
    assert.equal(
      after.features.find((item) => item.id === "unrelated")!.designs[0]
        .decisions.length,
      1,
    );
  } finally {
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
  }
});
