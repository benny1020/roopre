import { z } from "zod";
import { stages } from "./harness-stages.ts";
import { stageExecutionSchema } from "./stage-execution.ts";
import { checkSchema } from "./runtime.ts";
const key = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const text = z.string().max(20000);
const directory = z
  .string()
  .max(300)
  .refine(
    (s) =>
      s.endsWith("/") &&
      !s.startsWith("/") &&
      !/[\\:*?\u0000-\u001f]/.test(s) &&
      s
        .slice(0, -1)
        .split("/")
        .every(
          (x) =>
            x.length > 0 &&
            x !== "." &&
            x !== ".." &&
            x.toLowerCase() !== ".git",
        ),
    "저장소 기준 상대 디렉토리와 끝의 /를 사용하세요.",
  );
export const packageAgentSchema = z
  .object({
    id: key,
    name: z.string().trim().min(1).max(80),
    description: z.string().max(300),
    capability: z.enum(["read-only", "implementation"]),
    instructions: text.min(1),
    connection: key.default("project"),
  })
  .strict();
const assignment = z
  .object({
    id: key,
    agentId: key,
    stage: z.enum(stages),
    required: z.boolean(),
  })
  .strict();
export const scopeSchema = z
  .object({
    id: key,
    name: z.string().min(1).max(80),
    paths: z.array(directory).min(1).max(30),
    instructions: text,
  })
  .strict();
export const packageProfileSchema = z
  .object({
    execution: stageExecutionSchema.optional(),
    id: key,
    name: z.string().min(1).max(80),
    instructions: text,
    stageInstructions: z
      .object({
        requirements: text,
        design: text,
        implementation: text,
        verification: text,
        review: text,
      })
      .strict(),
    assignments: z.array(assignment).min(2).max(30),
    checks: z
      .array(checkSchema.strict())
      .max(20)
      .refine(
        (a) => a.length === 0 || a.length >= 2,
        "검사 명령은 0개 또는 2개 이상이어야 합니다.",
      ),
    requiredChecks: z
      .array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/))
      .min(1)
      .max(20),
    scopes: z.array(scopeSchema).max(30),
    limits: z
      .object({
        budgetUsd: z.number().positive().max(1000),
        timeoutMinutes: z.number().int().min(1).max(240),
        repairLimit: z.number().int().min(0).max(3),
      })
      .strict()
      .optional(),
  })
  .strict();
export const harnessPackageSchema = z
  .object({
    schema: z.literal("roopre.harness/v1"),
    id: z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
      .max(80),
    name: z.string().min(1).max(80),
    instructions: text,
    agents: z.array(packageAgentSchema).min(2).max(100),
    profiles: z.array(packageProfileSchema).min(1).max(30),
  })
  .strict()
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    if (
      !unique(p.agents.map((a) => a.id)) ||
      !unique(p.profiles.map((x) => x.id))
    )
      fail("ID가 중복됐습니다.");
    for (const f of p.profiles) {
      if (
        !unique(f.assignments.map((a) => a.id)) ||
        !unique(f.scopes.map((s) => s.id)) ||
        !unique(f.checks.map((c) => c.name))
      )
        fail("프로필 안의 ID가 중복됐습니다.");
      for (const stage of ["implementation", "review"])
        if (!f.assignments.some((a) => a.stage === stage && a.required))
          fail("필수 구현자·리뷰어가 필요합니다.");
      for (const a of f.assignments) {
        const agent = p.agents.find((d) => d.id === a.agentId);
        if (!agent) fail(`없는 에이전트: ${a.agentId}`);
        else if (
          (a.stage === "implementation") !==
          (agent.capability === "implementation")
        )
          fail(`단계/권한 불일치: ${agent.id}`);
      }
      if (
        f.checks.length &&
        f.requiredChecks.some(
          (name) => name !== "review" && !f.checks.some((c) => c.name === name),
        )
      )
        fail("필수 검사 명령이 누락됐습니다.");
    }
  });
export type HarnessPackage = z.infer<typeof harnessPackageSchema>;
export type PackageProfile = HarnessPackage["profiles"][number];
export type PackageScope = z.infer<typeof scopeSchema>;
export type PackageSource = {
  kind: "folder" | "git" | "editor";
  commit?: string;
  url?: string;
};
export type HarnessInstallation = {
  package: HarnessPackage;
  profileId: string;
  digest: string;
  source: PackageSource;
  agents: Record<string, string>;
  assignments: Record<string, string>;
  bindings: Record<string, { id: string; version: number }>;
  revision: number;
  appliedAt: string;
};
export type PackageCandidate = {
  token: string;
  package: HarnessPackage;
  digest: string;
  source: PackageSource;
};
export const packageSourceSchema = z
  .object({
    kind: z.enum(["folder", "git", "editor"]),
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    url: z.string().max(2000).optional(),
  })
  .strict();
