import { z } from "zod";

const id = z.string().trim().min(1).max(100);
export const conversationScopeSchema = z.object({
  workspaceId: id,
  projectId: id,
  agentDefinitionId: id,
  featureId: id.optional(),
});
export type ConversationScope = z.infer<typeof conversationScopeSchema>;
export const turnStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export type TurnStatus = z.infer<typeof turnStatusSchema>;
export const contextManifestSchema = z.object({
  assignmentId: z.string().uuid().optional(),
  execution: z
    .object({
      runId: z.string(),
      attempt: z.number().int().positive(),
      executionId: z.string().optional(),
    })
    .optional(),
  agentRevision: z.number().int().positive(),
  harnessHash: z.string().max(128).optional(),
  memories: z
    .array(
      z.object({
        id: z.string(),
        revision: z.number().int().positive(),
        hash: z.string().min(16).max(128),
      }),
    )
    .max(8),
  recentTurnIds: z
    .array(
      z.object({ id: z.string().uuid(), ordinal: z.number().int().positive() }),
    )
    .max(12),
  searchTurnIds: z
    .array(
      z.object({ id: z.string().uuid(), ordinal: z.number().int().positive() }),
    )
    .max(4),
  excluded: z.array(z.string()).max(20),
  connectionId: z.string().uuid().optional(),
  connectionVersion: z.number().int().positive().optional(),
  model: z.string().max(120).optional(),
  previousSummary: z
    .object({
      revision: z.number().int().nonnegative(),
      through: z.number().int().nonnegative().nullable(),
      sourceTurnIds: z.array(z.string().uuid()).max(12),
    })
    .optional(),
  summaryChunkTurnIds: z.array(z.string().uuid()).max(12).optional(),
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;
export const conversationThreadSchema = z.object({
  id: z.string().uuid(),
  scope: conversationScopeSchema,
  revision: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  archived: z.boolean(),
  summary: z.string().nullable(),
  summaryThrough: z.number().int().nullable(),
  summarySourceTurnIds: z.array(z.string().uuid()),
  summaryRevision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationThread = z.infer<typeof conversationThreadSchema>;
export const conversationTurnSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  ordinal: z.number().int().positive(),
  requestId: z.string().uuid(),
  input: z.string(),
  answer: z.string().nullable(),
  status: turnStatusSchema,
  retryOf: z.string().uuid().nullable(),
  error: z.string().nullable(),
  warning: z.string().nullable().optional(),
  contextManifest: contextManifestSchema,
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export const sendTurnSchema = z.object({
  scope: conversationScopeSchema,
  requestId: z.string().uuid(),
  message: z.string().trim().min(1).max(8000),
  assignmentId: z.string().uuid().optional(),
  execution: z
    .object({
      runId: z.string(),
      attempt: z.number().int().positive(),
      executionId: z.string().optional(),
    })
    .optional(),
  retryOf: z.string().uuid().optional(),
});
export type SendTurnInput = z.infer<typeof sendTurnSchema>;
export const listTurnsSchema = z.object({
  threadId: z.string().uuid(),
  beforeOrdinal: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(30).default(30),
});
export const resetSummarySchema = z.object({
  threadId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export const cancelTurnSchema = z.object({
  threadId: z.string().uuid(),
  turnId: z.string().uuid(),
});
export const deleteThreadSchema = z.object({
  threadId: z.string().uuid(),
  deactivateDerivedMemoryIds: z.array(z.string()).max(20).optional(),
});
