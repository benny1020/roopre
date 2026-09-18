import { z } from "zod";
import type { Workspace, Project } from "./contracts.ts";
export const stages = [
  "requirements",
  "design",
  "implementation",
  "verification",
  "review",
] as const;
export const stageNames: Record<(typeof stages)[number], string> = {
  requirements: "요구사항",
  design: "설계",
  implementation: "구현",
  verification: "검증",
  review: "리뷰",
};
export const agentSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300),
  projectId: z.string().min(1).max(100).optional(),
  capability: z.enum(["read-only", "implementation"]),
  connectionId: z.string().uuid().optional(),
  connectionVersion: z.number().int().positive().optional(),
  markdown: z.string().trim().min(1).max(20000),
  archived: z.boolean(),
});
export type AgentDefinition = z.infer<typeof agentSchema>;
export const assignmentSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  stage: z.enum(stages),
  required: z.boolean(),
});
export const workflowSchema = z.object({
  revision: z.number().int().positive(),
  assignments: z.array(assignmentSchema).min(2).max(30),
  instructions: z.object({
    requirements: z.string().max(10000),
    design: z.string().max(10000),
    implementation: z.string().max(10000),
    verification: z.string().max(10000),
    review: z.string().max(10000),
  }),
});
export type Workflow = z.infer<typeof workflowSchema>;
export type ResolvedAgent = z.infer<typeof assignmentSchema> & {
  agent: AgentDefinition;
  instructions: string;
  connectionId: string;
  connectionVersion: number;
};
export type ResolvedHarness = {
  version: 1;
  workflowRevision: number;
  agents: ResolvedAgent[];
};
export type AgentExecution = {
  id: string;
  assignmentId: string;
  name: string;
  stage: (typeof stages)[number];
  revision: number;
  connectionId: string;
  connectionVersion: number;
  model: string;
  required: boolean;
  status: "running" | "passed" | "failed";
  attempt: number;
  startedAt: string;
  endedAt?: string;
  inputTree: string;
  outputTree?: string;
  instructionHash: string;
  instructions: string;
  output?: string;
  error?: string;
};
export function latestAgents(w: Pick<Workspace, "agents">) {
  const map = new Map<string, AgentDefinition>();
  for (const a of w.agents ?? [])
    if (!map.has(a.id) || map.get(a.id)!.revision < a.revision)
      map.set(a.id, a);
  return [...map.values()];
}
export function workflowIssues(
  w: Workspace,
  p: Project,
  flow = p.workflow,
): string[] {
  if (!flow) return [];
  const problems: string[] = [];
  const definitions = latestAgents(w);
  if (
    new Set(flow.assignments.map((a) => a.id)).size !== flow.assignments.length
  )
    problems.push("배치 ID가 중복됐습니다.");
  for (const stage of ["implementation", "review"])
    if (!flow.assignments.some((a) => a.stage === stage && a.required))
      problems.push(
        "필수 구현 에이전트와 필수 리뷰 에이전트가 각각 필요합니다.",
      );
  for (const a of flow.assignments) {
    const d = definitions.find((d) => d.id === a.agentId);
    if (!d || d.archived || (d.projectId && d.projectId !== p.id)) {
      problems.push("사용할 수 없는 에이전트가 배치됐습니다.");
      continue;
    }
    if ((a.stage === "implementation") !== (d.capability === "implementation"))
      problems.push(`${d.name}: 단계와 코드 수정 권한이 맞지 않습니다.`);
  }
  return [...new Set(problems)];
}
export function resolveHarness(
  w: Workspace,
  p: Project,
): ResolvedHarness | undefined {
  if (!p.workflow) return undefined;
  const issues = workflowIssues(w, p);
  if (issues.length) throw Error(issues.join(" "));
  const policy = w.policies.at(-1)!;
  return {
    version: 1,
    workflowRevision: p.workflow.revision,
    agents: stages.flatMap((stage) =>
      p
        .workflow!.assignments.filter((a) => a.stage === stage)
        .map((a) => {
          const agent = latestAgents(w).find((d) => d.id === a.agentId)!;
          const connectionId =
            agent.connectionId ?? p.executionProfile?.connectionId ?? "";
          const connectionVersion = agent.connectionId
            ? (agent.connectionVersion ?? 0)
            : (p.executionProfile?.connectionVersion ?? 0);
          return {
            ...a,
            agent: structuredClone(agent),
            connectionId,
            connectionVersion,
            instructions: `# 전역 v${policy.version}\n${policy.global}\n\n# 프로젝트 ${p.name}\n${p.instructions ?? ""}\n\n# 단계 ${stageNames[stage]}\n${stage === "design" || stage === "requirements" ? policy.design : stage === "implementation" ? policy.implementation : policy.reviewer}\n${p.workflow!.instructions[stage]}\n\n# 에이전트 ${agent.name} v${agent.revision}\n${agent.markdown}`,
          };
        }),
    ),
  };
}
// Strict, deliberately small frontmatter dialect; no shell hooks or credentials.
export function importAgentMarkdown(text: string): {
  name?: string;
  description?: string;
  capability?: AgentDefinition["capability"];
  markdown: string;
} {
  if (text.length > 24000) throw Error("Markdown 파일이 너무 큽니다.");
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n"))
    return { markdown: z.string().trim().min(1).max(20000).parse(normalized) };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw Error("frontmatter 종료 구분자가 없습니다.");
  const fields: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^(schema|name|description|capability): (.*)$/.exec(line);
    if (!match || fields[match[1]] !== undefined)
      throw Error("지원하지 않는 frontmatter 또는 중복 키입니다.");
    const raw = match[2];
    const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
    if (typeof value !== "string")
      throw Error("frontmatter 값은 문자열이어야 합니다.");
    fields[match[1]] = value;
  }
  if (fields.schema !== "roopre-agent/v1")
    throw Error("지원하는 형식은 roopre-agent/v1입니다.");
  return {
    name: fields.name,
    description: fields.description,
    capability: fields.capability
      ? z.enum(["read-only", "implementation"]).parse(fields.capability)
      : undefined,
    markdown: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .parse(normalized.slice(end + 5)),
  };
}
export function exportAgentMarkdown(agent: AgentDefinition) {
  return `---\nschema: roopre-agent/v1\nname: ${JSON.stringify(agent.name)}\ndescription: ${JSON.stringify(agent.description)}\ncapability: ${agent.capability}\n---\n\n${agent.markdown}\n`;
}
