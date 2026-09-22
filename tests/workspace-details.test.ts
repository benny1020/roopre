import test from "node:test";
import assert from "node:assert/strict";
import {
  rememberLocation,
  historyTarget,
  type NavigationHistory,
  type WorkspaceLocation,
} from "../src/renderer/src/workspace/navigation.ts";
import { searchCommands } from "../src/renderer/src/workspace/search.ts";
import { parseDiff } from "../src/renderer/src/workspace/diff.ts";
import { restoreWindowState } from "../src/main/window-state.ts";
const location = (scope: string, query = ""): WorkspaceLocation => ({
  scope,
  selected: null,
  query,
  runtimeSection: "connection",
});
test("workspace history retains search context, truncates a forward branch and bounds visits", () => {
  let h: NavigationHistory = { entries: [], index: -1 };
  h = rememberLocation(h, location("all"));
  h = rememberLocation(h, location("all", "payment"));
  h = rememberLocation(h, location("runtime"));
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[0].query, "payment");
  h = rememberLocation({ ...h, index: 0 }, location("agents"));
  assert.deepEqual(
    h.entries.map((e) => e.scope),
    ["all", "agents"],
  );
  for (let i = 0; i < 100; i++)
    h = rememberLocation(h, location(`project-${i}`));
  assert.equal(h.entries.length, 60);
  assert.equal(h.index, 59);
  assert.equal(h.entries[h.index].scope, "project-99");
});
test("history skips removed projects and keeps project-specific settings destinations", () => {
  let h: NavigationHistory = { entries: [], index: -1 };
  for (const entry of [
    location("all"),
    location("removed"),
    {
      ...location("runtime"),
      settingsContext: { projectId: "a", featureId: "fa" },
    },
    {
      ...location("runtime"),
      settingsContext: { projectId: "b", featureId: "fb" },
    },
  ])
    h = rememberLocation(h, entry);
  assert.equal(
    historyTarget(h, -1, () => true),
    2,
  );
  assert.equal(
    historyTarget({ ...h, index: 2 }, -1, (entry) => entry.scope !== "removed"),
    0,
  );
  assert.equal(
    historyTarget(h, 1, () => true),
    undefined,
  );
});
test("command search ranks exact titles and matches words across project and feature", () => {
  const commands = [
    { title: "Setup", meta: "결제 프로젝트" },
    { title: "결제 재시도", meta: "Commerce" },
    { title: "결제", meta: "기능" },
  ];
  assert.equal(searchCommands(commands, "  결제  ")[0].title, "결제");
  assert.deepEqual(searchCommands(commands, "commerce   재시도"), [
    commands[1],
  ]);
  assert.deepEqual(searchCommands(commands, "   "), commands);
  assert.deepEqual(searchCommands(commands, "missing"), []);
});
test("diff selection identity survives inserted files and source plus headers stay in their hunk", () => {
  const p =
    "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+++ pretend-header";
  const first = parseDiff(p)[0];
  assert.equal(first.path, "a.ts");
  assert.equal(first.lines.at(-1)!.kind, "add");
  const reordered = parseDiff(
    "diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+new\n" +
      p,
  );
  assert.equal(reordered[1].id, first.id);
  assert.notEqual(reordered[0].id, first.id);
});
test("Git octal Korean paths, rename and deletion labels keep raw patch evidence", () => {
  const quoted = '"b/\\355\\225\\234\\352\\270\\200.ts"';
  const p = `diff --git a/file.ts ${quoted}\n--- a/file.ts\n+++ ${quoted}\n@@ -1 +1 @@\n-a\n+b`;
  assert.equal(parseDiff(p)[0].path, "한글.ts");
  assert.ok(parseDiff(p)[0].lines.some((l) => l.text === `+++ ${quoted}`));
  assert.equal(
    parseDiff(
      "diff --git a/old name b/new name\nrename from old name\nrename to new name",
    )[0].path,
    "new name",
  );
  assert.equal(
    parseDiff(
      "diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old",
    )[0].path,
    "gone.ts",
  );
});
test("window restore handles disconnected displays, negative coordinates and invalid preferences", () => {
  const primary = { x: 0, y: 30, width: 1920, height: 1050 };
  const secondary = { x: -1600, y: 0, width: 1600, height: 1000 };
  const saved = {
    version: 1,
    bounds: { x: -1500, y: 40, width: 1200, height: 800 },
    maximized: true,
  };
  assert.deepEqual(restoreWindowState(saved, [primary, secondary]), saved);
  const restored = restoreWindowState(saved, [primary]);
  assert.equal(restored.bounds.width, 1200);
  assert.ok(restored.bounds.x >= primary.x);
  assert.ok(restored.bounds.y >= primary.y);
  assert.ok(restored.bounds.x + restored.bounds.width <= primary.width);
  assert.equal(
    restoreWindowState({ ...saved, bounds: { ...saved.bounds, width: NaN } }, [
      primary,
    ]).bounds.width,
    1440,
  );
  const clipped = restoreWindowState(
    { ...saved, bounds: { x: -20, y: -40, width: 2000, height: 1500 } },
    [primary],
  );
  assert.deepEqual(clipped.bounds, primary);
});
