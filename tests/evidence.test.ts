import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveArtifacts,
  checkedArtifact,
  collectArtifacts,
} from "../src/runner/artifacts.ts";
import { command } from "../src/runner/process.ts";
test("archived test evidence survives retries and rejects symlinks, traversal and tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-evidence-test-"));
  try {
    const checkout = join(root, "checkout"),
      results = join(checkout, "test-results"),
      archive = join(root, "archive");
    await mkdir(results, { recursive: true });
    await writeFile(join(root, "outside.json"), "secret");
    await symlink(join(root, "outside.json"), join(results, "linked.json"));
    await writeFile(join(results, "result.json"), "first attempt");
    const files = await collectArtifacts(checkout, 1);
    assert.equal(files.length, 1);
    const [saved] = await archiveArtifacts(checkout, archive, files);
    await writeFile(join(results, "result.json"), "second attempt");
    assert.equal(
      await readFile(
        await checkedArtifact(archive, saved.path, saved.hash),
        "utf8",
      ),
      "first attempt",
    );
    await assert.rejects(
      checkedArtifact(archive, "../outside.json", saved.hash),
      /경로/,
    );
    await writeFile(join(archive, saved.path), "tampered");
    await assert.rejects(
      checkedArtifact(archive, saved.path, saved.hash),
      /변경/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Gradle HTML and JUnit XML reports are retained as execution evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-gradle-evidence-"));
  try {
    const reports = join(root, "build", "reports", "tests", "test");
    const results = join(root, "build", "test-results", "test");
    await mkdir(reports, { recursive: true });
    await mkdir(results, { recursive: true });
    await writeFile(join(reports, "index.html"), "<html>passed</html>");
    await writeFile(join(results, "TEST-example.xml"), "<testsuite />");
    assert.deepEqual(
      (await collectArtifacts(root, 1)).map((file) => file.path).sort(),
      [
        "build/reports/tests/test/index.html",
        "build/test-results/test/TEST-example.xml",
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("terminated commands cannot report success even if their signal handler exits zero", async () => {
  const abort = new AbortController();
  const result = await command(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>process.exit(0));console.log('ready');setInterval(()=>{},1000)",
    ],
    {
      signal: abort.signal,
      timeout: 5000,
      onLine: (line) => {
        if (line === "ready") abort.abort();
      },
    },
  );
  assert.equal(result.code, -1);
});
