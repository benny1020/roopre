import { z } from "zod";

const memoryId = z.string().min(1).max(100);
export const memorySourceRefSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("conversation"),
      threadId: memoryId,
      turnId: memoryId,
    })
    .strict(),
  z
    .object({
      type: z.literal("run"),
      runId: memoryId,
      executionId: memoryId.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("manual"),
      label: z.string().trim().min(1).max(240),
    })
    .strict(),
]);
export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;
export function canonicalSourceRef(ref: MemorySourceRef) {
  switch (ref.type) {
    case "conversation":
      return `conversation:${ref.threadId}:${ref.turnId}`;
    case "run":
      return `run:${ref.runId}:${ref.executionId ?? ""}`;
    case "manual":
      return `manual:${ref.label}`;
  }
}
export const workMemorySchema = z
  .object({
    id: memoryId,
    agentDefinitionId: z.string().min(1).max(100),
    featureId: z.string().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(2000),
    revision: z.number().int().positive(),
    sourceRefs: z.array(memorySourceRefSchema).min(1).max(100),
    active: z.boolean(),
    authorId: z.string().min(1).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkMemory = z.infer<typeof workMemorySchema>;

export type FrozenMemory = Pick<
  WorkMemory,
  | "id"
  | "agentDefinitionId"
  | "featureId"
  | "title"
  | "body"
  | "revision"
  | "sourceRefs"
> & { hash: string };
export type ResolvedMemory = Omit<FrozenMemory, "hash">;

export function canonicalActiveMemories(memories: WorkMemory[] | undefined) {
  return [...(memories ?? [])]
    .filter((memory) => memory.active)
    .map((memory) => ({
      id: memory.id,
      agentDefinitionId: memory.agentDefinitionId,
      featureId: memory.featureId,
      title: memory.title,
      body: memory.body,
      revision: memory.revision,
      sourceRefs: [...memory.sourceRefs].sort((a, b) =>
        canonicalSourceRef(a) < canonicalSourceRef(b)
          ? -1
          : canonicalSourceRef(a) > canonicalSourceRef(b)
            ? 1
            : 0,
      ),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
