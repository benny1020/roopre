import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepositoryRuntime } from "../src/main/project-runtime.ts";
import {
  defaultChecksForRuntime,
  runnerImageForRuntime,
} from "../src/shared/runtime.ts";

test("detects Gradle and Spring Boot repositories and provides fixed Java checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-runtime-"));
  try {
    assert.deepEqual(await detectRepositoryRuntime(root), { runtime: "node" });
    await writeFile(
      join(root, "build.gradle.kts"),
      'plugins { id("org.springframework.boot") version "3.5.0" }',
    );
    assert.deepEqual(await detectRepositoryRuntime(root), {
      runtime: "java-gradle",
      framework: "spring-boot",
    });
    assert.deepEqual(defaultChecksForRuntime("java-gradle"), [
      {
        name: "typecheck",
        argv: ["gradle", "--no-daemon", "classes"],
        timeoutSeconds: 600,
      },
      {
        name: "test",
        argv: ["gradle", "--no-daemon", "test"],
        timeoutSeconds: 900,
      },
    ]);
    assert.equal(runnerImageForRuntime("java-gradle"), "roopre-runner:0.3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
