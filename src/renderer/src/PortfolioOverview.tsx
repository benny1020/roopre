import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Search,
} from "lucide-react";
import type { Snapshot } from "../../shared/contracts";
import { executionCapacityOf } from "../../shared/runtime";
import { latestAgents } from "../../shared/harness";
import { phases } from "./workspace/presentation";
import AgentWorkroom from "./workspace/AgentWorkroom";
import ConversationPanel from "./workspace/ConversationPanel";
import MemoryPanel, { type MemorySeed } from "./workspace/MemoryPanel";
import {
  projectPortfolio,
  describePortfolioRun,
  isHistoricalPortfolioRun,
  type AgentCard,
  type PortfolioItem,
  type PortfolioProjection,
  type PortfolioRef,
} from "./workspace/portfolio-model";

type Destination = "design" | "execution" | "review";
export type PortfolioViewState = {
  projectScope: string;
  query: string;
  attentionOnly: boolean;
  view: "flow" | "roles" | "workroom";
  selectionRef?: PortfolioRef;
  collapsedProjectIds: string[];
  scrollTop: number;
};
export default function PortfolioOverview({
  snapshot,
  acceptedAt,
  fetchError,
  now,
  onOpen,
  state,
  onStateChange,
}: {
  snapshot: Snapshot;
  acceptedAt?: string;
  fetchError: string;
  now: number;
  onOpen: (ref: PortfolioRef, destination: Destination) => void;
  state: PortfolioViewState;
  onStateChange: (state: PortfolioViewState) => void;
}) {
  const capacity = executionCapacityOf(snapshot.executionCapacity);
  const {
    projectScope,
    query,
    attentionOnly,
    view,
    selectionRef: selected,
  } = state;
  const [showAllAttention, setShowAllAttention] = useState(false);
  const collapsed = useMemo(
    () => new Set(state.collapsedProjectIds),
    [state.collapsedProjectIds],
  );
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.parentElement?.scrollTo({ top: state.scrollTop });
  }, [state.scrollTop]);
  useEffect(() => {
    const scroller = root.current?.parentElement;
    if (!scroller) return;
    const rememberScroll = () => {
      if (Math.abs(scroller.scrollTop - state.scrollTop) > 2)
        onStateChange({ ...state, scrollTop: scroller.scrollTop });
    };
    scroller.addEventListener("scroll", rememberScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", rememberScroll);
  }, [state, onStateChange]);
  const update = (patch: Partial<PortfolioViewState>) =>
    onStateChange({ ...state, ...patch });
  const projection = useMemo(
    () => projectPortfolio(snapshot, acceptedAt, fetchError, now),
    [snapshot, acceptedAt, fetchError, now],
  );
  const scopedProjection = useMemo(() => {
    if (projectScope === "all") return projection;
    const features = snapshot.features.filter(
      (feature) => feature.projectId === projectScope,
    );
    const ids = new Set(features.map((feature) => feature.id));
    return projectPortfolio(
      {
        ...snapshot,
        projects: snapshot.projects.filter(
          (project) => project.id === projectScope,
        ),
        features,
        runs: snapshot.runs.filter((run) => ids.has(run.featureId)),
        gates: Object.fromEntries(
          Object.entries(snapshot.gates).filter(([id]) => ids.has(id)),
        ),
      },
      acceptedAt,
      fetchError,
      now,
    );
  }, [projectScope, snapshot, projection, acceptedAt, fetchError, now]);
  const items = projection.items.filter(
    (item) =>
      (projectScope === "all" || item.feature.projectId === projectScope) &&
      (!query ||
        `${item.feature.title} ${snapshot.projects.find((project) => project.id === item.feature.projectId)?.name || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!attentionOnly ||
        scopedProjection.attention.some(
          (attention) => attention.ref.featureId === item.feature.id,
        )),
  );
  const filteredProjection = useMemo(() => {
    const ids = new Set(items.map((item) => item.feature.id));
    return projectPortfolio(
      {
        ...snapshot,
        projects: snapshot.projects.filter((project) =>
          snapshot.features.some(
            (feature) =>
              feature.projectId === project.id && ids.has(feature.id),
          ),
        ),
        features: snapshot.features.filter((feature) => ids.has(feature.id)),
        runs: snapshot.runs.filter((run) => ids.has(run.featureId)),
        gates: Object.fromEntries(
          Object.entries(snapshot.gates).filter(([id]) => ids.has(id)),
        ),
      },
      acceptedAt,
      fetchError,
      now,
    );
  }, [items, snapshot, acceptedAt, fetchError, now]);
  const selectedVisible =
    !!selected && items.some((item) => item.feature.id === selected.featureId);
  const select = (ref: PortfolioRef) => update({ selectionRef: ref });
  const open = (ref: PortfolioRef, destination: Destination) =>
    onOpen(ref, destination);
  const groups = snapshot.projects
    .filter((project) => projectScope === "all" || project.id === projectScope)
    .map((project) => ({
      project,
      items: items.filter((item) => item.feature.projectId === project.id),
    }))
    .filter((group) => group.items.length);
  return (
    <div className="content-page portfolio-page" ref={root}>
      <div className="page-heading portfolio-heading">
        <div>
          <div className="eyebrow">Workspace · read-only overview</div>
          <h1>Workspace overview</h1>
          <p>
            Inspect current activity and pending decisions, then open the
            relevant workspace.
          </p>
        </div>
      </div>
      {(projection.freshness !== "fresh" ||
        filteredProjection.attention.some((item) => !item.ref.featureId)) && (
        <div className="portfolio-banner" role="status">
          <Clock3 size={15} />{" "}
          {projection.freshness === "stale"
            ? `Stale view · last successful sync ${acceptedAt ? new Date(acceptedAt).toLocaleTimeString() : "Unknown"}`
            : filteredProjection.attention.some(
                  (item) => item.reason === "runner",
                )
              ? "Check runner connection · showing last known state"
              : "Checking sync time"}
        </div>
      )}
      <div className="portfolio-summary" aria-label="Workspace status">
        <span>
          <strong>
            {projection.occupied}/{capacity.maxConcurrentRuns}
          </strong>
          <small>
            Global occupied slots · queue in scope {filteredProjection.queued}
          </small>
        </span>
        <span>
          <strong>{filteredProjection.activeAgents}</strong>
          <small>Active agents in scope</small>
        </span>
        <span>
          <strong>{filteredProjection.attention.length}</strong>
          <small>Decisions and blockers in scope</small>
        </span>
        <span>
          <strong>
            {filteredProjection.reportedRuns
              ? `$${filteredProjection.reportedCost.toFixed(2)}${filteredProjection.unreportedRuns || filteredProjection.invalidCostRuns ? " · Partial" : ""}`
              : "Not reported"}
          </strong>
          <small>
            Reported estimated cost in scope · reported{" "}
            {filteredProjection.reportedRuns}· missing{" "}
            {filteredProjection.unreportedRuns} runs
            {filteredProjection.invalidCostRuns
              ? ` · Cost data error ${filteredProjection.invalidCostRuns}`
              : ""}
          </small>
        </span>
      </div>
      {filteredProjection.terminationPending > 0 && (
        <p className="portfolio-note">
          <CircleAlert size={14} /> Awaiting termination confirmation in scope{" "}
          {filteredProjection.terminationPending}
          still occupy execution slots.
        </p>
      )}
      <section
        className="portfolio-attention"
        aria-labelledby="portfolio-attention"
      >
        <div className="section-heading">
          <h2 id="portfolio-attention">Needs attention</h2>
          <small>
            Feature{" "}
            {
              new Set(
                filteredProjection.attention
                  .map((item) => item.ref.featureId)
                  .filter(Boolean),
              ).size
            }
            · reasons{" "}
            {
              filteredProjection.attention.filter((item) => item.ref.featureId)
                .length
            }
            total
          </small>
        </div>
        {filteredProjection.attention
          .filter((item) => item.ref.featureId)
          .slice(0, showAllAttention ? undefined : 2)
          .map((item) => (
            <button
              className="portfolio-attention-row"
              key={item.key}
              onClick={() => {
                select(item.ref);
                open(item.ref, item.destination);
              }}
            >
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <span>
                {item.owner} <ArrowUpRight size={13} />
              </span>
            </button>
          ))}
        {filteredProjection.attention.filter((item) => item.ref.featureId)
          .length > 2 && (
          <button
            className="portfolio-more"
            aria-expanded={showAllAttention}
            onClick={() => setShowAllAttention((value) => !value)}
          >
            {showAllAttention
              ? "Collapse decisions"
              : `Needs attention ${filteredProjection.attention.filter((item) => item.ref.featureId).length - 2} more`}
          </button>
        )}
        {!filteredProjection.attention.some((item) => item.ref.featureId) && (
          <p className="muted">No features need a decision in this snapshot.</p>
        )}
      </section>
      <div className="portfolio-toolbar">
        <label className="inline-search">
          <Search size={15} />
          <input
            aria-label="Search workspace features"
            placeholder="Search projects and features"
            value={query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </label>
        <select
          aria-label="Project scope"
          value={projectScope}
          onChange={(event) => update({ projectScope: event.target.value })}
        >
          <option value="all">All projects</option>
          {snapshot.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button
          className={attentionOnly ? "soft active" : "soft"}
          aria-pressed={attentionOnly}
          onClick={() => update({ attentionOnly: !attentionOnly })}
        >
          Needs attention only
        </button>
        <div className="view-tabs" aria-label="Overview view">
          <button
            className={view === "flow" ? "active" : ""}
            aria-pressed={view === "flow"}
            onClick={() => update({ view: "flow" })}
          >
            Project flow
          </button>
          <button
            className={view === "roles" ? "active" : ""}
            aria-pressed={view === "roles"}
            onClick={() => update({ view: "roles" })}
          >
            Roles
          </button>
          <button
            className={view === "workroom" ? "active" : ""}
            aria-pressed={view === "workroom"}
            onClick={() => update({ view: "workroom" })}
          >
            Agent workspace
          </button>
        </div>
      </div>
      <div className="portfolio-layout">
        <section className="portfolio-main">
          {view === "flow" ? (
            <Flow
              projectRunLimit={capacity.maxConcurrentRunsPerProject}
              groups={groups}
              selected={selected}
              collapsed={collapsed}
              toggle={(id: string) => {
                const next = new Set(collapsed);
                next.has(id) ? next.delete(id) : next.add(id);
                update({ collapsedProjectIds: [...next] });
              }}
              onSelect={select}
            />
          ) : view === "roles" ? (
            <RoleMap
              agents={projection.agents.filter((agent) =>
                items.some((item) => item.feature.id === agent.ref.featureId),
              )}
              selected={selected}
              onSelect={select}
            />
          ) : (
            <AgentWorkroom
              agents={projection.agents.filter((agent) =>
                items.some((item) => item.feature.id === agent.ref.featureId),
              )}
              selected={selected}
              onSelect={select}
            />
          )}
          {!items.length && (
            <div className="empty">
              <h3>No features in this scope</h3>
              <p>Clear the search or filters to see other work.</p>
            </div>
          )}
        </section>
        <Inspector
          ref={selectedVisible ? selected : undefined}
          snapshot={snapshot}
          projection={projection}
          onOpen={open}
        />
      </div>
    </div>
  );
}

function Flow({
  groups,
  projectRunLimit,
  selected,
  collapsed,
  toggle,
  onSelect,
}: {
  groups: { project: Snapshot["projects"][number]; items: PortfolioItem[] }[];
  projectRunLimit: number;
  selected?: PortfolioRef;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (ref: PortfolioRef) => void;
}) {
  return (
    <div
      className="portfolio-flow"
      role="region"
      aria-label="Project stage overview"
    >
      <div className="portfolio-table-head">
        <span>Project / Feature</span>
        {phases.map((phase) => (
          <span key={phase}>{phase}</span>
        ))}
      </div>
      {groups.map(({ project, items }) => (
        <section key={project.id}>
          <button
            className="portfolio-project"
            aria-expanded={!collapsed.has(project.id)}
            onClick={() => toggle(project.id)}
          >
            {collapsed.has(project.id) ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )}{" "}
            <strong>{project.name}</strong>
            <small>
              {items.length} features · Up to {projectRunLimit} runs per project
            </small>
          </button>
          {!collapsed.has(project.id) &&
            items.map((item) => (
              <button
                key={item.feature.id}
                className={`portfolio-row ${selected?.featureId === item.feature.id ? "selected" : ""}`}
                data-portfolio-focus={`${item.ref.featureId}:${item.ref.runId || ""}:${item.ref.attempt || ""}:`}
                aria-pressed={selected?.featureId === item.feature.id}
                onClick={() => onSelect(item.ref)}
              >
                <span>
                  <strong>{item.feature.title}</strong>
                  <small>
                    {item.label} · {item.next}
                  </small>
                </span>
                {phases.map((phase, index: number) => (
                  <span
                    key={phase}
                    className={index === item.phase ? "current" : ""}
                  >
                    {index === item.phase ? item.label : "·"}
                  </span>
                ))}
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}
function RoleMap({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentCard[];
  selected?: PortfolioRef;
  onSelect: (ref: PortfolioRef) => void;
}) {
  const groups = [
    "requirements",
    "design",
    "implementation",
    "verification",
    "review",
  ];
  const labels: Record<string, string> = {
    requirements: "Requirements",
    design: "Design",
    implementation: "Implementation",
    verification: "Verification",
    review: "Review",
  };
  return (
    <div className="portfolio-role-map">
      {groups.map((stage) => {
        const cards = agents.filter((agent) => agent.stage === stage);
        return (
          <section key={stage}>
            <h2>
              {labels[stage]} <small>Run {cards.length}</small>
            </h2>
            {cards.length ? (
              cards.map((agent) => (
                <button
                  key={agent.key}
                  className={`portfolio-agent ${selected?.runId === agent.ref.runId && selected?.attempt === agent.ref.attempt && selected?.agentExecutionId === agent.ref.agentExecutionId ? "selected" : ""}`}
                  aria-pressed={
                    selected?.runId === agent.ref.runId &&
                    selected?.attempt === agent.ref.attempt &&
                    selected?.agentExecutionId === agent.ref.agentExecutionId
                  }
                  data-portfolio-focus={`${agent.ref.featureId}:${agent.ref.runId}:${agent.ref.attempt}:${agent.ref.agentExecutionId}`}
                  onClick={() => onSelect(agent.ref)}
                >
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.projectName} / {agent.featureTitle}
                  </small>
                  <small>
                    {agent.ref.runId} · Attempt {agent.ref.attempt}
                  </small>
                  <small>
                    {agent.model} · v{agent.revision} ·{" "}
                    {agent.status === "running"
                      ? "Working"
                      : agent.status === "stopping"
                        ? "Stopping"
                        : agent.status === "residual"
                          ? "Residual records from a finished run"
                          : "Last known: running · current state unavailable"}
                  </small>
                </button>
              ))
            ) : (
              <p className="muted">No current run</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
function Inspector({
  ref,
  snapshot,
  projection,
  onOpen,
}: {
  ref?: PortfolioRef;
  snapshot: Snapshot;
  projection: PortfolioProjection;
  onOpen: (ref: PortfolioRef, destination: Destination) => void;
}) {
  if (!ref)
    return (
      <aside className="portfolio-inspector" aria-label="Selected work">
        <p className="muted">
          Select a feature or run to inspect its status and open its workspace.
        </p>
      </aside>
    );
  const feature = snapshot.features.find(
    (candidate) => candidate.id === ref.featureId,
  );
  const project = snapshot.projects.find(
    (candidate) => candidate.id === feature?.projectId,
  );
  const run = ref.runId
    ? snapshot.runs.find((candidate) => candidate.id === ref.runId)
    : undefined;
  if (!feature)
    return (
      <aside className="portfolio-inspector" aria-label="Selected work">
        <p className="muted">
          This feature is no longer in the current snapshot.
        </p>
      </aside>
    );
  if (!run)
    return (
      <aside className="portfolio-inspector" aria-label="Selected work">
        <small>
          {
            snapshot.projects.find(
              (project) => project.id === feature.projectId,
            )?.name
          }{" "}
          / Selected feature
        </small>
        <h2>{feature.title}</h2>
        <p className="portfolio-state">Not started</p>
        <InspectorTabs
          key={JSON.stringify([feature.id, null, null, null])}
          scopeBase={{
            workspaceId: snapshot.teamId,
            projectId: feature.projectId,
            featureId: feature.id,
          }}
          agents={agentsForProject(snapshot, project?.id)}
          assignments={project?.workflow?.assignments || []}
          snapshot={snapshot}
          work={
            <>
              <dl>
                <dt>Next action</dt>
                <dd>Check the design and approval requirements.</dd>
                <dt>Requirements</dt>
                <dd>{feature.draft.requirements}</dd>
              </dl>
              <button className="soft" onClick={() => onOpen(ref, "design")}>
                Open design and approvals <ArrowUpRight size={13} />
              </button>
            </>
          }
        />
      </aside>
    );
  const runtime = run?.runtime;
  const current = ref.attempt ?? runtime?.attempt;
  const [, runLabel, nextAction, owner] = describePortfolioRun(
    run,
    feature,
    snapshot,
  );
  const historical = isHistoricalPortfolioRun(
    snapshot,
    feature.id,
    run,
    current,
  );
  const currentEvidence =
    runtime?.evidence.filter((e) => e.attempt === current) || [];
  const latestEvent = runtime?.events.at(-1);
  const activeAgent =
    projection.agents.find(
      (agent) =>
        agent.ref.runId === run?.id &&
        agent.ref.attempt === current &&
        agent.ref.agentExecutionId === ref.agentExecutionId,
    ) ||
    projection.agents.find(
      (agent) => agent.ref.runId === run?.id && agent.ref.attempt === current,
    );
  const agents = agentsForProject(snapshot, project?.id);
  return (
    <aside className="portfolio-inspector" aria-label="Selected work">
      <small>{project?.name} / Selected feature</small>
      <h2>{feature.title}</h2>
      <p className="portfolio-state">
        {runLabel} · {historical ? "Previous run" : "Current run"}
      </p>
      <InspectorTabs
        key={JSON.stringify([
          feature.id,
          run.id,
          current ?? null,
          ref.agentExecutionId ?? null,
        ])}
        scopeBase={{
          workspaceId: snapshot.teamId,
          projectId: feature.projectId,
          featureId: feature.id,
        }}
        agents={agents}
        assignments={project?.workflow?.assignments || []}
        snapshot={snapshot}
        execution={
          run && ref.agentExecutionId
            ? {
                runId: run.id,
                attempt: current || 1,
                executionId: ref.agentExecutionId,
              }
            : undefined
        }
        executionAssignmentId={
          ref.agentExecutionId
            ? runtime?.agents?.find(
                (candidate) => candidate.id === ref.agentExecutionId,
              )?.assignmentId
            : undefined
        }
        defaultAgentId={
          ref.agentExecutionId
            ? runtime?.harness?.agents.find(
                (candidate) =>
                  candidate.id ===
                  runtime.agents?.find(
                    (execution) => execution.id === ref.agentExecutionId,
                  )?.assignmentId,
              )?.agent.id
            : undefined
        }
        work={
          <>
            <dl>
              <dt>Next owner and action</dt>
              <dd>
                {run?.runtime?.cancelRequested
                  ? "System · waiting for execution to stop and termination to be confirmed"
                  : activeAgent?.status === "running"
                    ? `Agent · ${activeAgent.name} Inspect the execution record`
                    : activeAgent?.status === "stale"
                      ? "System · last known state is running; current status is unavailable"
                      : `${owner} · ${nextAction}`}
              </dd>
              <dt>Run ID</dt>
              <dd>
                <code title={run?.id}>{run?.id || "No run details"}</code>
              </dd>
              <dt>Selected attempt</dt>
              <dd>Attempt {current ?? "No records"}</dd>
              <dt>Latest activity</dt>
              <dd>{latestEvent ? latestEvent.message : "No records"}</dd>
              <dt>Runner last seen</dt>
              <dd>
                {runtime?.heartbeat
                  ? new Date(runtime.heartbeat).toLocaleTimeString()
                  : "No records"}
              </dd>
              <dt>Design & instructions</dt>
              <dd>
                {run
                  ? `${run.designId} · Policy v${run.policyVersion}`
                  : "No records"}
              </dd>
              <dt>Evidence for this attempt</dt>
              <dd>
                {currentEvidence.length
                  ? `Checks ${currentEvidence.length} · Artifacts ${(runtime?.artifacts || []).filter((artifact) => artifact.attempt === current).length}`
                  : "No evidence for this attempt"}
              </dd>
              <dt>Cost</dt>
              <dd>
                {runtime?.costReported
                  ? Number.isFinite(runtime.costUsd) && runtime.costUsd >= 0
                    ? `$${runtime.costUsd.toFixed(4)} · Reported cumulative estimate`
                    : "Invalid cost data"
                  : "Cost not reported"}
              </dd>
              <dt>Current record</dt>
              <dd>
                {projection.snapshotAt
                  ? new Date(projection.snapshotAt).toLocaleTimeString()
                  : "Unknown"}
              </dd>
            </dl>
            {run && (
              <button
                className="secondary"
                onClick={() =>
                  onOpen(
                    ref,
                    run.status === "ready_for_merge" ? "review" : "execution",
                  )
                }
              >
                Open execution and evidence <ArrowUpRight size={13} />
              </button>
            )}
            <button className="soft" onClick={() => onOpen(ref, "design")}>
              Open design and approvals <ArrowUpRight size={13} />
            </button>
          </>
        }
      />
    </aside>
  );
}

function agentsForProject(snapshot: Snapshot, projectId?: string) {
  const project = snapshot.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const definitions = latestAgents(snapshot).filter(
    (agent) => !agent.projectId || agent.projectId === projectId,
  );
  const configured = (project?.workflow?.assignments || [])
    .map((assignment) =>
      definitions.find((agent) => agent.id === assignment.agentId),
    )
    .filter((agent): agent is NonNullable<typeof agent> => !!agent);
  const activeConfigured = configured.filter((agent) => !agent.archived);
  const archivedConfigured = configured.filter((agent) => agent.archived);
  const historicalArchived = definitions.filter((agent) => agent.archived);
  const candidates = configured.length
    ? [...activeConfigured, ...archivedConfigured, ...historicalArchived]
    : definitions;
  return [...new Map(candidates.map((agent) => [agent.id, agent])).values()];
}

function InspectorTabs({
  scopeBase,
  agents,
  assignments,
  snapshot,
  defaultAgentId,
  execution,
  executionAssignmentId,
  work,
}: {
  scopeBase: { workspaceId: string; projectId: string; featureId: string };
  agents: NonNullable<Snapshot["agents"]>;
  assignments: { id: string; agentId: string; stage?: string }[];
  snapshot: Snapshot;
  defaultAgentId?: string;
  execution?: { runId: string; attempt: number; executionId?: string };
  executionAssignmentId?: string;
  work: ReactNode;
}) {
  const [tab, setTab] = useState<"work" | "conversation" | "memory">("work");
  const [agentId, setAgentId] = useState(defaultAgentId || agents[0]?.id || "");
  const [assignmentId, setAssignmentId] = useState(
    () =>
      assignments.find(
        (assignment) =>
          assignment.id === executionAssignmentId &&
          assignment.agentId === (defaultAgentId || agents[0]?.id),
      )?.id ||
      assignments.find(
        (assignment) =>
          assignment.agentId === (defaultAgentId || agents[0]?.id),
      )?.id ||
      "",
  );
  const [projectWide, setProjectWide] = useState(false);
  const [memorySeed, setMemorySeed] = useState<MemorySeed>();
  const memoryScopeKey = JSON.stringify([
    scopeBase.projectId,
    scopeBase.featureId,
    agentId,
    projectWide,
  ]);
  useEffect(() => setMemorySeed(undefined), [memoryScopeKey]);
  useEffect(() => {
    if (!agents.some((agent) => agent.id === agentId))
      setAgentId(agents[0]?.id || "");
  }, [agents, agentId]);
  const agent = agents.find((candidate) => candidate.id === agentId);
  const agentAssignments = assignments.filter(
    (candidate) => candidate.agentId === agent?.id,
  );
  const assignment = agentAssignments.find(
    (candidate) => candidate.id === assignmentId,
  );
  return (
    <div className="inspector-tabs">
      <div
        className="inspector-tab-list"
        role="tablist"
        aria-label="Work context"
      >
        <button
          role="tab"
          aria-selected={tab === "work"}
          onClick={() => setTab("work")}
        >
          Work
        </button>
        <button
          role="tab"
          aria-selected={tab === "conversation"}
          onClick={() => setTab("conversation")}
        >
          Conversation
        </button>
        <button
          role="tab"
          aria-selected={tab === "memory"}
          onClick={() => setTab("memory")}
        >
          Memory
        </button>
      </div>
      {(tab === "conversation" || tab === "memory") && (
        <label className="inspector-agent-select">
          Agent to consult
          <select
            aria-label="Agent to consult"
            value={agentId}
            onChange={(event) => {
              const nextAgentId = event.target.value;
              setAgentId(nextAgentId);
              setAssignmentId(
                assignments.find(
                  (candidate) => candidate.agentId === nextAgentId,
                )?.id || "",
              );
            }}
          >
            {!agents.length && <option value="">No assigned agents</option>}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · v{agent.revision}
                {agent.archived ? "· Archived" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {(tab === "conversation" || tab === "memory") &&
        agentAssignments.length > 1 && (
          <label className="inspector-agent-select">
            Assignment context
            <select
              aria-label="Consultation assignment"
              value={assignmentId}
              onChange={(event) => setAssignmentId(event.target.value)}
            >
              <option value="">Use current definition only</option>
              {agentAssignments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.stage || "Stage"} · {item.id}
                </option>
              ))}
            </select>
          </label>
        )}
      {(tab === "conversation" || tab === "memory") && (
        <label className="inspector-agent-select">
          Conversation scope
          <select
            aria-label="Conversation scope"
            value={projectWide ? "project" : "feature"}
            onChange={(event) =>
              setProjectWide(event.target.value === "project")
            }
          >
            <option value="feature">This feature</option>
            <option value="project">Entire project</option>
          </select>
        </label>
      )}
      {tab === "work" && work}
      {tab === "conversation" && agent && (
        <ConversationPanel
          key={JSON.stringify([
            scopeBase.workspaceId,
            scopeBase.projectId,
            scopeBase.featureId,
            agent.id,
            projectWide,
          ])}
          agentName={agent.name}
          scope={{
            ...scopeBase,
            agentDefinitionId: agent.id,
            ...(projectWide ? { featureId: undefined } : {}),
          }}
          assignmentId={assignment?.id}
          execution={
            !projectWide && assignment?.id === executionAssignmentId
              ? execution
              : undefined
          }
          configured={
            !agent.archived &&
            (!!agent.connectionId ||
              !!snapshot.projects.find(
                (project) => project.id === scopeBase.projectId,
              )?.executionProfile?.connectionId)
          }
          archived={agent.archived}
          onSaveTurn={(turn) => {
            setMemorySeed({
              title: "Confirmed work memory",
              body: turn.answer || turn.input,
              sourceRef: {
                type: "conversation",
                threadId: turn.threadId,
                turnId: turn.id,
              },
            });
            setTab("memory");
          }}
          memories={
            snapshot.projects.find(
              (project) => project.id === scopeBase.projectId,
            )?.memories || []
          }
        />
      )}
      {tab === "conversation" && !agent && (
        <p className="muted">
          No agents are configured for this project. Assign roles in workflow
          settings.
        </p>
      )}
      {tab === "memory" && (
        <MemoryPanel
          key={memoryScopeKey}
          snapshot={snapshot}
          projectId={scopeBase.projectId}
          featureId={projectWide ? undefined : scopeBase.featureId}
          agentId={agent?.id}
          seed={memorySeed}
        />
      )}
    </div>
  );
}
