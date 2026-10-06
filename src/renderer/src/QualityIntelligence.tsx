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
  ready: "Ready for review",
  failed: "Failed",
  cancelled: "Cancel",
  active: "In progress",
  queued: "Pending",
  other: "Records",
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
          <span role="columnheader">Scope</span>
          <span role="columnheader">Ready rate</span>
          <span role="columnheader">First attempt</span>
          <span role="columnheader">Complete evidence</span>
          <span role="columnheader">Cost</span>
        </div>
        {rows.map((row) => (
          <div className="quality-table-row" role="row" key={row.id}>
            <span role="cell">
              <strong>{row.label}</strong>
              <small>
                {row.runs} implementation runs · {row.decided} results
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
                  row.reportedCostRuns
                    ? `Reported ${row.reportedCostRuns}`
                    : "",
                  row.unreportedCost
                    ? `Not reported ${row.unreportedCost}`
                    : "",
                  row.invalidCost ? `Invalid value ${row.invalidCost}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "No cost data"}
              </small>
            </span>
          </div>
        ))}
        {!rows.length && <p className="quality-empty">No runs to show.</p>}
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
      ? `${quality.missingEvidence} ready runs lack passing checks for the current attempt.`
      : "",
    quality.missingReview
      ? `${quality.missingReview} ready runs have no independent review record.`
      : "",
    quality.unreportedCostRuns
      ? `${quality.unreportedCostRuns} implementation runs have no provider-reported cost.`
      : "",
    quality.invalidCostRuns
      ? `${quality.invalidCostRuns} invalid cost records are excluded from the total.`
      : "",
    quality.missingRuntimeRuns
      ? `${quality.missingRuntimeRuns} runs without environment records are excluded from metrics.`
      : "",
    quality.missingHarnessRuns
      ? `${quality.missingHarnessRuns} legacy runs without a harness revision are shown separately.`
      : "",
    quality.invalidTimestampRuns
      ? `${quality.invalidTimestampRuns} runs with invalid timestamps appear last.`
      : "",
  ].filter(Boolean);

  return (
    <div className="content-page quality-page">
      <header className="quality-heading">
        <div>
          <div className="eyebrow">Quality Intelligence</div>
          <h1>Standards backed by results</h1>
          <p>
            Evaluate fixed checks, independent reviews, attempts and cost
            records.
          </p>
        </div>
        <label>
          <span>Projects</span>
          <select
            aria-label="Quality project scope"
            value={selectedProjectId}
            onChange={(event) => onProjectId(event.target.value)}
          >
            <option value="all">All projects</option>
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
              ? "No result sample"
              : quality.confidence === "early"
                ? "Early evidence"
                : "Accumulated evidence"}
          </strong>
          <small>
            {quality.terminal} result samples · In progress {quality.active} ·
            Queued {quality.queued} · Cancelled {quality.cancelled}. Rates are
            observations, not an absolute quality score.
          </small>
        </span>
      </div>

      <section className="quality-metrics" aria-label="Quality metrics">
        <RatioMetric
          icon={<Gauge size={16} />}
          label="Ready rate"
          value={percent(quality.resultRate)}
          detail={`${quality.ready}/${quality.terminal} Ready for review`}
        />
        <RatioMetric
          icon={<GitBranch size={16} />}
          label="First-attempt completion"
          value={percent(quality.firstPassRate)}
          detail={`${quality.firstPass}/${quality.ready} Ready results`}
        />
        <RatioMetric
          icon={<ShieldCheck size={16} />}
          label="Complete evidence"
          value={percent(quality.evidenceRate)}
          detail={`${quality.evidenceComplete}/${quality.ready} Checks & review present`}
        />
        <RatioMetric
          icon={<ReceiptText size={16} />}
          label="Reported cost"
          value={`$${quality.reportedCost.toFixed(2)}`}
          detail={`Reported ${quality.reportedCostRuns} · Unreported ${quality.unreportedCostRuns}`}
        />
      </section>

      <section className="quality-section quality-recent">
        <header>
          <div>
            <h2>Recent execution evidence</h2>
            <p>
              Open a result to inspect its diff, checks and independent review.
            </p>
          </div>
          <small>Recent {quality.recent.length}/ Up to 12</small>
        </header>
        <div
          className="quality-run-strip"
          aria-label="Recent implementation runs"
        >
          {quality.recent.map((row) => (
            <button
              key={row.run.id}
              className={`quality-run ${row.outcome}`}
              onClick={() => onOpen(row.feature.id, row.run.id)}
              aria-label={`${row.project.name} ${row.feature.title}, ${outcomeLabel[row.outcome]}, attempt ${row.run.runtime?.attempt ?? 0}`}
            >
              <i aria-hidden="true" />
              <span>
                <strong>{row.feature.title}</strong>
                <small>{row.project.name}</small>
              </span>
              <span>
                {outcomeLabel[row.outcome]}
                <small>
                  {row.evidence === "complete" ? "Checks" : "Checks incomplete"}{" "}
                  · {row.hasReview ? "Review" : "No review"}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!quality.recent.length && (
            <div className="quality-empty-state">
              <FlaskConical size={20} />
              <span>
                <strong>No implementation runs to measure yet.</strong>
                <small>
                  Run an approved feature to collect check and review evidence
                  here.
                </small>
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="quality-breakdowns">
        <BreakdownTable
          title="Results by project"
          description="Compare samples separately and keep unreported costs visible."
          rows={quality.projects}
        />
        <BreakdownTable
          title="Results by harness revision"
          description="Compare the workflow revision pinned when each run started."
          rows={quality.harnesses}
        />
      </div>

      <section className="quality-section quality-gaps">
        <header>
          <div>
            <h2>Evidence gaps</h2>
            <p>Unmeasured results are never counted as successful.</p>
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
            <CheckCircle2 size={16} /> Required evidence is complete for the
            saved results.
          </div>
        )}
      </section>
    </div>
  );
}
