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
        지침을 구성하려면 개발 흐름을 확인하세요: {(e as Error).message}
      </div>
    );
  }
  if (!harness) return null;
  return (
    <section className="instruction-context">
      <h3>단계별 실행 지침 미리보기</h3>
      <p className="muted">
        회사·프로젝트·기능 경로·단계·에이전트 지침을 실제 실행과 같은 규칙으로
        조합합니다. 실행을 시작하면 해당 시점의 지침이 고정됩니다.
      </p>
      {harness.agents.map((a) => (
        <details key={a.id}>
          <summary>
            {stageNames[a.stage]} · {a.agent.name} v{a.agent.revision} ·{" "}
            {a.required ? "필수" : "선택"}
          </summary>
          <pre className="output-text">{a.instructions}</pre>
        </details>
      ))}
    </section>
  );
}
