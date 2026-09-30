import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Plus,
  Radar,
} from "lucide-react";
import type { Feature, Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
import { runNames, workState, type WorkState } from "./workspace/presentation";

type Destination = "design" | "execution";

const actorName: Record<WorkState["actor"], string> = {
  HUMAN: "내가 할 일",
  AGENT: "에이전트 작업",
  SYSTEM: "시스템 확인",
};

const macroStage = (phase: number) => (phase <= 1 ? 0 : phase === 2 ? 1 : 2);

function FlowRail({ state }: { state: WorkState }) {
  const current = macroStage(state.phase);
  const steps = [
    ["계획", "요구사항·설계"],
    ["개발", "구현·수정"],
    ["검토", "검증·결과"],
  ];
  return (
    <div className="flow-rail" aria-label={`현재 ${steps[current][0]} 단계`}>
      {steps.map(([title, detail], index) => (
        <div
          key={title}
          className={`flow-step ${index < current ? "complete" : ""} ${index === current ? `current ${state.tone}` : ""}`}
          aria-current={index === current ? "step" : undefined}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function WorkRow({
  snapshot,
  feature,
  onOpen,
}: {
  snapshot: Snapshot;
  feature: Feature;
  onOpen: (featureId: string, destination: Destination) => void;
}) {
  const state = workState(snapshot, feature);
  const project = snapshot.projects.find(
    (item) => item.id === feature.projectId,
  );
  return (
    <button
      className="home-work-row"
      onClick={() =>
        onOpen(feature.id, state.phase >= 2 ? "execution" : "design")
      }
    >
      <span className={`home-state-mark ${state.tone}`} aria-hidden="true" />
      <span className="home-work-copy">
        <strong>{feature.title}</strong>
        <small>{project?.name}</small>
      </span>
      <span className={`home-state-label ${state.tone}`}>{state.label}</span>
      <span className="home-next-action">
        <small>{actorName[state.actor]}</small>
        <span>{state.next}</span>
      </span>
      <ArrowUpRight size={15} aria-hidden="true" />
    </button>
  );
}

export default function WorkspaceHome({
  snapshot,
  connected,
  onOpen,
  onProject,
  onPortfolio,
  onRuns,
  onCreate,
}: {
  snapshot: Snapshot;
  connected: boolean;
  onOpen: (featureId: string, destination: Destination) => void;
  onProject: (projectId: string) => void;
  onPortfolio: () => void;
  onRuns: () => void;
  onCreate: () => void;
}) {
  const work = snapshot.features.map((feature) => ({
    feature,
    state: workState(snapshot, feature),
  }));
  const attention = work
    .filter(({ state }) => state.attention)
    .sort((a, b) => {
      const severity = (tone: WorkState["tone"]) =>
        tone === "danger" ? 2 : tone === "attention" ? 1 : 0;
      return severity(b.state.tone) - severity(a.state.tone);
    });
  const activeRuns = snapshot.runs.filter((run) =>
    activeStatuses.includes(run.status),
  );
  const activeFeatureIds = new Set(activeRuns.map((run) => run.featureId));
  const activeWork = work.filter(({ feature }) =>
    activeFeatureIds.has(feature.id),
  );

  return (
    <div className="workspace-home">
      <header className="home-heading">
        <div>
          <span className="eyebrow">오늘</span>
          <h1>개발 흐름</h1>
          <p>
            {snapshot.projects.length}개 프로젝트 · 내 결정 {attention.length}개
            · 에이전트 작업 {activeRuns.length}개
          </p>
        </div>
        <button className="primary" disabled={!connected} onClick={onCreate}>
          <Plus size={16} />새 기능
        </button>
      </header>

      <div className="home-focus-grid">
        <section className="home-section" aria-labelledby="home-decisions">
          <header>
            <div>
              <span className="section-icon attention">
                <CircleAlert size={15} />
              </span>
              <div>
                <h2 id="home-decisions">지금 볼 것</h2>
                <p>결정하거나 복구해야 다음 단계로 갑니다.</p>
              </div>
            </div>
            <span className="section-count">{attention.length}</span>
          </header>
          <div className="home-section-body">
            {attention.slice(0, 5).map(({ feature }) => (
              <WorkRow
                key={feature.id}
                snapshot={snapshot}
                feature={feature}
                onOpen={onOpen}
              />
            ))}
            {!attention.length && (
              <div className="home-clear-state">
                <CheckCircle2 size={18} />
                <span>
                  <strong>지금 막힌 작업이 없습니다.</strong>
                  <small>에이전트 작업과 프로젝트 흐름을 확인하세요.</small>
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-agents">
          <header>
            <div>
              <span className="section-icon active">
                <Bot size={15} />
              </span>
              <div>
                <h2 id="home-agents">에이전트 작업</h2>
                <p>현재 실행 중인 작업만 보여 줍니다.</p>
              </div>
            </div>
            <button className="text-action" onClick={onRuns}>
              전체 실행 <ArrowRight size={14} />
            </button>
          </header>
          <div className="home-section-body">
            {activeWork.slice(0, 5).map(({ feature, state }) => {
              const run = activeRuns
                .filter((item) => item.featureId === feature.id)
                .at(-1);
              const agent = run?.runtime?.agents?.find(
                (item) =>
                  item.status === "running" &&
                  item.attempt === run.runtime?.attempt,
              );
              return (
                <button
                  className="agent-activity-row"
                  key={feature.id}
                  onClick={() => onOpen(feature.id, "execution")}
                >
                  <span className="agent-pulse" aria-hidden="true" />
                  <span>
                    <strong>{agent?.name || state.label}</strong>
                    <small>{feature.title}</small>
                  </span>
                  <span>
                    {run ? runNames[run.status] || run.status : state.label}
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              );
            })}
            {!activeWork.length && (
              <div className="home-clear-state quiet">
                <Activity size={18} />
                <span>
                  <strong>실행 중인 에이전트가 없습니다.</strong>
                  <small>승인된 작업에서 개발을 시작할 수 있습니다.</small>
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="home-project-flow" aria-labelledby="home-projects">
        <header>
          <div>
            <span className="section-icon">
              <Radar size={15} />
            </span>
            <div>
              <h2 id="home-projects">프로젝트 흐름</h2>
              <p>계획부터 검토까지 모든 기능의 위치를 한 줄로 봅니다.</p>
            </div>
          </div>
          <button className="text-action" onClick={onPortfolio}>
            전체 관제 <ArrowRight size={14} />
          </button>
        </header>
        <div className="project-flow-list">
          {snapshot.projects.map((project) => {
            const features = snapshot.features.filter(
              (feature) => feature.projectId === project.id,
            );
            return (
              <section
                className="home-project"
                key={project.id}
                aria-labelledby={`home-project-${project.id}`}
              >
                <button
                  className="home-project-name"
                  onClick={() => onProject(project.id)}
                >
                  <span
                    className="project-dot"
                    style={{ background: project.color }}
                  />
                  <span>
                    <strong id={`home-project-${project.id}`}>
                      {project.name}
                    </strong>
                    <small>{features.length}개 작업</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
                <div className="home-project-features">
                  {features.map((feature) => {
                    const state = workState(snapshot, feature);
                    return (
                      <button
                        className="project-flow-row"
                        key={feature.id}
                        onClick={() =>
                          onOpen(
                            feature.id,
                            state.phase >= 2 ? "execution" : "design",
                          )
                        }
                      >
                        <span className="project-feature-title">
                          <strong>{feature.title}</strong>
                          <small>{state.label}</small>
                        </span>
                        <FlowRail state={state} />
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </button>
                    );
                  })}
                  {!features.length && (
                    <p className="project-empty">
                      아직 등록된 기능이 없습니다.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export { FlowRail };
