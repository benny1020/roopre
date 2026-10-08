import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { command, git } from "../src/runner/process.ts";
import { RunnerManager } from "../src/runner/manager.ts";
import { Store } from "../src/database/store.ts";
import type { ConnectionVault } from "../src/main/connections/vault.ts";
import { approvalBinding } from "../src/domain/runtime.ts";
import { approvedRun } from "./fixtures/approved-run.ts";

test(
  "real Java 21 multi-module Spring Boot/JUnit: isolated runner repairs failing assertion, verifies and cleans up (fixture agent)",
  { timeout: 720000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-spring-runner-"));
    const key = `spring-${randomUUID()}`;
    const tag = `roopre-spring-fixture:${randomUUID()}`;
    let store: Store | undefined, runner: RunnerManager | undefined;
    let runId = "";
    try {
      await cp(resolve("tests/fixtures/claude.cjs"), join(root, "claude.cjs"));
      await writeFile(
        join(root, "Dockerfile"),
        `FROM roopre-runner:0.3\nUSER root\nCOPY claude.cjs /opt/fixture-claude.cjs\nRUN rm -f /usr/bin/claude /usr/local/bin/claude && printf '#!/bin/sh\\nexec node /opt/fixture-claude.cjs "$@"\\n' > /usr/local/bin/claude && chmod +x /usr/local/bin/claude\nUSER pwuser\n`,
      );
      const build = await command("docker", ["build", "-t", tag, root], {
        timeout: 120000,
      });
      assert.equal(build.code, 0, build.output);
      const image = (
        await command("docker", [
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          tag,
        ])
      ).output.trim();
      const repo = join(root, "repo");
      await mkdir(join(repo, "api/src/main/java/fixture"), { recursive: true });
      await mkdir(join(repo, "api/src/test/java/fixture"), { recursive: true });
      await writeFile(
        join(repo, "settings.gradle.kts"),
        'rootProject.name = "fixture"\ninclude("api")\n',
      );
      await writeFile(
        join(repo, "build.gradle.kts"),
        'plugins { java; id("org.springframework.boot") version "3.5.0" apply false }\nallprojects { repositories { mavenCentral() } }\ntasks.named("help") { doLast { val block = ByteArray(1024 * 1024) { 65 }; gradle.gradleUserHomeDir.resolve("large-cache-fixture").outputStream().use { out -> repeat(600) { out.write(block) } } } }\n',
      );
      await writeFile(
        join(repo, "api/build.gradle.kts"),
        'plugins { java; id("org.springframework.boot") }\ndependencies { implementation(platform("org.springframework.boot:spring-boot-dependencies:3.5.0")); implementation("org.springframework.boot:spring-boot-starter"); testImplementation("org.springframework.boot:spring-boot-starter-test"); testRuntimeOnly("org.junit.platform:junit-platform-launcher") }\ntasks.test { useJUnitPlatform() }\n',
      );
      await writeFile(
        join(repo, "api/src/main/java/fixture/App.java"),
        "package fixture; import org.springframework.boot.autoconfigure.SpringBootApplication; import org.springframework.context.annotation.Bean; @SpringBootApplication public class App { @Bean Greeting greeting() { return new Greeting(); } }\n",
      );
      await writeFile(
        join(repo, "api/src/test/java/fixture/AppTest.java"),
        'package fixture; import org.junit.jupiter.api.Test; import org.springframework.boot.test.context.SpringBootTest; import org.springframework.beans.factory.annotation.Autowired; import static org.assertj.core.api.Assertions.assertThat; @SpringBootTest class AppTest { @Autowired Greeting greeting; @Test void greetingMatchesAcceptance() { assertThat(greeting.message()).isEqualTo("hello from fixture"); } }\n',
      );
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "Fixture");
      await git(repo, "config", "user.email", "fixture@example.invalid");
      await git(repo, "add", "-A");
      await git(repo, "commit", "-m", "baseline fixed Spring acceptance");
      const base = await git(repo, "rev-parse", "HEAD");
      const fixedTest = await readFile(
        join(repo, "api/src/test/java/fixture/AppTest.java"),
        "utf8",
      );
      const fixture = approvedRun(key, {
        repositoryPath: repo,
        baseCommit: base,
        runtime: "java-gradle",
        image,
        checks: [
          {
            name: "typecheck",
            argv: ["gradle", "--offline", "--no-daemon", "classes"],
            timeoutSeconds: 180,
          },
          {
            name: "test",
            argv: [
              "sh",
              "-c",
              'test ! -e "$GRADLE_USER_HOME/agent-leak" && gradle --offline --no-daemon test',
            ],
            timeoutSeconds: 240,
          },
        ],
        timeoutMinutes: 10,
        repairLimit: 1,
      });
      fixture.f.designs[0].requirements =
        "AC01 JAVA_SPRING_FIXTURE greeting bean returns hello from fixture";
      fixture.f.designs[0].hash = createHash("sha256")
        .update(
          fixture.f.designs[0].body + "\n" + fixture.f.designs[0].requirements,
        )
        .digest("hex");
      // Disposable test approval is tied to this fixture, never a human workspace.
      fixture.f.designs[0].decisions[0].binding = approvalBinding(
        fixture.w,
        fixture.f,
      );
      fixture.run.runtime!.binding = approvalBinding(fixture.w, fixture.f);
      fixture.run.status = "queued";
      delete fixture.run.runtime!.worktree;
      delete fixture.run.runtime!.branch;
      delete fixture.run.runtime!.head;
      fixture.run.runtime!.terminationConfirmed = undefined;
      runId = fixture.run.id;
      store = new Store(key, undefined, "local-owner", () => fixture.w);
      await store.init();
      await store.mutate((w) => {
        const f = w.features[0];
        f.designs[0].decisions[0].binding = approvalBinding(w, f);
        w.runs[0].runtime!.binding = approvalBinding(w, f);
      });
      const vault = {
        get: () => ({
          info: {
            id: fixture.run.runtime!.profile.connectionId,
            name: "Fixture",
            endpoint: "https://invalid.example",
            auth: "api-key",
            model: "fixture-model",
            version: 1,
            hasKey: true,
            testStatus: "passed",
          },
          key: "fixture-no-provider-call",
        }),
      } as unknown as ConnectionVault;
      runner = new RunnerManager(
        store,
        vault,
        join(root, "runs"),
        resolve("resources"),
      );
      await runner.execute(runId, new AbortController());
      const result = (await store.read("owner")).runs[0];
      assert.equal(
        result.status,
        "ready_for_merge",
        JSON.stringify(result, null, 2),
      );
      assert.equal(
        result.runtime!.attempt,
        2,
        "a real failed JUnit assertion must trigger repair",
      );
      assert(
        result.runtime!.evidence.some(
          (e) => e.name === "test" && e.status === "failed",
        ),
      );
      assert(
        result.runtime!.evidence.some(
          (e) => e.name === "test" && e.status === "passed",
        ),
      );
      const report = await readFile(
        join(
          result.runtime!.worktree!,
          "api/build/test-results/test/TEST-fixture.AppTest.xml",
        ),
        "utf8",
      );
      assert.match(report, /tests="1"/);
      assert.match(report, /failures="0"/);
      assert.equal(
        await readFile(
          join(
            result.runtime!.worktree!,
            "api/src/test/java/fixture/AppTest.java",
          ),
          "utf8",
        ),
        fixedTest,
      );
      assert.equal(await git(repo, "rev-parse", "HEAD"), base);
      assert.equal(result.runtime!.terminationConfirmed, true);
      assert.equal(
        (
          await command("docker", [
            "volume",
            "ls",
            "-q",
            "--filter",
            `label=roopre.run=${runId}`,
          ])
        ).output.trim(),
        "",
      );
    } finally {
      await runner?.stop();
      if (runId) await runner?.cleanup(runId);
      if (store) {
        for (const table of ["commands", "events"])
          await store.pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
            key,
          ]);
        await store.pool.query("DELETE FROM workspaces WHERE id=$1", [key]);
        await store.close();
      }
      await command("docker", ["image", "rm", tag]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
