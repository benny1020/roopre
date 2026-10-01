import { useEffect, useMemo } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  Gauge,
  GitBranch,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import type { Snapshot } from "../../shared/contracts";
import {
  qualityProjection,
  type QualityBreakdown,
  type QualityRun,
} from "./workspace/quality-model";

const percent = (value?: number) =>
  value === undefined ? "—" : `${Math.round(value * 100)}%`;

const outcomeLabel: Record<QualityRun["outcome"], string> = {
  ready: "결과 준비",
  failed: "실패",
  cancelled: "취소",
  active: "진행 중",
  queued: "대기",
  other: "기록",
};

function RatioMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="quality-metric">
      <span className="quality-metric-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: QualityBreakdown[];
}) {
  return (
    <section className="quality-section">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div
        className="quality-table"
        role="table"
        aria-label={title}
        tabIndex={0}
      >
        <div className="quality-table-head" role="row">
          <span role="columnheader">범위</span>
          <span role="columnheader">결과율</span>
          <span role="columnheader">첫 시도</span>
          <span role="columnheader">근거 완결</span>
          <span role="columnheader">비용</span>
        </div>
        {rows.map((row) => (
          <div className="quality-table-row" role="row" key={row.id}>
            <span role="cell">
              <strong>{row.label}</strong>
              <small>
                구현 실행 {row.runs}개 · 결과 표본 {row.decided}개
              </small>
            </span>
            <span role="cell">
              {percent(row.decided ? row.ready / row.decided : undefined)}
              <small>
                {row.ready}/{row.decided}
              </small>
            </span>
            <span role="cell">
              {percent(row.ready ? row.firstPass / row.ready : undefined)}
              <small>
                {row.firstPass}/{row.ready}
              </small>
            </span>
            <span role="cell">
              {percent(
                row.ready ? row.evidenceComplete / row.ready : undefined,
              )}
              <small>
                {row.evidenceComplete}/{row.ready}
              </small>
            </span>
            <span role="cell">
              ${row.reportedCost.toFixed(2)}
              <small>
                {[
                  row.reportedCostRuns ? `보고 ${row.reportedCostRuns}` : "",
                  row.unreportedCost ? `미보고 ${row.unreportedCost}` : "",
                  row.invalidCost ? `잘못된 값 ${row.invalidCost}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "비용 기록 없음"}
              </small>
            </span>
          </div>
        ))}
        {!rows.length && (
          <p className="quality-empty">표시할 실행이 없습니다.</p>
        )}
      </div>
    </section>
  );
}

export default function QualityIntelligence({
  snapshot,
  projectId,
  onProjectId,
  onOpen,
}: {
  snapshot: Snapshot;
  projectId: string;
  onProjectId: (projectId: string) => void;
  onOpen: (featureId: string, runId: string) => void;
}) {
  const selectedProjectId =
    projectId === "all" ||
    snapshot.projects.some((project) => project.id === projectId)
      ? projectId
      : "all";
  useEffect(() => {
    if (selectedProjectId !== projectId) onProjectId(selectedProjectId);
  }, [onProjectId, projectId, selectedProjectId]);
  const quality = useMemo(
    () => qualityProjection(snapshot, selectedProjectId),
    [snapshot, selectedProjectId],
  );
  const issues = [
    quality.missingEvidence
      ? `결과 준비 실행 ${quality.missingEvidence}개에 현재 시도의 통과 검사 근거가 부족합니다.`
      : "",
    quality.missingReview
      ? `결과 준비 실행 ${quality.missingReview}개에 독립 리뷰 기록이 없습니다.`
      : "",
    quality.unreportedCostRuns
      ? `구현 실행 ${quality.unreportedCostRuns}개의 비용이 provider에서 보고되지 않았습니다.`
      : "",
    quality.invalidCostRuns
      ? `비용 값이 잘못된 실행 ${quality.invalidCostRuns}개를 합계에서 제외했습니다.`
      : "",
    quality.missingRuntimeRuns
      ? `실행 환경 기록이 없는 실행 ${quality.missingRuntimeRuns}개를 지표에서 제외했습니다.`
      : "",
    quality.missingHarnessRuns
      ? `Harness revision이 없는 이전 실행 ${quality.missingHarnessRuns}개를 별도로 표시합니다.`
      : "",
    quality.invalidTimestampRuns
      ? `실행 시각이 잘못된 기록 ${quality.invalidTimestampRuns}개는 최근 순서의 뒤에 둡니다.`
      : "",
  ].filter(Boolean);

  return (
    <div className="content-page quality-page">
      <header className="quality-heading">
        <div>
          <div className="eyebrow">Quality Intelligence</div>
          <h1>팀 표준이 실제 결과로 이어지는지</h1>
          <p>
            성공 선언이 아니라 고정 검사, 독립 리뷰, 시도와 비용 기록으로
            확인합니다.
          </p>
        </div>
        <label>
          <span>프로젝트</span>
          <select
            aria-label="품질 프로젝트 범위"
            value={selectedProjectId}
            onChange={(event) => onProjectId(event.target.value)}
          >
            <option value="all">전체 프로젝트</option>
            {snapshot.projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className={`quality-confidence ${quality.confidence}`} role="status">
        {quality.confidence === "empty" ? (
          <FlaskConical size={16} />
        ) : quality.confidence === "early" ? (
          <CircleAlert size={16} />
        ) : (
          <CheckCircle2 size={16} />
        )}
        <span>
          <strong>
            {quality.confidence === "empty"
              ? "결과 표본이 없습니다"
              : quality.confidence === "early"
                ? "초기 근거"
                : "누적 근거"}
          </strong>
          <small>
            {quality.terminal}개 결과 표본 · 진행 {quality.active} · 대기{" "}
            {quality.queued}· 취소 {quality.cancelled}. 비율은 절대 품질 점수가
            아닙니다.
          </small>
        </span>
      </div>

      <section className="quality-metrics" aria-label="품질 핵심 지표">
        <RatioMetric
          icon={<Gauge size={16} />}
          label="결과율"
          value={percent(quality.resultRate)}
          detail={`${quality.ready}/${quality.terminal} 결과 준비`}
        />
        <RatioMetric
          icon={<GitBranch size={16} />}
          label="첫 시도 완료"
          value={percent(quality.firstPassRate)}
          detail={`${quality.firstPass}/${quality.ready} 준비 결과`}
        />
        <RatioMetric
          icon={<ShieldCheck size={16} />}
          label="근거 완결"
          value={percent(quality.evidenceRate)}
          detail={`${quality.evidenceComplete}/${quality.ready} 검사·리뷰 보유`}
        />
        <RatioMetric
          icon={<ReceiptText size={16} />}
          label="보고 비용"
          value={`$${quality.reportedCost.toFixed(2)}`}
          detail={`보고 ${quality.reportedCostRuns} · 미보고 ${quality.unreportedCostRuns}`}
        />
      </section>

      <section className="quality-section quality-recent">
        <header>
          <div>
            <h2>최근 실행 근거</h2>
            <p>각 셀을 열어 실제 diff, 검사와 리뷰 기록을 확인합니다.</p>
          </div>
          <small>최근 {quality.recent.length}/최대 12개</small>
        </header>
        <div className="quality-run-strip" aria-label="최근 구현 실행">
          {quality.recent.map((row) => (
            <button
              key={row.run.id}
              className={`quality-run ${row.outcome}`}
              onClick={() => onOpen(row.feature.id, row.run.id)}
              aria-label={`${row.project.name} ${row.feature.title}, ${outcomeLabel[row.outcome]}, 시도 ${row.run.runtime?.attempt ?? 0}`}
            >
              <i aria-hidden="true" />
              <span>
                <strong>{row.feature.title}</strong>
                <small>{row.project.name}</small>
              </span>
              <span>
                {outcomeLabel[row.outcome]}
                <small>
                  {row.evidence === "complete" ? "검사" : "검사 미완"} ·{" "}
                  {row.hasReview ? "리뷰" : "리뷰 없음"}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!quality.recent.length && (
            <div className="quality-empty-state">
              <FlaskConical size={20} />
              <span>
                <strong>아직 측정할 구현 실행이 없습니다.</strong>
                <small>
                  승인된 기능을 실행하면 검사와 리뷰 근거가 여기에 쌓입니다.
                </small>
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="quality-breakdowns">
        <BreakdownTable
          title="프로젝트별 결과"
          description="서로 다른 프로젝트의 표본과 미보고 비용을 분리합니다."
          rows={quality.projects}
        />
        <BreakdownTable
          title="Harness revision별 결과"
          description="실행 당시 고정된 개발 흐름 revision으로 비교합니다."
          rows={quality.harnesses}
        />
      </div>

      <section className="quality-section quality-gaps">
        <header>
          <div>
            <h2>보완할 근거</h2>
            <p>측정할 수 없는 항목을 성공으로 보정하지 않습니다.</p>
          </div>
        </header>
        {issues.length ? (
          <ul>
            {issues.map((issue) => (
              <li key={issue}>
                <CircleAlert size={14} />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="quality-clear">
            <CheckCircle2 size={16} /> 현재 저장된 결과의 필수 근거가
            완결됐습니다.
          </div>
        )}
      </section>
    </div>
  );
}
