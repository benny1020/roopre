import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseGitRemote,
  validateGitHostEndpoint,
  type GitHostConnectionInfo,
} from "../src/shared/git-host.ts";
import { GitHostVault } from "../src/main/git-hosts/vault.ts";
import { GitHostAdapter } from "../src/main/git-hosts/adapter.ts";

const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join("")),
  decrypt: (value: Buffer) => [...value.toString()].reverse().join(""),
};
test("remote parser keeps GitLab subgroups and rejects credentials", () => {
  assert.deepEqual(parseGitRemote("git@gitlab.com:group/platform/api.git"), {
    url: "git@gitlab.com:group/platform/api.git",
    host: "gitlab.com",
    namespace: "group/platform",
    repository: "api",
    kind: "gitlab",
  });
  assert.deepEqual(parseGitRemote("https://github.com/acme/roopre.git"), {
    url: "https://github.com/acme/roopre.git",
    host: "github.com",
    namespace: "acme",
    repository: "roopre",
    kind: "github",
  });
  assert.equal(
    parseGitRemote("ssh://git@git.company.local/mobile/app.git").kind,
    undefined,
  );
  for (const value of [
    "http://gitlab.com/a/b",
    "https://token@gitlab.com/a/b",
    "ssh://root@gitlab.com/a/b",
    "git@github.com:only-one",
  ])
    assert.throws(() => parseGitRemote(value));
  for (const value of [
    "http://gitlab.com",
    "https://token@gitlab.com",
    "https://gitlab.com?token=x",
  ])
    assert.throws(() => validateGitHostEndpoint(value));
});
test("Git host vault persists encrypted tokens and never lists them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roopre-git-host-"));
  try {
    const path = join(dir, "vault.json");
    const vault = new GitHostVault(path, cipher);
    await vault.init();
    const list = await vault.save({
      name: "Corp GitLab",
      kind: "gitlab",
      host: "git.company.local",
      endpoint: "https://git.company.local",
      token: "git-host-secret",
    });
    assert.equal(JSON.stringify(list).includes("git-host-secret"), false);
    assert.equal(
      (await readFile(path, "utf8")).includes("git-host-secret"),
      false,
    );
    assert.equal(vault.get(list[0].id).token, "git-host-secret");
    await vault.save({ ...list[0], token: "replacement" });
    assert.equal(vault.get(list[0].id).token, "replacement");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("GitHub and GitLab adapters use provider paths and produce SHA snapshots", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const address = String(url);
    if (address.includes("/repos/acme/app") && !address.includes("/pulls"))
      return Response.json({
        full_name: "acme/app",
        html_url: "https://github.com/acme/app",
      });
    if (address.includes("/pulls"))
      return Response.json({
        number: 7,
        html_url: "https://github.com/acme/app/pull/7",
        state: "open",
        draft: true,
        head: { sha: "h".repeat(40) },
        base: { sha: "b".repeat(40) },
        mergeable: true,
      });
    if (address.includes("/projects/"))
      return Response.json({
        iid: 9,
        web_url: "https://git.example/group/app/-/merge_requests/9",
        state: "opened",
        draft: true,
        sha: "h".repeat(40),
        diff_refs: { base_sha: "b".repeat(40) },
        merge_status: "can_be_merged",
        path_with_namespace: "group/app",
      });
    return new Response("missing", { status: 404 });
  };
  const github: GitHostConnectionInfo = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "GitHub",
    kind: "github",
    host: "github.com",
    endpoint: "https://api.github.com",
    version: 1,
    hasToken: true,
  };
  const remote = parseGitRemote("https://github.com/acme/app.git");
  const change = await new GitHostAdapter(
    github,
    "secret",
    fakeFetch,
  ).createDraftChange({
    remote,
    head: "roopre/run",
    base: "main",
    title: "Draft",
    body: "Body",
  });
  assert.equal(change.id, "7");
  assert.match(calls.at(-1)!.url, /\/repos\/acme\/app\/pulls$/);
  assert.equal(
    (calls.at(-1)!.init!.headers as Record<string, string>).authorization,
    "Bearer secret",
  );
  const gitlab: GitHostConnectionInfo = {
    ...github,
    id: "00000000-0000-4000-8000-000000000002",
    name: "GitLab",
    kind: "gitlab",
    host: "git.example",
    endpoint: "https://git.example",
  };
  const gitlabRemote = parseGitRemote("git@git.example:group/app.git");
  const mr = await new GitHostAdapter(
    gitlab,
    "secret",
    fakeFetch,
  ).createDraftChange({
    remote: gitlabRemote,
    head: "roopre/run",
    base: "main",
    title: "Draft",
    body: "Body",
  });
  assert.equal(mr.id, "9");
  assert(
    calls.some((call) =>
      call.url.includes("/api/v4/projects/group%2Fapp/merge_requests"),
    ),
  );
});
