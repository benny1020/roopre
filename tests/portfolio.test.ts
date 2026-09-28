import test from "node:test";
import assert from "node:assert/strict";
import { adeFixture } from "./fixtures/ade.ts";
import { projectPortfolio } from "../src/renderer/src/workspace/portfolio-model.ts";

const now = Date.parse("2026-09-28T10:00:00.000Z");
const at = new Date(now - 1000).toISOString();
function fixture() {
  const snapshot = adeFixture();
  for (const run of snapshot.runs) {
    run.runtime!.heartbeat = at;
    run.at = at;
  }
  return snapshot;
}

test("portfolio separates queue, all-run occupancy, current agents and reported cost", () => {
  const snapshot = fixture();
  const current = snapshot.runs.at(-1)!;
  current.status = "queued";
  current.runtime!.costReported = true;
  current.runtime!.costUsd = 0;
  const previous = snapshot.runs[0];
  previous.status = "failed";
  previous.runtime!.terminationConfirmed = false;
  previous.runtime!.costReported = false;
  const projection = projectPortfolio(snapshot, at, "", now);
  assert.equal(projection.queued, 1);
  assert.equal(projection.occupied, 2);
  assert.equal(projection.activeAgents, 0);
  assert.equal(projection.reportedCost, 0);
  assert.equal(projection.reportedRuns, 1);
  assert.equal(projection.unreportedRuns, 1);
  assert.ok(
    projection.attention.some(
      (item) => item.reason === "termination" && item.ref.runId === previous.id,
    ),
  );
});

test("portfolio keeps identity and excludes cancelled, stale, or residual agents from active work", () => {
  const snapshot = fixture();
  const run = snapshot.runs.at(-1)!;
  run.status = "implementing";
  run.runtime!.agents![0].status = "running";
  run.runtime!.agents!.push({
    ...run.runtime!.agents![0],
    id: "same-name-second",
    name: run.runtime!.agents![0].name,
  });
  let projection = projectPortfolio(snapshot, at, "", now);
  assert.equal(projection.agents.length, 2);
  assert.equal(new Set(projection.agents.map((agent) => agent.key)).size, 2);
  assert.equal(projection.activeAgents, 2);
  run.runtime!.cancelRequested = true;
  projection = projectPortfolio(snapshot, at, "", now);
  assert.equal(projection.activeAgents, 0);
  assert.ok(projection.agents.every((agent) => agent.status === "stopping"));
  run.runtime!.cancelRequested = false;
  run.runtime!.heartbeat = new Date(now - 31000).toISOString();
  projection = projectPortfolio(snapshot, at, "", now);
  assert.equal(projection.activeAgents, 0);
  assert.ok(projection.attention.some((item) => item.reason === "stale"));
});

test("portfolio freshness rejects a stale accepted screen while preserving current-attempt evidence", () => {
  const snapshot = fixture();
  const run = snapshot.runs.at(-1)!;
  run.status = "verifying";
  run.runtime!.agents![0].status = "running";
  const projection = projectPortfolio(
    snapshot,
    new Date(now - 6000).toISOString(),
    "",
    now,
  );
  assert.equal(projection.freshness, "stale");
  assert.equal(projection.activeAgents, 0);
  assert.equal(
    run.runtime!.evidence.filter((e) => e.attempt === run.runtime!.attempt)
      .length,
    1,
  );
  assert.equal(
    run.runtime!.evidence.filter((e) => e.attempt !== run.runtime!.attempt)
      .length,
    1,
  );
});