export const bindingSchema = z.record(
  key,
  z
    .object({ id: z.string().uuid(), version: z.number().int().positive() })
    .strict(),
);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function profileOf(h: HarnessInstallation) {
  return h.package.profiles.find((p) => p.id === h.profileId)!;
}
export function packageInstructions(h?: HarnessInstallation, scopeId?: string) {
  if (!h) return "";
  const profile = profileOf(h);
  const scope = profile.scopes.find((s) => s.id === scopeId);
  return `# 공유 표준 ${h.package.id}@${h.package.version}\n${h.package.instructions}${scope ? `\n\n# 기능 범위 ${scope.name}\n대상 디렉토리: ${scope.paths.join(", ")}\n${scope.instructions}` : ""}`;
}
export const packageManifestSchema = z
  .object({
    schema: z.literal("roopre.harness/files-v1"),
    definition: z.unknown(),
  })
  .strict();
// Portable folder format: JSON config plus plain Markdown, no executable imports.
export function packageFiles(input: HarnessPackage) {
  const p = harnessPackageSchema.parse(input);
  const files: Record<string, string> = {};
  files["policies/company.md"] = p.instructions;
  const agents = p.agents.map(({ instructions, ...a }) => {
    const path = `agents/${a.id}.md`;
    files[path] = instructions;
    return { ...a, instructions: { file: path } };
  });
  const profiles = p.profiles.map((f) => {
    const path = `projects/${f.id}/instructions.md`;
    files[path] = f.instructions;
    const stageInstructions = Object.fromEntries(
      stages.map((stage) => {
        const path = `projects/${f.id}/steps/${stage}.md`;
        files[path] = f.stageInstructions[stage];
        return [stage, { file: path }];
      }),
    );
    const scopes = f.scopes.map((s) => {
      const path = `projects/${f.id}/features/${s.id}/instructions.md`;
      files[path] = s.instructions;
      return { ...s, instructions: { file: path } };
    });
    return { ...f, instructions: { file: path }, stageInstructions, scopes };
  });
  files["harness.json"] =
    JSON.stringify(
      {
        schema: "roopre.harness/files-v1",
        definition: {
          ...p,
          instructions: { file: "policies/company.md" },
          agents,
          profiles,
        },
      },
      null,
      2,
    ) + "\n";
  return files;
}
export async function readPackageFiles(
  read: (path: string) => Promise<string>,
) {
  const manifest = packageManifestSchema.parse(
    JSON.parse(await read("harness.json")),
  );
  // Derive the exact allowed file layout from IDs. References cannot point elsewhere.
  const raw = manifest.definition as any;
  const get = async (ref: unknown, path: string) => {
    const r = z
      .object({ file: z.literal(path) })
      .strict()
      .parse(ref);
    return read(r.file);
  };
  const agentsRaw = z
    .array(z.object({ id: key }).passthrough())
    .min(2)
    .max(100)
    .parse(raw?.agents);
  const profilesRaw = z
    .array(z.object({ id: key }).passthrough())
    .min(1)
    .max(30)
    .parse(raw?.profiles);
  const agents = [];
  for (const a of agentsRaw)
    agents.push({
      ...a,
      instructions: await get(a.instructions, `agents/${a.id}.md`),
    });
  const profiles = [];
  for (const p of profilesRaw) {
    const refs = z
      .object({
        requirements: z.unknown(),
        design: z.unknown(),
        implementation: z.unknown(),
        verification: z.unknown(),
        review: z.unknown(),
      })
      .strict()
      .parse(p.stageInstructions);
    const stageInstructions: Record<string, string> = {};
    for (const stage of stages)
      stageInstructions[stage] = await get(
        refs[stage],
        `projects/${p.id}/steps/${stage}.md`,
      );
    const scopes = [];
    for (const s of z
      .array(z.object({ id: key }).passthrough())
      .max(30)
      .parse(p.scopes))
      scopes.push({
        ...s,
        instructions: await get(
          s.instructions,
          `projects/${p.id}/features/${s.id}/instructions.md`,
        ),
      });
    profiles.push({
      ...p,
      instructions: await get(
        p.instructions,
        `projects/${p.id}/instructions.md`,
      ),
      stageInstructions,
      scopes,
    });
  }
  return harnessPackageSchema.parse({
    ...raw,
    instructions: await get(raw.instructions, "policies/company.md"),
    agents,
    profiles,
  });
}

export function projectPackageChanges(p: import("./contracts.ts").Project) {
  if (!p.harness) return [];
  const f = profileOf(p.harness);
  const changes: string[] = [];
  if ((p.instructions ?? "") !== f.instructions)
    changes.push("프로젝트 지침 보완");
  if (
    f.checks.length &&
    canonical(p.executionProfile?.checks ?? []) !== canonical(f.checks)
  )
    changes.push("검사 명령 변경");
  if (!f.checks.length && p.executionProfile?.checks.length)
    changes.push("로컬 검사 명령 연결");
  if (p.requiredChecks.some((name) => !f.requiredChecks.includes(name)))
    changes.push("추가 필수 검사");
  return changes;
}

export function packageLimitIssues(
  p: import("./contracts.ts").Project,
  execution: import("./runtime.ts").ExecutionProfile,
) {
  const limits = p.harness && profileOf(p.harness).limits;
  if (!limits) return [];
  return execution.budgetUsd > limits.budgetUsd ||
    execution.timeoutMinutes > limits.timeoutMinutes ||
    execution.repairLimit > limits.repairLimit
    ? ["공유 표준의 예산·시간·수정 횟수 상한을 넘었습니다."]
    : [];
}
