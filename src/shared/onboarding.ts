import { z } from "zod";
export const onboardingSteps = [
  "connection",
  "environment",
  "project",
  "harness",
  "requirements",
] as const;
export const onboardingSchema = z.object({
  version: z.literal(1),
  step: z.enum(onboardingSteps),
  dismissed: z.boolean(),
  draft: z
    .object({
      connectionId: z.string().max(100).optional(),
      connectionName: z.string().max(80),
      model: z.string().max(120),
      auth: z.enum(["api-key", "bearer"]),
      projectId: z.string().max(100),
      name: z.string().max(80),
      path: z.string().max(2000),
      branch: z.string().max(150),
      budget: z.string().max(20),
      checks: z.string().max(20000),
      projectInstructions: z.string().max(20000),
      title: z.string().max(160),
      requirements: z.string().max(60000),
    })
    .optional(),
});
export type OnboardingProgress = z.infer<typeof onboardingSchema>;
export type BootstrapStatus = {
  connected: boolean;
  busy: boolean;
  stage: string;
  error: string;
  managed: boolean;
  progress: OnboardingProgress;
};
