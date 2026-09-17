import { execFileSync } from "node:child_process";
import { packager } from "@electron/packager";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const metadata = JSON.parse(await readFile("package.json", "utf8"));
const staging = await mkdtemp(join(tmpdir(), "roopre-package-"));
try {
  // Stage desktop runtime and its external PG/zod dependencies, never the working tree.
  await cp("resources", join(staging, "resources"), { recursive: true });
  await cp("out", join(staging, "out"), { recursive: true });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify(
      {
        name: metadata.name,
        version: metadata.version,
        type: metadata.type,
        description: metadata.description,
        main: metadata.main,
        dependencies: {
          pg: metadata.dependencies.pg,
          zod: metadata.dependencies.zod,
        },
      },
      null,
      2,
    ),
  );
  execFileSync(
    "npm",
    ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: staging, stdio: "inherit" },
  );
  const result = await packager({
    extraResource: [
      resolve("resources/bin/roopre-approve"),
      resolve("resources/runner-proxy.cjs"),
    ],
    dir: staging,
    name: metadata.productName,
    icon: resolve("resources/icon.icns"),
    extendInfo: { CFBundleIconFile: "roopre.icns" },
    platform: "darwin",
    arch: "arm64",
    electronVersion: metadata.devDependencies.electron,
    out: resolve("release"),
    overwrite: true,
    prune: false,
    asar: true,
    appBundleId: "dev.roopre.desktop",
  });
  console.log(result.join("\n"));
} finally {
  await rm(staging, { recursive: true, force: true });
}
