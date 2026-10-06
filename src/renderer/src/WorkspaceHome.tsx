import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Plus,
  Radar,
  ShieldCheck,
} from "lucide-react";
import type { Feature, Snapshot } from "../../shared/contracts";
import { activeStatuses } from "../../shared/runtime";
import {
  runNames,
  workState,
  countLabel,
  type WorkState,
} from "./workspace/presentation";

type Destination = "design" | "execution";

const actorName: Record<WorkState["actor"], string> = {
  HUMAN: "Your action",
  AGENT: "Agent activity",
  SYSTEM: "System checks",
};

const macroStage = (phase: number) => (phase <= 1 ? 0 : phase === 2 ? 1 : 2);

function FlowRail({ state }: { state: WorkState }) {
  const current = macroStage(state.phase);
  const steps = [
    ["Plan", "Requirements & design"],
    ["Build", "Implementation & fixes"],
    ["Review", "Checks & results"],
  ];
  return (
    <div
      className="flow-rail"
      aria-label={`Current ${steps[current][0]} Stage`}
    >
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
  onAttention,
  onQuality,
  onRuns,
  onCreate,
}: {
  snapshot: Snapshot;
  connected: boolean;
  onOpen: (featureId: string, destination: Destination) => void;
  onProject: (projectId: string) => void;
  onPortfolio: () => void;
  onAttention: () => void;
  onQuality: () => void;
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
          <span className="eyebrow">Today</span>
          <h1>Development workspace</h1>
          <p>
            {countLabel(snapshot.projects.length, "project")} ·{" "}
            {attention.length} need attention ·{" "}
            {countLabel(activeRuns.length, "active run")}
          </p>
        </div>
        <button className="primary" disabled={!connected} onClick={onCreate}>
          <Plus size={16} />
          New feature
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
                <h2 id="home-decisions">Needs your attention</h2>
                <p>Resolve a decision or blocker to move work forward.</p>
              </div>
            </div>
            <button
              className="text-action"
              onClick={onAttention}
              disabled={!attention.length}
            >
              View all <span className="section-count">{attention.length}</span>
              <ArrowRight size={14} />
            </button>
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
                  <strong>Nothing is blocked right now.</strong>
                  <small>
                    Follow agent activity and project progress below.
                  </small>
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
                <h2 id="home-agents">Agent activity</h2>
                <p>Live work across your projects.</p>
              </div>
            </div>
            <button className="text-action" onClick={onRuns}>
              All runs <ArrowRight size={14} />
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
                  <strong>No agents running.</strong>
                  <small>Start implementation from an approved feature.</small>
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
              <h2 id="home-projects">Project flow</h2>
              <p>Follow every feature from planning to review.</p>
            </div>
          </div>
          <div className="home-header-actions">
            <button className="text-action" onClick={onQuality}>
              Quality evidence <ShieldCheck size={14} />
            </button>
            <button className="text-action" onClick={onPortfolio}>
              Workspace overview <ArrowRight size={14} />
            </button>
          </div>
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
                    <small>{countLabel(features.length, "feature")}</small>
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
                    <p className="project-empty">No features yet.</p>
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
