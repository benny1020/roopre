import { packager } from "@electron/packager";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const metadata = JSON.parse(await readFile("package.json", "utf8"));
const staging = await mkdtemp(join(tmpdir(), "roopre-package-"));
try {
  // The desktop is fully bundled; the separately hosted API and its dependencies
  // must not be shipped. Stage only runtime output, never the working tree.
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
      },
      null,
      2,
    ),
  );
  const result = await packager({
    dir: staging,
    name: "Roopre",
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
