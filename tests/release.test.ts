import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { trustedRenderer, productionCsp } from "../src/main/security.ts";
import { readWorkspaceFile } from "../src/runner/files.ts";
import { collectArtifacts } from "../src/runner/artifacts.ts";
import { ConnectionVault } from "../src/main/connections/vault.ts";
import { Store } from "../src/database/store.ts";
import { command, git } from "../src/runner/process.ts";
import { startBroker } from "../src/runner/broker.ts";
import { request } from "node:http";
import { randomUUID } from "node:crypto";

test("IPC only trusts the exact app document or configured dev entry", () => {
  const entry =
    "/Applications/루프리.app/Contents/Resources/app.asar/out/renderer/index.html";
  const url = new URL(`file://${entry}`).href;
  assert(trustedRenderer(url + "#settings", entry));
  for (const unsafe of [
    "file:///tmp/attack.html",
    url + "?extra=1",
    "https://attacker.invalid",
    "not a url",
  ])
    assert.equal(trustedRenderer(unsafe, entry), false);
  const dev = "http://127.0.0.1:4317/";
  assert(trustedRenderer(dev, entry, dev));
  for (const unsafe of [
    dev + "attack.html",
    "http://127.0.0.1:4317.evil.invalid/",
    "http://localhost:4317/",
    url,
  ])
    assert.equal(trustedRenderer(unsafe, entry, dev), false);
  assert.match(productionCsp, /connect-src 'none'/);
});

test(
  "bounded workspace reads reject FIFO, devices, oversized files, symlink parents and cancelled reads",
  { timeout: 5000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-file-boundary-"));
    try {
      const results = join(root, "test-results");
      await mkdir(results);
      await writeFile(join(results, "valid.json"), "{}");
      execFileSync("mkfifo", [join(results, "trap.json")]);
      await assert.rejects(
        readWorkspaceFile(root, "test-results/trap.json", 100),
        /一般|일반/,
      );
      const files = await collectArtifacts(root, 1);
      assert.deepEqual(
        files.map((x) => x.path),
        ["test-results/valid.json"],
      );
      await assert.rejects(
        readWorkspaceFile(root, "test-results/valid.json", 1),
        /크기/,
      );
      await symlink(results, join(root, "linked"));
      await assert.rejects(
        readWorkspaceFile(root, "linked/valid.json", 100),
        /경로/,
      );
      await assert.rejects(readWorkspaceFile(root, "../outside", 100), /경로/);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        readWorkspaceFile(
          root,
          "test-results/valid.json",
          100,
          controller.signal,
        ),
        { name: "AbortError" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("corrupt connection records are rejected without replacing the original file", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-corrupt-vault-"));
  try {
    const path = join(root, "connections.json");
    const original = JSON.stringify({ records: "invalid but parseable" });
    await writeFile(path, original);
    const vault = new ConnectionVault(path, {
      encrypt: Buffer.from,
      decrypt: (b) => b.toString(),
    });
    await assert.rejects(vault.init(), /원본 파일/);
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("idle PostgreSQL disconnect is handled and connection attempts are bounded", async () => {
  const store = new Store(
    "unused",
    "postgres://unused:unused@127.0.0.1:1/unused",
  );
  try {
    assert.doesNotThrow(() =>
      store.pool.emit("error", Error("fixture disconnect")),
    );
    await assert.rejects(store.init());
  } finally {
    await store.close();
  }
});

test("truncated Git output cannot silently omit files from review or protected checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-large-git-"));
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Fixture");
    await git(root, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(root, "large.txt"), "x".repeat(210000));
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fixture");
    await assert.rejects(git(root, "show", "HEAD:large.txt"), /검토 한도/);
    const output = await command(process.execPath, [
      "-e",
      "process.stdout.write('x'.repeat(210000))",
    ]);
    assert.equal(output.code, 0);
    assert.equal(output.outputTruncated, true);
    assert.equal(output.output.length, 200000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Korean text survives UTF-8 chunk boundaries in agent output and model requests", async () => {
  const lines: string[] = [];
  const output = await command(
    process.execPath,
    [
      "-e",
      "const b=Buffer.from('한글 루프리\\n');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),30)",
    ],
    { onLine: (line) => lines.push(line) },
  );
  assert.equal(output.output, "한글 루프리\n");
  assert.deepEqual(lines, ["한글 루프리"]);
  let forwarded = "";
  const controller = new AbortController();
  const broker = await startBroker(
    {
      id: randomUUID(),
      name: "fixture",
      endpoint: "https://example.invalid",
      auth: "api-key",
      model: "fixture",
      version: 1,
      hasKey: true,
    },
    "fixture-key",
    "fixture-token",
    controller.signal,
    async (_url, init) => {
      forwarded = String(init?.body);
      return new Response("{}", { status: 200 });
    },
  );
  try {
    const body = JSON.stringify({
      model: "fixture",
      messages: [{ role: "user", content: "한글 루프리" }],
    });
    const bytes = Buffer.from(body);
    const split = bytes.indexOf(Buffer.from("한")) + 1;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: broker.port,
          method: "POST",
          path: "/v1/messages",
          headers: {
            "x-api-key": "fixture-token",
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.write(bytes.subarray(0, split));
      setTimeout(() => req.end(bytes.subarray(split)), 30);
    });
    assert.equal(status, 200);
    assert.equal(forwarded, body);
  } finally {
    broker.close();
  }
});
