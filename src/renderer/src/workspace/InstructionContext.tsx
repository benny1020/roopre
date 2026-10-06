import { resolveHarness, stageNames } from "../../../shared/harness";
import type { Feature, Snapshot } from "../../../shared/contracts";
export default function InstructionContext({
  snapshot,
  feature,
}: {
  snapshot: Snapshot;
  feature: Feature;
}) {
  const project = snapshot.projects.find((p) => p.id === feature.projectId)!;
  let harness: ReturnType<typeof resolveHarness>;
  try {
    harness = resolveHarness(snapshot, project, feature.harnessScope);
  } catch (e) {
    return (
      <div className="execution-gate">
        Configure the workflow to compose instructions: {(e as Error).message}
      </div>
    );
  }
  if (!harness) return null;
  return (
    <section className="instruction-context">
      <h3>Stage instruction preview</h3>
      <p className="muted">
        Company, project, feature path, stage and agent instructions follow the
        same rules as execution. Starting a run pins the current instructions.
      </p>
      {harness.agents.map((a) => (
        <details key={a.id}>
          <summary>
            {stageNames[a.stage]} · {a.agent.name} v{a.agent.revision} ·{" "}
            {a.required ? "Required" : "Optional"}
          </summary>
          <pre className="output-text">{a.instructions}</pre>
        </details>
      ))}
    </section>
  );
}
