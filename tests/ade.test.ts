import test from "node:test";
import assert from "node:assert/strict";
import { adeFixture, patch } from "./fixtures/ade";
import { workState } from "../src/renderer/src/workspace/presentation";
import { parseDiff } from "../src/renderer/src/workspace/diff";
test("ADE state distinguishes planning completion, verification and handoff without claiming merge", () => {
  const w = adeFixture(),
    f = w.features[0],
    r = w.runs.at(-1)!;
  assert.equal(workState(w, f).phase, 3);
  assert.equal(workState(w, f).actor, "SYSTEM");
  r.runtime!.kind = "planning";
  r.status = "completed";
  assert.equal(workState(w, f).label, "종료 확인 중");
  r.runtime!.terminationConfirmed = true;
  assert.equal(workState(w, f).phase, 1);
  assert.equal(workState(w, f).actor, "HUMAN");
  r.runtime!.kind = undefined;
  r.status = "ready_for_merge";
  r.reason = "";
  assert.equal(workState(w, f).phase, 4);
  assert.equal(workState(w, f).attention, true);
  assert.match(workState(w, f).next, /병합은 별도/);
  r.status = "failed";
  assert.equal(workState(w, f).tone, "danger");
});
test("diff keeps actual hunk line numbers and file boundaries", () => {
  const files = parseDiff(patch);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, "src/payment.ts");
  assert.deepEqual(
    files[0].lines.find((l) => l.kind === "remove"),
    { text: '-  return "failed";', kind: "remove", old: 10 },
  );
  assert.equal(files[0].lines.find((l) => l.kind === "add")?.next, 10);
  assert.equal(files[0].additions, 2);
  assert.equal(files[1].removals, 0);
  assert.equal(parseDiff("").length, 0);
});
test("binary and renamed paths remain visible without invented lines", () => {
  const [binary] = parseDiff(
    "diff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ",
  );
  assert.equal(binary.additions, 0);
  assert.ok(binary.lines.every((l) => l.kind === "meta"));
  const [rename] = parseDiff(
    "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts",
  );
  assert.match(rename.path, /new.ts/);
});

test("stale running agents and unconfirmed cancellation do not imply active work or idle", () => {
  const w = adeFixture(),
    f = w.features[0],
    r = w.runs.at(-1)!;
  r.runtime!.agents!.unshift({
    ...r.runtime!.agents![0],
    id: "stale",
    name: "previous attempt agent",
    attempt: 1,
    status: "running",
  });
  assert.doesNotMatch(workState(w, f).next, /previous attempt agent/);
  for (const status of [
    "cancelled",
    "interrupted",
    "failed",
    "blocked",
  ] as const) {
    r.status = status;
    r.runtime!.terminationConfirmed = false;
    assert.equal(workState(w, f).label, "종료 확인 중");
    assert.equal(workState(w, f).actor, "SYSTEM");
    assert.equal(workState(w, f).attention, true);
  }
  r.status = "cancelled";
  r.runtime!.terminationConfirmed = true;
  assert.equal(workState(w, f).phase, 1);
});
