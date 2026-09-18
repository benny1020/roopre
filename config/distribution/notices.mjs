import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";

export async function writeNotices(destination) {
  const groups = JSON.parse(
    execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
      encoding: "utf8",
    }),
  );
  const inventory = [];
  const notices = [
    "Roopre production dependencies\nElectron/Chromium notices are also included in the Electron distribution.\n",
  ];
  for (const packages of Object.values(groups)) {
    for (const pkg of packages) {
      inventory.push({
        name: pkg.name,
        versions: pkg.versions,
        license: pkg.license,
        homepage: pkg.homepage,
      });
      notices.push(
        `\n--- ${pkg.name} ${pkg.versions.join(", ")} (${pkg.license}) ---\n`,
      );
      for (const directory of pkg.paths) {
        const files = (await readdir(directory)).filter((name) =>
          /^(license|licence|copying|notice)(\.|$)/i.test(name),
        );
        for (const name of files) {
          const path = join(directory, name);
          const stat = await lstat(path);
          if (stat.isFile() && stat.size < 2_000_000)
            notices.push(await readFile(path, "utf8"));
        }
      }
    }
  }
  // Never serialize pnpm's local filesystem paths into distributable reports.
  await writeFile(
    join(destination, "dependency-inventory.json"),
    JSON.stringify(inventory, null, 2),
  );
  await writeFile(
    join(destination, "third-party-notices.txt"),
    notices.join("\n"),
  );
}
