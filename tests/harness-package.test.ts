import { command } from "../src/runner/process.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPackage } from "../src/shared/default-package.ts";
import {
  harnessPackageSchema,
  packageFiles,
  readPackageFiles,
  canonical,
} from "../src/shared/harness-package.ts";
import {
  importPackageFolder,
  exportPackageFolder,
  validateGitSource,
  writePackageLock,
  readPackageGitTree,
} from "../src/main/harness/files.ts";
import {
  applyPackage,
  packageDigest,
  exportProject,
} from "../src/domain/harness-package.ts";
import { emptyWorkspace } from "../src/database/initial.ts";
import { apply, effectivePolicy } from "../src/domain/index.ts";
import { resolveHarness } from "../src/shared/harness.ts";
import {
  HarnessLibrary,
  harnessApplyRequestId,
} from "../src/main/harness/library.ts";
import type { Command } from "../src/shared/contracts.ts";
import { policyBinding } from "../src/domain/runtime.ts";
function fixture() {
  const w = emptyWorkspace("package-test", "local-owner");
  const id = apply(w, "owner", {
    type: "create_project",
    name: "Package project",
    description: "",
    reviewerIds: ["owner"],
  }).entityId!;
  const p = w.projects.find((p) => p.id === id)!;
  const pack = defaultPackage();
  const input = (): Extract<Command, { type: "apply_harness_package" }> => ({
    type: "apply_harness_package",
    projectId: id,
    expectedRevision: w.revision,
    package: pack,
    profileId: "standard",
    bindings: {},
    source: { kind: "folder" },
  });
  return { w, p, pack, input };
}
test("standard package has seven real roles, strict references and directory scopes", () => {
  const p = defaultPackage();
  assert.equal(p.agents.length, 7);
  const bad = structuredClone(p);
  bad.profiles[0].assignments[0].agentId = "missing";
  assert.throws(() => harnessPackageSchema.parse(bad));
  bad.profiles[0].assignments = p.profiles[0].assignments.filter(
    (a) => a.stage !== "review",
  );
  assert.throws(() => harnessPackageSchema.parse(bad));
  for (const path of [
    "../outside/",
    "/absolute/",
    "a/../../b/",
    ".git/",
    "a\\b/",
    "src/**",
  ]) {
    const d = structuredClone(p);
    d.profiles[0].scopes = [
      {
        id: "checkout",
        name: "Checkout",
        paths: [path],
        instructions: "scope",
      },
    ];
    assert.throws(() => harnessPackageSchema.parse(d));
  }
  p.profiles[0].scopes = [
    {
      id: "checkout",
      name: "결제",
      paths: ["src/결제/", "tests/e2e/"],
      instructions: "scope",
    },
  ];
  assert.equal(harnessPackageSchema.parse(p).profiles[0].scopes.length, 1);
  assert.throws(() =>
    harnessPackageSchema.parse({ ...p, key: "must-not-import" }),
  );
});
test("Markdown folder export/import preserves exact effective content and never overwrites files", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-package-"));
  try {
    const p = defaultPackage();
    p.instructions += "\n유니코드와 `code`\n";
    p.profiles[0].scopes = [
      {
        id: "checkout",
        name: "결제",
        paths: ["src/checkout/"],
        instructions: "# 추가 기준",
      },
    ];
    const folder = await exportPackageFolder(root, p);
    assert.deepEqual(await importPackageFolder(folder), p);
    const second = await exportPackageFolder(root, p);
    assert.notEqual(folder, second);
    assert.equal(
      await readFile(join(folder, "policies/company.md"), "utf8"),
      p.instructions,
    );
    const encoded = JSON.stringify(packageFiles(p));
    assert(!encoded.includes("repositoryPath"));
    assert(!encoded.includes("connectionId"));
    await rm(join(folder, "agents/developer.md"));
    await symlink(
      join(second, "agents/developer.md"),
      join(folder, "agents/developer.md"),
    );
    await assert.rejects(() => importPackageFolder(folder));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("manifest references cannot escape the fixed layout and incomplete files fail closed", async () => {
  const files = packageFiles(defaultPackage());
  const manifest = JSON.parse(files["harness.json"]);
  manifest.definition.agents[0].instructions = { file: "../../credentials" };
  files["harness.json"] = JSON.stringify(manifest);
  const accessed: string[] = [];
  await assert.rejects(() =>
    readPackageFiles(async (p) => {
      accessed.push(p);
      if (!(p in files)) throw Error("missing");
      return files[p];
    }),
  );
  assert(!accessed.some((p) => p.includes("..")));
  const good = packageFiles(defaultPackage());
  delete good["agents/developer.md"];
  await assert.rejects(() =>
    readPackageFiles(async (p) => {
      if (!(p in good)) throw Error("missing");
      return good[p];
    }),
  );
});
test("project apply is atomic, scope-bound, stable across repeated imports and preserves the global policy", () => {
  const { w, p, pack, input } = fixture();
  const policy = structuredClone(w.policies);
  const other = apply(w, "owner", {
    type: "create_project",
    name: "Other",
    description: "",
    reviewerIds: ["owner"],
  }).entityId!;
  const otherBefore = structuredClone(w.projects.find((p) => p.id === other));
  pack.profiles[0].scopes = [
    {
      id: "checkout",
      name: "결제",
      paths: ["src/checkout/"],
      instructions: "package-scope-marker",
    },
  ];
  apply(w, "owner", input());
  const ids = Object.values(p.harness!.agents);
  assert.equal(ids.length, 7);
  assert.deepEqual(w.policies, policy);
  assert.deepEqual(
    w.projects.find((p) => p.id === other),
    otherBefore,
  );
  const agentVersions = structuredClone(w.agents);
  const installation = structuredClone(p.harness);
  apply(w, "owner", input());
  assert.deepEqual(w.agents, agentVersions);
  assert.deepEqual(p.harness, installation);
  assert.deepEqual(Object.values(p.harness!.agents), ids);
  assert.equal(new Set(w.agents!.map((a) => a.id)).size, 7);
  const fId = apply(w, "owner", {
    type: "create_feature",
    projectId: p.id,
    title: "Task",
    requirements: "AC01 work",
    template: "feature",
  }).entityId!;
  const f = w.features.find((f) => f.id === fId)!;
  const old = policyBinding(w, f);
  apply(w, "owner", {
    type: "set_feature_scope",
    featureId: f.id,
    expectedRevision: w.revision,
    scopeId: "checkout",
  });
  assert.notEqual(policyBinding(w, f), old);
  assert.match(effectivePolicy(w, f), /package-scope-marker/);
  assert.match(
    resolveHarness(w, p, f.harnessScope)!.agents[0].instructions,
    /package-scope-marker/,
  );
  assert.equal(p.harness!.digest, packageDigest(pack));
});
test("invalid connection mapping, stale state and same-version content changes cannot partially apply", () => {
  const { w, p, pack, input } = fixture();
  const before = canonical(w);
  pack.agents[0].connection = "designer-model";
  assert.throws(() => applyPackage(w, input()), /연결/);
  assert.equal(canonical(w), before);
  pack.agents[0].connection = "project";
  assert.throws(
    () => applyPackage(w, { ...input(), expectedRevision: 999 }),
    /변경/,
  );
  assert.equal(canonical(w), before);
  apply(w, "owner", input());
  const applied = canonical(w);
  pack.instructions += "changed";
  assert.throws(() => applyPackage(w, input()), /버전/);
  assert.equal(canonical(w), applied);
  const agent = w.agents!.find(
    (a) => a.id === Object.values(p.harness!.agents)[0],
  )!;
  assert.throws(
    () =>
      apply(w, "owner", {
        type: "save_agent",
        expectedRevision: agent.revision,
        agent: { ...agent, revision: agent.revision + 1 },
      }),
    /표준/,
  );
});
test("active/unconfirmed work blocks package replacement and exported data excludes machine credentials", () => {
  const { w, p, input } = fixture();
  apply(w, "owner", input());
  const id = apply(w, "owner", {
    type: "create_feature",
    projectId: p.id,
    title: "A",
    requirements: "AC01",
    template: "feature",
  }).entityId!;
  w.runs.push({
    id: "run-test",
    featureId: id,
    designId: "draft",
    status: "queued",
    reason: "",
    at: "",
    actorId: "owner",
    policyVersion: 1,
    effectivePolicy: "",
  });
  const before = canonical(w);
  assert.throws(() => applyPackage(w, input()), /종료/);
  assert.equal(canonical(w), before);
  const output = exportProject(w, p, {
    id: "company.test",
    name: "Shared",
    version: "1.0.0",
  });
  assert(!canonical(output).includes(p.id));
  assert.equal(output.agents.length, 7);
});
test("candidate snapshots cannot be changed by a renderer and Git inputs reject credentials and option injection", () => {
  const library = new HarnessLibrary();
  const c = library.add(defaultPackage(), { kind: "folder" });
  const digest = c.digest;
  c.package.instructions = "mutated";
  assert.equal(library.get(c.token).digest, digest);
  assert.notEqual(library.get(c.token).package.instructions, "mutated");
  for (const url of [
    "file:///repo",
    "https://user:secret@example.com/repo",
    "https://example.com/repo?token=secret",
  ])
    assert.throws(() => validateGitSource({ url, ref: "main" }));
  assert.throws(() =>
    validateGitSource({
      url: "https://example.com/repo",
      ref: "--upload-pack=evil",
    }),
  );
  assert.equal(
    validateGitSource({ url: "https://example.com/repo", ref: "v1.0.0" }).ref,
    "v1.0.0",
  );
});

test("edited Markdown requires an explicit lock update and imported connection aliases remain portable", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-lock-test-"));
  try {
    const folder = await exportPackageFolder(root, defaultPackage());
    await writeFile(
      join(folder, "policies/company.md"),
      "# Changed company policy",
    );
    await assert.rejects(() => importPackageFolder(folder));
    const changed = await importPackageFolder(folder, false);
    await writePackageLock(folder, changed);
    assert.deepEqual(await importPackageFolder(folder), changed);
    const { w, p, pack, input } = fixture();
    const id = "f878b315-f3a3-4d3a-9c51-84df4a2c424d";
    pack.agents[0].connection = "planning-model";
    apply(w, "owner", {
      ...input(),
      bindings: { "planning-model": { id, version: 2 } },
    });
    const exported = exportProject(w, p, {
      id: pack.id,
      version: "1.0.1",
      name: pack.name,
    });
    assert.equal(exported.agents[0].connection, "planning-model");
    assert(!canonical(exported).includes(id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one candidate can apply to multiple projects without request identity collisions", () => {
  const a = harnessApplyRequestId("candidate", {
    projectId: "a",
    expectedRevision: 1,
  });
  assert.equal(
    a,
    harnessApplyRequestId("candidate", { expectedRevision: 1, projectId: "a" }),
  );
  assert.notEqual(
    a,
    harnessApplyRequestId("candidate", { projectId: "b", expectedRevision: 1 }),
  );
  assert.notEqual(
    a,
    harnessApplyRequestId("candidate", { projectId: "a", expectedRevision: 2 }),
  );
});

test("real Git objects import a pinned package and reject symbolic Markdown entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-git-package-"));
  try {
    const p = defaultPackage();
    const folder = await exportPackageFolder(root, p);
    const git = async (...args: string[]) => {
      const r = await command(
        "git",
        ["-c", "core.hooksPath=/dev/null", ...args],
        { cwd: folder },
      );
      assert.equal(r.code, 0, r.output);
      assert(!r.outputTruncated);
      return r.output;
    };
    await git("init", "-b", "main");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Standard",
    );
    const commit = (await git("rev-parse", "HEAD")).trim();
    assert.deepEqual(await readPackageGitTree(git, commit), p);
    await writeFile(
      join(folder, "agents/developer.md"),
      "Uncommitted local changes",
    );
    assert.deepEqual(await readPackageGitTree(git, commit), p);
    await rm(join(folder, "agents/developer.md"));
    await symlink(
      "../policies/company.md",
      join(folder, "agents/developer.md"),
    );
    await git("add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Invalid symlink",
    );
    const invalid = (await git("rev-parse", "HEAD")).trim();
    await assert.rejects(() => readPackageGitTree(git, invalid), /일반 하네스/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
