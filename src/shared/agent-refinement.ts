import { z } from "zod";
import { stages } from "./harness-stages.ts";
export const refinementInputSchema = z.object({
  connectionId: z.string().uuid(),
  stage: z.enum(stages),
  brief: z.string().trim().min(3).max(6000),
});
export const refinementOutputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(300),
    markdown: z.string().trim().min(1).max(20000),
  })
  .strict();
export type RefinementInput = z.infer<typeof refinementInputSchema>;
export type RefinementOutput = z.infer<typeof refinementOutputSchema>;
