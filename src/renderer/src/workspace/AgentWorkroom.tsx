import type { AgentCard, PortfolioRef } from "./portfolio-model";
import { stageNames, stages } from "../../../shared/harness";

const status = (agent: AgentCard) =>
  agent.status === "running"
    ? "Working"
    : agent.status === "stopping"
      ? "Stopping"
      : agent.status === "residual"
        ? "Residual records from a finished run"
        : "Last known: running · current state unavailable";

function DeskAvatar({ status }: { status: AgentCard["status"] }) {
  return (
    <span className={`workroom-avatar is-${status}`} aria-hidden="true">
      <svg viewBox="0 0 76 66" fill="none">
        <rect
          className="workroom-screen"
          x="18"
          y="3"
          width="40"
          height="27"
          rx="4"
        />
        <path className="workroom-code" d="M31 12h8m-8 6h14" />
        <path className="workroom-desk" d="M7 38h62" />
        <path
          className="workroom-chair"
          d="M27 56v-8c0-4 3-6 11-6s11 2 11 6v8"
        />
        <path className="workroom-person" d="M29 41c0-7 3-11 9-11s9 4 9 11" />
        <circle className="workroom-face" cx="35" cy="35" r="1.5" />
        <circle className="workroom-face" cx="41" cy="35" r="1.5" />
      </svg>
    </span>
  );
}

export default function AgentWorkroom({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentCard[];
  selected?: PortfolioRef;
  onSelect: (ref: PortfolioRef) => void;
}) {
  return (
    <section className="agent-workroom" aria-label="Agent workspace">
      <header className="agent-workroom-heading">
        <div>
          <h2>Agent workspace</h2>
          <p>Only seats with execution records are shown.</p>
        </div>
        <small>Current record {agents.length}</small>
      </header>
      <div className="agent-workroom-floor">
        {stages.map((stage) => {
          const seats = agents.filter((agent) => agent.stage === stage);
          return (
            <section
              className={`agent-workroom-room ${seats.length ? "has-seats" : "is-empty"} ${seats.length >= 3 ? "has-three-or-more" : ""}`}
              key={stage}
            >
              <header>
                <h3>{stageNames[stage]}</h3>
                <small>Run {seats.length}</small>
              </header>
              {seats.length ? (
                <div className="agent-workroom-seats">
                  {seats.map((agent) => {
                    const isSelected =
                      selected?.runId === agent.ref.runId &&
                      selected?.attempt === agent.ref.attempt &&
                      selected?.agentExecutionId === agent.ref.agentExecutionId;
                    return (
                      <button
                        key={agent.key}
                        type="button"
                        className={`agent-workroom-seat ${isSelected ? "selected" : ""}`}
                        aria-pressed={isSelected}
                        data-portfolio-focus={`${agent.ref.featureId}:${agent.ref.runId}:${agent.ref.attempt}:${agent.ref.agentExecutionId}`}
                        onClick={() => onSelect(agent.ref)}
                      >
                        <DeskAvatar status={agent.status} />
                        <strong>{agent.name}</strong>
                        <small>{agent.model}</small>
                        <span
                          className={`agent-workroom-status is-${agent.status}`}
                        >
                          <i />
                          {status(agent)}
                        </span>
                        <span className="agent-workroom-context">
                          {agent.projectName} / {agent.featureTitle}
                        </span>
                        <code>
                          {agent.ref.runId} · Attempt {agent.ref.attempt}
                        </code>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="agent-workroom-empty">No current run</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
