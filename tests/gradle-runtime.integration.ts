import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command } from "../src/runner/process.ts";

test(
  "Java 21 Gradle runner compiles and tests a minimal Gradle project",
  { timeout: 240000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-gradle-runtime-"));
    try {
      await chmod(root, 0o777);
      await writeFile(
        join(root, "settings.gradle.kts"),
        'rootProject.name = "fixture"\n',
      );
      await writeFile(join(root, "build.gradle.kts"), "plugins { java }\n");
      const result = await command(
        "docker",
        [
          "run",
          "--rm",
          "--user",
          "pwuser",
          "--mount",
          `type=bind,src=${root},dst=/workspace`,
          "--workdir",
          "/workspace",
          "roopre-runner:0.3",
          "gradle",
          "--no-daemon",
          "--console=plain",
          "test",
        ],
        { timeout: 210000 },
      );
      assert.equal(result.code, 0, result.output);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
