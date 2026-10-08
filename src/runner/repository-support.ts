import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Preparation currently locks a single package's dependencies. Reject unsupported layouts before model spend. */
export async function assertSupportedNodeRepository(root: string) {
  try {
    await lstat(join(root, "pnpm-workspace.yaml"));
    throw Error(
      "pnpm-workspace.yaml requires workspace-aware dependency preparation, which is not supported yet. Use a standalone locked package; no agent was started.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let pkg: Record<string, any>;
  try {
    pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (pkg.workspaces)
    throw Error(
      "package.json workspaces are not supported by single-package preparation. Use a standalone locked package; no agent was started.",
    );
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    for (const [name, version] of Object.entries(pkg[section] ?? {}))
      if (
        typeof version === "string" &&
        /^(workspace:|file:|link:|portal:|\.\.?\/|\/)/.test(version)
      )
        throw Error(
          `package.json ${section}.${name} uses a local dependency outside the preparation context. Use a standalone locked package; no agent was started.`,
        );
}
