import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepositoryRuntime } from "../src/main/project-runtime.ts";
import {
  defaultChecksForRuntime,
  runnerImageForRuntime,
} from "../src/shared/runtime.ts";
import {
  discoverRunnerConfigPaths,
  gradlePreparationCommand,
  isProtectedRunnerPath,
  isRootRunnerConfig,
} from "../src/runner/manager.ts";

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

test("resolves Gradle test runtime dependencies without executing baseline tests", () => {
  assert.match(gradlePreparationCommand, /testRuntimeClasspath/);
  assert.match(gradlePreparationCommand, /testCompileClasspath/);
  assert.match(gradlePreparationCommand, /roopre-resolve\.gradle help/);
  assert.doesNotMatch(gradlePreparationCommand, /\bgradle\b[^\n]*\btest\b/);
});

test("protects Gradle build configuration and wrapper metadata from agent changes", () => {
  for (const path of [
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradle.properties",
    "gradle/wrapper/gradle-wrapper.properties",
    "gradle/libs.versions.toml",
    "app/build.gradle.kts",
  ])
    assert.equal(isProtectedRunnerPath(path), true, path);
  assert.equal(isRootRunnerConfig("build.gradle.kts"), true);
  assert.equal(isRootRunnerConfig("settings.gradle"), true);
  assert.equal(isProtectedRunnerPath("src/main/java/App.java"), false);
});

test("discovers new Gradle convention files without following symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "roopre-gradle-config-"));
  let outside: string | undefined;
  try {
    await writeFile(join(root, "settings.gradle.kts"), "");
    await writeFile(join(root, "build.gradle.kts"), "");
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app", "build.gradle.kts"), "");
    await mkdir(join(root, "gradle", "init"), { recursive: true });
    await writeFile(join(root, "gradle", "init", "quality.gradle.kts"), "");
    outside = await mkdtemp(join(tmpdir(), "roopre-gradle-outside-"));
    await writeFile(join(outside, "secret.gradle.kts"), "");
    await symlink(outside, join(root, "gradle", "init", "external"));
    assert.deepEqual((await discoverRunnerConfigPaths(root)).sort(), [
      "app/build.gradle.kts",
      "build.gradle.kts",
      "gradle/init/external",
      "gradle/init/quality.gradle.kts",
      "settings.gradle.kts",
    ]);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      ...(outside ? [rm(outside, { recursive: true, force: true })] : []),
    ]);
  }
});
