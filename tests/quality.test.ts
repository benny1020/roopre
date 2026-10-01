import test from "node:test";
import assert from "node:assert/strict";
import { adeFixture } from "./fixtures/ade.ts";
import { qualityProjection } from "../src/renderer/src/workspace/quality-model.ts";

test("quality projection keeps planning, active and cancelled runs out of result rate", () => {
  const snapshot = adeFixture();
  const previous = snapshot.runs[0];
  previous.status = "ready_for_merge";
  previous.runtime!.attempt = 1;
  previous.runtime!.review = "독립 리뷰 통과";
  previous.runtime!.harness = {
    version: 1,
    workflowRevision: 3,
    agents: [],
  };
  previous.runtime!.evidence = [
    {
      name: "test",
      status: "passed",
      code: 0,
      at: previous.at,
      tree: "a".repeat(40),
      log: "passed",
      attempt: 1,
    },
  ];
  const failed = snapshot.runs[1];
  failed.status = "failed";
  failed.runtime!.terminationConfirmed = true;
  failed.runtime!.harness = {
    version: 1,
    workflowRevision: 3,
    agents: [],
  };
  snapshot.runs.push(
    {
      ...structuredClone(failed),
      id: "planning",
      status: "completed",
      runtime: { ...structuredClone(failed.runtime!), kind: "planning" },
    },
    {
      ...structuredClone(failed),
      id: "active",
      status: "implementing",
    },
    {
      ...structuredClone(failed),
      id: "cancelled",
      status: "cancelled",
    },
  );

  const quality = qualityProjection(snapshot);
  assert.equal(quality.runs.length, 4);
  assert.equal(quality.terminal, 2);
  assert.equal(quality.ready, 1);
  assert.equal(quality.failed, 1);
  assert.equal(quality.active, 1);
  assert.equal(quality.cancelled, 1);
  assert.equal(quality.resultRate, 0.5);
  assert.equal(quality.firstPassRate, 1);
  assert.equal(quality.evidenceRate, 1);
  assert.equal(quality.confidence, "early");
});

test("quality projection reports missing evidence, review, harness and costs without filling zeroes", () => {
  const snapshot = adeFixture();
  const ready = snapshot.runs[0];
  ready.status = "ready_for_merge";
  ready.runtime!.evidence = [];
  ready.runtime!.review = "";
  ready.runtime!.costReported = false;
  const invalid = snapshot.runs[1];
  invalid.status = "ready_for_merge";
  invalid.runtime!.evidence = [];
  invalid.runtime!.review = "review";
  invalid.runtime!.costReported = true;
  invalid.runtime!.costUsd = Number.NaN;
  invalid.at = "invalid";

  const quality = qualityProjection(snapshot);
  assert.equal(quality.ready, 2);
  assert.equal(quality.missingEvidence, 2);
  assert.equal(quality.missingReview, 1);
  assert.equal(quality.evidenceRate, 0);
  assert.equal(quality.reportedCost, 0);
  assert.equal(quality.reportedCostRuns, 0);
  assert.equal(quality.unreportedCostRuns, 1);
  assert.equal(quality.invalidCostRuns, 1);
  assert.equal(quality.invalidTimestampRuns, 1);
  assert.equal(quality.missingHarnessRuns, 2);
  assert.equal(quality.harnesses[0].label, "Harness 기록 없음");
});

test("quality projection filters projects and keeps breakdown totals explainable", () => {
  const snapshot = adeFixture();
  const sourceProject = snapshot.projects[0];
  const sourceFeature = snapshot.features[0];
  snapshot.projects.push({
    ...structuredClone(sourceProject),
    id: "project-two",
    name: "두 번째 프로젝트",
  });
  snapshot.features.push({
    ...structuredClone(sourceFeature),
    id: "feature-two",
    projectId: "project-two",
  });
  snapshot.runs.push({
    ...structuredClone(snapshot.runs[0]),
    id: "run-two",
    featureId: "feature-two",
  });

  const all = qualityProjection(snapshot);
  assert.equal(all.projects.length, 2);
  assert.equal(
    all.projects.reduce((sum, row) => sum + row.runs, 0),
    all.runs.length,
  );
  const filtered = qualityProjection(snapshot, "project-two");
  assert.equal(filtered.runs.length, 1);
  assert.equal(filtered.projects.length, 1);
  assert.equal(filtered.projects[0].label, "두 번째 프로젝트");
});
