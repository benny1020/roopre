import type {
  Feature,
  Project,
  Run,
  Snapshot,
} from "../../../shared/contracts";
import { activeStatuses } from "../../../shared/runtime";

export type QualityOutcome =
  "ready" | "failed" | "cancelled" | "active" | "queued" | "other";

export type QualityRun = {
  run: Run;
  feature: Feature;
  project: Project;
  outcome: QualityOutcome;
  evidence: "complete" | "failed" | "missing";
  hasReview: boolean;
  firstPass: boolean;
  workflowRevision?: number;
  reportedCost?: number;
  occurredAt?: number;
};

export type QualityBreakdown = {
  id: string;
  label: string;
  runs: number;
  decided: number;
  ready: number;
  failed: number;
  firstPass: number;
  evidenceComplete: number;
  reportedCost: number;
  unreportedCost: number;
};

export type QualityProjection = {
  runs: QualityRun[];
  recent: QualityRun[];
  terminal: number;
  ready: number;
  failed: number;
  cancelled: number;
  active: number;
  queued: number;
  firstPass: number;
  evidenceComplete: number;
  missingEvidence: number;
  missingReview: number;
  reportedCost: number;
  reportedCostRuns: number;
  unreportedCostRuns: number;
  invalidCostRuns: number;
  invalidTimestampRuns: number;
  missingHarnessRuns: number;
  resultRate?: number;
  firstPassRate?: number;
  evidenceRate?: number;
  confidence: "empty" | "early" | "established";
  projects: QualityBreakdown[];
  harnesses: QualityBreakdown[];
};

const readyStatuses = new Set(["ready_for_merge", "completed"]);
const failedStatuses = new Set(["failed", "interrupted", "blocked"]);

function outcomeOf(run: Run): QualityOutcome {
  if (readyStatuses.has(run.status)) return "ready";
  if (failedStatuses.has(run.status)) return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "queued") return "queued";
  if (activeStatuses.includes(run.status)) return "active";
  return "other";
}

function evidenceOf(run: Run): QualityRun["evidence"] {
  const current = (run.runtime?.evidence ?? []).filter(
    (item) => item.attempt === run.runtime?.attempt,
  );
  if (!current.length) return "missing";
  return current.every((item) => item.status === "passed")
    ? "complete"
    : "failed";
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rate(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : undefined;
}

function summarize(
  id: string,
  label: string,
  rows: readonly QualityRun[],
): QualityBreakdown {
  const decided = rows.filter((row) =>
    ["ready", "failed"].includes(row.outcome),
  );
  const ready = decided.filter((row) => row.outcome === "ready");
  return {
    id,
    label,
    runs: rows.length,
    decided: decided.length,
    ready: ready.length,
    failed: decided.filter((row) => row.outcome === "failed").length,
    firstPass: ready.filter((row) => row.firstPass).length,
    evidenceComplete: ready.filter(
      (row) => row.evidence === "complete" && row.hasReview,
    ).length,
    reportedCost: rows.reduce(
      (total, row) => total + (row.reportedCost ?? 0),
      0,
    ),
    unreportedCost: rows.filter((row) => row.run.runtime?.costReported !== true)
      .length,
  };
}

export function qualityProjection(
  snapshot: Snapshot,
  projectId = "all",
): QualityProjection {
  const features = new Map(
    snapshot.features.map((feature) => [feature.id, feature]),
  );
  const projects = new Map(
    snapshot.projects.map((project) => [project.id, project]),
  );
  const runs: QualityRun[] = [];
  let invalidCostRuns = 0;

  for (const run of snapshot.runs) {
    if (!run.runtime || run.runtime.kind === "planning") continue;
    const feature = features.get(run.featureId);
    const project = feature && projects.get(feature.projectId);
    if (
      !feature ||
      !project ||
      (projectId !== "all" && project.id !== projectId)
    )
      continue;
    const cost = run.runtime.costUsd;
    const validCost = Number.isFinite(cost) && cost >= 0;
    if (run.runtime.costReported === true && !validCost) invalidCostRuns += 1;
    const outcome = outcomeOf(run);
    runs.push({
      run,
      feature,
      project,
      outcome,
      evidence: evidenceOf(run),
      hasReview: Boolean(run.runtime.review?.trim()),
      firstPass: outcome === "ready" && run.runtime.attempt <= 1,
      workflowRevision: run.runtime.harness?.workflowRevision,
      reportedCost:
        run.runtime.costReported === true && validCost ? cost : undefined,
      occurredAt: timestamp(run.at),
    });
  }

  const decided = runs.filter((row) =>
    ["ready", "failed"].includes(row.outcome),
  );
  const ready = decided.filter((row) => row.outcome === "ready");
  const firstPass = ready.filter((row) => row.firstPass);
  const evidenceComplete = ready.filter(
    (row) => row.evidence === "complete" && row.hasReview,
  );
  const byProject = [...new Set(runs.map((row) => row.project.id))]
    .map((id) =>
      summarize(
        id,
        projects.get(id)?.name ?? "알 수 없는 프로젝트",
        runs.filter((row) => row.project.id === id),
      ),
    )
    .sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));
  const harnessKeys = [
    ...new Set(runs.map((row) => row.workflowRevision ?? "missing")),
  ];
  const harnesses = harnessKeys
    .map((revision) =>
      summarize(
        String(revision),
        revision === "missing" ? "Harness 기록 없음" : `Workflow v${revision}`,
        runs.filter((row) => (row.workflowRevision ?? "missing") === revision),
      ),
    )
    .sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));

  return {
    runs,
    recent: [...runs]
      .sort(
        (a, b) =>
          (b.occurredAt ?? Number.NEGATIVE_INFINITY) -
          (a.occurredAt ?? Number.NEGATIVE_INFINITY),
      )
      .slice(0, 12),
    terminal: decided.length,
    ready: ready.length,
    failed: decided.filter((row) => row.outcome === "failed").length,
    cancelled: runs.filter((row) => row.outcome === "cancelled").length,
    active: runs.filter((row) => row.outcome === "active").length,
    queued: runs.filter((row) => row.outcome === "queued").length,
    firstPass: firstPass.length,
    evidenceComplete: evidenceComplete.length,
    missingEvidence: ready.filter((row) => row.evidence !== "complete").length,
    missingReview: ready.filter((row) => !row.hasReview).length,
    reportedCost: runs.reduce(
      (total, row) => total + (row.reportedCost ?? 0),
      0,
    ),
    reportedCostRuns: runs.filter((row) => row.reportedCost !== undefined)
      .length,
    unreportedCostRuns: runs.filter(
      (row) => row.run.runtime?.costReported !== true,
    ).length,
    invalidCostRuns,
    invalidTimestampRuns: runs.filter((row) => row.occurredAt === undefined)
      .length,
    missingHarnessRuns: runs.filter((row) => row.workflowRevision === undefined)
      .length,
    resultRate: rate(ready.length, decided.length),
    firstPassRate: rate(firstPass.length, ready.length),
    evidenceRate: rate(evidenceComplete.length, ready.length),
    confidence:
      decided.length === 0
        ? "empty"
        : decided.length < 3
          ? "early"
          : "established",
    projects: byProject,
    harnesses,
  };
}
