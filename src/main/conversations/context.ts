import type {
  ContextManifest,
  ConversationTurn,
} from "../../shared/conversations.ts";

export type ContextBuild = {
  required: string;
  question: string;
  summary?: { text: string; sourceTurnIds: string[] };
  recent: ConversationTurn[];
  search: ConversationTurn[];
  memories: {
    id: string;
    revision: number;
    hash: string;
    title: string;
    body: string;
  }[];
  manifest: Omit<
    ContextManifest,
    "recentTurnIds" | "searchTurnIds" | "memories" | "excluded"
  > & {
    recentTurnIds: { id: string; ordinal: number }[];
    searchTurnIds: { id: string; ordinal: number }[];
    memories: { id: string; revision: number; hash: string }[];
    excluded: string[];
  };
};
const size = (text: string) => Buffer.byteLength(text);
export function buildConversationContext(
  input: Omit<ContextBuild, "recent" | "search" | "memories" | "manifest"> & {
    recentCandidates: ConversationTurn[];
    searchCandidates: ConversationTurn[];
    memoryCandidates: ContextBuild["memories"];
    manifestBase: Omit<
      ContextManifest,
      "recentTurnIds" | "searchTurnIds" | "memories" | "excluded"
    >;
    limit?: number;
  },
): ContextBuild {
  const limit = input.limit ?? 64 * 1024;
  let used = size(input.required) + size(input.question);
  if (used > limit)
    throw Error(
      "필수 상담 맥락이 입력 한도를 넘었습니다. 범위를 줄이거나 기억을 정리하세요.",
    );
  const excluded: string[] = [];
  let summary = input.summary;
  if (summary) {
    if (used + size(summary.text) > limit) {
      // A prior summary is useful context, never a reason to discard the
      // current question or reject an otherwise valid consultation.
      summary = undefined;
      excluded.push("summary");
    } else used += size(summary.text);
  }
  let recentChars = 0;
  let memoryChars = 0;
  const takeTurns = (candidates: ConversationTurn[], cap: number) => {
    const chosen: ConversationTurn[] = [];
    for (const turn of candidates.slice(-cap)) {
      const bytes = size(turn.input) + size(turn.answer || "");
      const chars = turn.input.length + (turn.answer?.length || 0);
      if (used + bytes > limit || recentChars + chars > 16_000) {
        excluded.push(`turn:${turn.id}`);
        continue;
      }
      used += bytes;
      recentChars += chars;
      chosen.push(turn);
    }
    return chosen;
  };
  const recent = takeTurns(input.recentCandidates, 12);
  const search = takeTurns(
    input.searchCandidates.filter((t) => !recent.some((r) => r.id === t.id)),
    4,
  );
  const memories: ContextBuild["memories"] = [];
  for (const memory of input.memoryCandidates.slice(0, 8)) {
    if (
      used + size(memory.title) + size(memory.body) > limit ||
      memoryChars + memory.body.length > 8_000
    ) {
      excluded.push(`memory:${memory.id}`);
      continue;
    }
    used += size(memory.title) + size(memory.body);
    memoryChars += memory.body.length;
    memories.push(memory);
  }
  return {
    required: input.required,
    question: input.question,
    summary,
    recent,
    search,
    memories,
    manifest: {
      ...input.manifestBase,
      previousSummary: summary ? input.manifestBase.previousSummary : undefined,
      memories: memories.map(({ id, revision, hash }) => ({
        id,
        revision,
        hash,
      })),
      recentTurnIds: recent.map(({ id, ordinal }) => ({ id, ordinal })),
      searchTurnIds: search.map(({ id, ordinal }) => ({ id, ordinal })),
      excluded,
    },
  };
}
