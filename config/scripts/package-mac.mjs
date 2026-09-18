import { execFileSync } from "node:child_process";
import { packager } from "@electron/packager";
import { flipFuses } from "@electron/fuses";
import { sign } from "@electron/osx-sign";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fuses } from "../distribution/fuses.mjs";
import { writeNotices } from "../distribution/notices.mjs";

const release = process.argv.includes("--release");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error(
    "Apple Silicon macOS에서 빌드하세요. 다른 아키텍처는 검증하지 않았습니다.",
  );
const identity = process.env.ROOPRE_SIGNING_IDENTITY;
const keychainProfile = process.env.ROOPRE_NOTARY_PROFILE;
if (
  release &&
  (!identity?.startsWith("Developer ID Application:") || !keychainProfile)
)
  throw Error(
    "배포 빌드는 ROOPRE_SIGNING_IDENTITY와 ROOPRE_NOTARY_PROFILE이 필요합니다. 미서명 빌드로 대체하지 않습니다.",
  );
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const temp = await mkdtemp(join(tmpdir(), "roopre-package-"));
const staging = join(temp, "app");
const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: "inherit", ...options });
try {
  // Isolated install: pnpm deploy can update the source workspace's install
  // state. Never run a production install against the developer's workspace.
  await mkdir(staging);
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    await cp(file, join(staging, file));
  await cp("out", join(staging, "out"), { recursive: true });
  await mkdir(join(staging, "resources"));
  for (const file of ["icon.png", "icon.icns"])
    await cp(join("resources", file), join(staging, "resources", file));
  run(
    "pnpm",
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--prod"],
    { cwd: staging },
  );
  for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
    await rm(join(staging, file));
  for (const file of [
    ".modules.yaml",
    ".pnpm-workspace-state-v1.json",
    ".pnpm/lock.yaml",
  ])
    await rm(join(staging, "node_modules", file), { force: true });
  const manifest = JSON.parse(
    await readFile(join(staging, "package.json"), "utf8"),
  );
  delete manifest.scripts;
  delete manifest.devDependencies;
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  const setup = join(temp, "setup");
  await mkdir(setup);
  await cp("resources/setup/README.md", join(setup, "README.md"));
  await cp("config/compose.yaml", join(setup, "compose.yaml"));
  await cp("config/runner.Dockerfile", join(setup, "runner.Dockerfile"));
  await writeNotices(setup);
  const out = resolve("release", metadata.version);
  const [folder] = await packager({
    extraResource: [
      resolve("resources/bin/roopre-approve"),
      resolve("resources/runner-proxy.cjs"),
      setup,
    ],
    dir: staging,
    name: metadata.productName,
    icon: resolve("resources/icon.icns"),
    extendInfo: { CFBundleIconFile: "roopre.icns" },
    platform: "darwin",
    arch: "arm64",
    electronVersion: metadata.devDependencies.electron,
    out,
    overwrite: true,
    prune: false,
    asar: true,
    appBundleId: "dev.roopre.desktop",
  });
  const app = join(folder, `${metadata.productName}.app`);
  await flipFuses(app, fuses);
  if (release) {
    await sign({
      app,
      identity,
      platform: "darwin",
      hardenedRuntime: true,
    });
    const submission = join(temp, "notarize.zip");
    run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      app,
      submission,
    ]);
    run("xcrun", [
      "notarytool",
      "submit",
      submission,
      "--keychain-profile",
      keychainProfile,
      "--wait",
    ]);
    run("xcrun", ["stapler", "staple", app]);
    run("xcrun", ["stapler", "validate", app]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  }
  run(process.execPath, ["config/scripts/verify-mac.mjs", app]);
  const archive = join(
    out,
    `roopre-${metadata.version}-macos-arm64-${release ? "notarized" : "unsigned"}.zip`,
  );
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
  const sha256 = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(
    `${archive}.sha256`,
    `${sha256}  ${archive.split("/").at(-1)}\n`,
  );
  await writeFile(
    join(out, "build-manifest.json"),
    JSON.stringify(
      {
        version: metadata.version,
        electron: metadata.devDependencies.electron,
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync(
          "git",
          ["status", "--porcelain", "--untracked-files=normal"],
          { encoding: "utf8" },
        ).trim(),
        lockfileSha256: createHash("sha256")
          .update(await readFile("pnpm-lock.yaml"))
          .digest("hex"),
        signedAndNotarized: release,
        archive: archive.split("/").at(-1),
        sha256,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    `검증된 ${release ? "서명·공증" : "개발용 미공증"} 패키지: ${archive}`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
