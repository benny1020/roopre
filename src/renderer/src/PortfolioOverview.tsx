import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Search,
} from "lucide-react";
import type { Snapshot } from "../../shared/contracts";
import { phases } from "./workspace/presentation";
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
  view: "flow" | "roles";
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
          <div className="eyebrow">워크스페이스 · 읽기 전용 관제</div>
          <h1>전역 관제</h1>
          <p>
            현재 기록과 다음 판단을 확인하고, 기존 상세 화면으로 이동합니다.
          </p>
        </div>
      </div>
      {(projection.freshness !== "fresh" ||
        filteredProjection.attention.some((item) => !item.ref.featureId)) && (
        <div className="portfolio-banner" role="status">
          <Clock3 size={15} />{" "}
          {projection.freshness === "stale"
            ? `오래된 화면 · 마지막 성공 조회 ${acceptedAt ? new Date(acceptedAt).toLocaleTimeString() : "미확인"}`
            : filteredProjection.attention.some(
                  (item) => item.reason === "runner",
                )
              ? "실행기 연결 확인 필요 · 마지막 기록을 유지합니다"
              : "조회 시각을 확인하는 중"}
        </div>
      )}
      <div className="portfolio-summary" aria-label="전역 상태 요약">
        <span>
          <strong>{projection.occupied}/2</strong>
          <small>
            전역 기록상 슬롯 점유 · 선택 범위 큐 {filteredProjection.queued}
          </small>
        </span>
        <span>
          <strong>{filteredProjection.activeAgents}</strong>
          <small>선택 범위 에이전트 작업 중</small>
        </span>
        <span>
          <strong>{filteredProjection.attention.length}</strong>
          <small>선택 범위 판단·확인 사유</small>
        </span>
        <span>
          <strong>
            {filteredProjection.reportedRuns
              ? `$${filteredProjection.reportedCost.toFixed(2)}${filteredProjection.unreportedRuns || filteredProjection.invalidCostRuns ? " 일부" : ""}`
              : "미보고"}
          </strong>
          <small>
            선택 범위 보고된 누적 추정 · 보고 {filteredProjection.reportedRuns}
            개 · 미보고 {filteredProjection.unreportedRuns}개 run
            {filteredProjection.invalidCostRuns
              ? ` · 비용 정보 오류 ${filteredProjection.invalidCostRuns}개`
              : ""}
          </small>
        </span>
      </div>
      {filteredProjection.terminationPending > 0 && (
        <p className="portfolio-note">
          <CircleAlert size={14} /> 선택 범위 종료 확인 중{" "}
          {filteredProjection.terminationPending}
          개는 슬롯 점유를 유지합니다.
        </p>
      )}
      <section
        className="portfolio-attention"
        aria-labelledby="portfolio-attention"
      >
        <div className="section-heading">
          <h2 id="portfolio-attention">판단할 일</h2>
          <small>
            기능{" "}
            {
              new Set(
                filteredProjection.attention
                  .map((item) => item.ref.featureId)
                  .filter(Boolean),
              ).size
            }
            개 · 사유{" "}
            {
              filteredProjection.attention.filter((item) => item.ref.featureId)
                .length
            }
            개
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
              ? "판단할 일 접기"
              : `판단할 일 ${filteredProjection.attention.filter((item) => item.ref.featureId).length - 2}개 더 보기`}
          </button>
        )}
        {!filteredProjection.attention.some((item) => item.ref.featureId) && (
          <p className="muted">현재 snapshot에서 판단할 기능이 없습니다.</p>
        )}
      </section>
      <div className="portfolio-toolbar">
        <label className="inline-search">
          <Search size={15} />
          <input
            aria-label="전역 기능 검색"
            placeholder="프로젝트와 기능 검색"
            value={query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </label>
        <select
          aria-label="프로젝트 범위"
          value={projectScope}
          onChange={(event) => update({ projectScope: event.target.value })}
        >
          <option value="all">전체 프로젝트</option>
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
          판단·확인 필요만
        </button>
        <div className="view-tabs" aria-label="관제 보기">
          <button
            className={view === "flow" ? "active" : ""}
            aria-pressed={view === "flow"}
            onClick={() => update({ view: "flow" })}
          >
            프로젝트 흐름
          </button>
          <button
            className={view === "roles" ? "active" : ""}
            aria-pressed={view === "roles"}
            onClick={() => update({ view: "roles" })}
          >
            역할별 운영 맵
          </button>
        </div>
      </div>
      <div className="portfolio-layout">
        <section className="portfolio-main">
          {view === "flow" ? (
            <Flow
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
          ) : (
            <RoleMap
              agents={projection.agents.filter((agent) =>
                items.some((item) => item.feature.id === agent.ref.featureId),
              )}
              selected={selected}
              onSelect={select}
            />
          )}
          {!items.length && (
            <div className="empty">
              <h3>선택한 범위에 기능이 없습니다</h3>
              <p>검색어나 필터를 해제해 다른 기록을 확인하세요.</p>
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
  selected,
  collapsed,
  toggle,
  onSelect,
}: {
  groups: { project: Snapshot["projects"][number]; items: PortfolioItem[] }[];
  selected?: PortfolioRef;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onSelect: (ref: PortfolioRef) => void;
}) {
  return (
    <div
      className="portfolio-flow"
      role="region"
      aria-label="프로젝트 단계 관제"
    >
      <div className="portfolio-table-head">
        <span>프로젝트 / 기능</span>
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
            <small>{items.length}개 기능 · 프로젝트 동시 run 1개</small>
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
    requirements: "요구사항",
    design: "설계",
    implementation: "구현",
    verification: "검증",
    review: "리뷰",
  };
  return (
    <div className="portfolio-role-map">
      {groups.map((stage) => {
        const cards = agents.filter((agent) => agent.stage === stage);
        return (
          <section key={stage}>
            <h2>
              {labels[stage]} <small>실행 {cards.length}</small>
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
                    {agent.ref.runId} · 시도 {agent.ref.attempt}
                  </small>
                  <small>
                    {agent.model} · v{agent.revision} ·{" "}
                    {agent.status === "running"
                      ? "작업 중"
                      : agent.status === "stopping"
                        ? "중단 요청 처리 중"
                        : agent.status === "residual"
                          ? "종료된 run의 잔여 기록"
                          : "마지막 기록: 실행 중 · 현재 확인 불가"}
                  </small>
                </button>
              ))
            ) : (
              <p className="muted">현재 실행 기록 없음</p>
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
      <aside className="portfolio-inspector" aria-label="선택한 작업">
        <p className="muted">
          기능 행 또는 실행 카드를 선택하면 상태 근거와 상세 이동을 표시합니다.
        </p>
      </aside>
    );
  const feature = snapshot.features.find(
    (candidate) => candidate.id === ref.featureId,
  );
  const run = ref.runId
    ? snapshot.runs.find((candidate) => candidate.id === ref.runId)
    : undefined;
  if (!feature)
    return (
      <aside className="portfolio-inspector" aria-label="선택한 작업">
        <p className="muted">선택한 기능이 현재 snapshot에 없습니다.</p>
      </aside>
    );
  if (!run)
    return (
      <aside className="portfolio-inspector" aria-label="선택한 작업">
        <small>
          {
            snapshot.projects.find(
              (project) => project.id === feature.projectId,
            )?.name
          }{" "}
          / 선택한 기능
        </small>
        <h2>{feature.title}</h2>
        <p className="portfolio-state">아직 실행 전</p>
        <dl>
          <dt>다음 행동</dt>
          <dd>설계 작성과 승인 조건을 확인하세요.</dd>
          <dt>요구사항</dt>
          <dd>{feature.draft.requirements}</dd>
        </dl>
        <button className="soft" onClick={() => onOpen(ref, "design")}>
          기존 설계·승인 상세 보기 <ArrowUpRight size={13} />
        </button>
      </aside>
    );
  const project = snapshot.projects.find(
    (candidate) => candidate.id === feature.projectId,
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
  return (
    <aside className="portfolio-inspector" aria-label="선택한 작업">
      <small>{project?.name} / 선택한 기능</small>
      <h2>{feature.title}</h2>
      <p className="portfolio-state">
        {runLabel} · {historical ? "과거 실행" : "현재 실행"}
      </p>
      <dl>
        <dt>다음 담당과 행동</dt>
        <dd>
          {run?.runtime?.cancelRequested
            ? "시스템 · 중단 요청 처리와 종료 확인을 기다립니다"
            : activeAgent?.status === "running"
              ? `에이전트 · ${activeAgent.name} 작업 기록을 확인하세요`
              : activeAgent?.status === "stale"
                ? "시스템 · 마지막 기록은 실행 중이나 현재 상태를 확인할 수 없습니다"
                : `${owner} · ${nextAction}`}
        </dd>
        <dt>실행 ID</dt>
        <dd>
          <code title={run?.id}>{run?.id || "실행 정보 없음"}</code>
        </dd>
        <dt>선택한 시도</dt>
        <dd>시도 {current ?? "기록 없음"}</dd>
        <dt>최근 기록</dt>
        <dd>{latestEvent ? latestEvent.message : "기록 없음"}</dd>
        <dt>실행기 마지막 확인</dt>
        <dd>
          {runtime?.heartbeat
            ? new Date(runtime.heartbeat).toLocaleTimeString()
            : "기록 없음"}
        </dd>
        <dt>적용 설계·지침</dt>
        <dd>
          {run ? `${run.designId} · 정책 v${run.policyVersion}` : "기록 없음"}
        </dd>
        <dt>현재 시도 근거</dt>
        <dd>
          {currentEvidence.length
            ? `검사 ${currentEvidence.length}개 · 산출물 ${(runtime?.artifacts || []).filter((artifact) => artifact.attempt === current).length}개`
            : "현재 시도 근거 없음"}
        </dd>
        <dt>비용</dt>
        <dd>
          {runtime?.costReported
            ? Number.isFinite(runtime.costUsd) && runtime.costUsd >= 0
              ? `$${runtime.costUsd.toFixed(4)} · 보고된 누적 추정`
              : "비용 정보 오류"
            : "비용 미보고"}
        </dd>
        <dt>현재 기록</dt>
        <dd>
          {projection.snapshotAt
            ? new Date(projection.snapshotAt).toLocaleTimeString()
            : "미확인"}
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
          기존 실행·근거 상세 보기 <ArrowUpRight size={13} />
        </button>
      )}
      <button className="soft" onClick={() => onOpen(ref, "design")}>
        기존 설계·승인 상세 보기 <ArrowUpRight size={13} />
      </button>
    </aside>
  );
}
