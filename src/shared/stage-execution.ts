import { z } from "zod";
import { stages } from "./harness-stages.ts";

export const stageExecutionSchema = z.partialRecord(
  z.enum(stages),
  z.enum(["parallel", "sequential"]),
);
export type StageExecution = z.infer<typeof stageExecutionSchema>;
export const stageConcurrency = 3;
export function stageExecution(execution?: StageExecution) {
  return Object.fromEntries(
    stages.map((stage) => [stage, execution?.[stage] ?? "parallel"]),
  ) as Required<StageExecution>;
}
