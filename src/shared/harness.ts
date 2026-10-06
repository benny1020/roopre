import { packageInstructions } from "./harness-package.ts";
import { z } from "zod";
import type { Workspace, Project } from "./contracts.ts";
import { canonicalSourceRef, type ResolvedMemory } from "./memory.ts";
import { stages } from "./harness-stages.ts";
import {
  stageExecutionSchema,
  stageExecution,
  type StageExecution,
} from "./stage-execution.ts";
export { stages } from "./harness-stages.ts";
export const stageNames: Record<(typeof stages)[number], string> = {
  requirements: "Requirements",
  design: "Design",
  implementation: "Implementation",
  verification: "Verification",
  review: "Review",
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
  execution: stageExecutionSchema.optional(),
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
  memory?: ResolvedMemory[];
};
export type ResolvedHarness = {
  version: 1;
  workflowRevision: number;
  execution?: StageExecution;
  agents: ResolvedAgent[];
};
/**
 * The immutable instruction block used for one assigned agent. Consultation
 * uses the same block, without resolving the whole workflow (which could be
 * invalid for an unrelated assignment).
 */
export function agentInstructionContext(
  w: Workspace,
  p: Project,
  agent: AgentDefinition,
  assignment?: z.infer<typeof assignmentSchema>,
  scopeId?: string,
) {
  const policy = w.policies.at(-1);
  const base = `${packageInstructions(p.harness, scopeId)}\n\n# Global v${policy?.version ?? 0}\n${policy?.global ?? ""}\n\n# Project ${p.name}\n${p.instructions ?? ""}`;
  if (!assignment)
    return `${base}\n\n# Agent ${agent.name} v${agent.revision}\n${agent.markdown}`;
  const rolePolicy =
    assignment.stage === "design" || assignment.stage === "requirements"
      ? policy?.design
      : assignment.stage === "implementation"
        ? policy?.implementation
        : policy?.reviewer;
  return `${base}\n\n# Stage ${stageNames[assignment.stage]}\n${rolePolicy ?? ""}\n${p.workflow?.instructions[assignment.stage] ?? ""}\n\n# Agent ${agent.name} v${agent.revision}\n${agent.markdown}`;
}
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
  worktree?: string;
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
    problems.push("Duplicate assignment IDs.");
  for (const stage of ["implementation", "review"])
    if (!flow.assignments.some((a) => a.stage === stage && a.required))
      problems.push(
        "A required implementation agent and a required review agent are both needed.",
      );
  for (const a of flow.assignments) {
    const d = definitions.find((d) => d.id === a.agentId);
    if (!d || d.archived || (d.projectId && d.projectId !== p.id)) {
      problems.push("An assigned agent is unavailable.");
      continue;
    }
    if ((a.stage === "implementation") !== (d.capability === "implementation"))
      problems.push(`${d.name}: stage does not match write permissions.`);
  }
  return [...new Set(problems)];
}
export function resolveHarness(
  w: Workspace,
  p: Project,
  scopeId?: string,
  featureId?: string,
): ResolvedHarness | undefined {
  if (!p.workflow) return undefined;
  const issues = workflowIssues(w, p);
  if (issues.length) throw Error(issues.join(" "));
  return {
    version: 1,
    workflowRevision: p.workflow.revision,
    execution: stageExecution(p.workflow.execution),
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
          const memory: ResolvedMemory[] = (p.memories ?? [])
            .filter(
              (memory) =>
                memory.active &&
                memory.agentDefinitionId === agent.id &&
                (!memory.featureId || memory.featureId === featureId),
            )
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((memory) => {
              const frozen = {
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
              };
              return frozen;
            });
          return {
            ...a,
            agent: structuredClone(agent),
            connectionId,
            connectionVersion,
            memory,
            instructions: agentInstructionContext(w, p, agent, a, scopeId),
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
  if (text.length > 24000) throw Error("Markdown file is too large.");
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n"))
    return { markdown: z.string().trim().min(1).max(20000).parse(normalized) };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw Error("Missing frontmatter closing delimiter.");
  const fields: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^(schema|name|description|capability): (.*)$/.exec(line);
    if (!match || fields[match[1]] !== undefined)
      throw Error("Unsupported frontmatter or duplicate key.");
    const raw = match[2];
    const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
    if (typeof value !== "string")
      throw Error("Frontmatter values must be strings.");
    fields[match[1]] = value;
  }
  if (fields.schema !== "roopre-agent/v1")
    throw Error("Supported format is roopre-agent/v1.");
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
