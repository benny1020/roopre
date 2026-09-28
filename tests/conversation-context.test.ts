import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildConversationContext } from "../src/main/conversations/context.ts";
import type { ConversationTurn } from "../src/shared/conversations.ts";

const turn = (
  ordinal: number,
  status: ConversationTurn["status"] = "completed",
) =>
  ({
    id: randomUUID(),
    threadId: randomUUID(),
    ordinal,
    requestId: randomUUID(),
    input: `결정 ${ordinal}`,
    answer: status === "completed" ? `답 ${ordinal}` : null,
    status,
    retryOf: null,
    error: null,
    contextManifest: {
      agentRevision: 1,
      memories: [],
      recentTurnIds: [],
      searchTurnIds: [],
      excluded: [],
    },
    usage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) satisfies ConversationTurn;
test("context keeps current question and records only the exact bounded source IDs", () => {
  const turns = Array.from({ length: 30 }, (_, i) => turn(i + 1));
  const result = buildConversationContext({
    required: "harness",
    question: "현재 질문",
    summary: { text: "기존 요약", sourceTurnIds: [turns[0].id] },
    recentCandidates: turns,
    searchCandidates: [turns[1]],
    memoryCandidates: [],
    manifestBase: { agentRevision: 1 },
  });
  assert.equal(result.question, "현재 질문");
  assert.equal(result.recent.length, 12);
  assert.deepEqual(
    result.manifest.recentTurnIds,
    result.recent.map(({ id, ordinal }) => ({ id, ordinal })),
  );
  assert.equal(result.summary?.text, "기존 요약");
  assert.deepEqual(result.summary?.sourceTurnIds, [turns[0].id]);
});

test("context trims optional records before it sacrifices mandatory question", () => {
  const result = buildConversationContext({
    required: "H".repeat(100),
    question: "current",
    recentCandidates: [turn(1)],
    searchCandidates: [],
    memoryCandidates: Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`,
      revision: 1,
      hash: "a".repeat(64),
      title: "memory",
      body: "m".repeat(4000),
    })),
    manifestBase: { agentRevision: 1 },
    limit: 9000,
  });
  assert.equal(result.question, "current");
  assert(
    result.memories.reduce((n, memory) => n + memory.body.length, 0) <= 8000,
  );
  assert(result.manifest.excluded.some((entry) => entry.startsWith("memory:")));
});

test("context drops an oversized prior summary while preserving mandatory context", () => {
  const sourceId = randomUUID();
  const result = buildConversationContext({
    required: "H".repeat(80),
    question: "current question",
    summary: { text: "S".repeat(200), sourceTurnIds: [sourceId] },
    recentCandidates: [],
    searchCandidates: [],
    memoryCandidates: [],
    manifestBase: {
      agentRevision: 1,
      previousSummary: {
        revision: 3,
        through: 12,
        sourceTurnIds: [sourceId],
      },
    },
    limit: 128,
  });
  assert.equal(result.question, "current question");
  assert.equal(result.summary, undefined);
  assert.equal(result.manifest.previousSummary, undefined);
  assert(result.manifest.excluded.includes("summary"));
});
