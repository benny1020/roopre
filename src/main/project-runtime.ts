import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryRuntime } from "../shared/runtime.ts";

export async function detectRepositoryRuntime(
  repositoryPath: string,
): Promise<RepositoryRuntime> {
  const entries = new Set(await readdir(repositoryPath));
  const buildFile = entries.has("build.gradle.kts")
    ? "build.gradle.kts"
    : entries.has("build.gradle")
      ? "build.gradle"
      : undefined;
  if (!buildFile && !entries.has("gradlew")) return { runtime: "node" };
  let framework: RepositoryRuntime["framework"];
  if (buildFile) {
    const build = await readFile(join(repositoryPath, buildFile), "utf8");
    if (/org\.springframework\.boot|spring-boot/i.test(build))
      framework = "spring-boot";
  }
  return { runtime: "java-gradle", ...(framework ? { framework } : {}) };
}
