import { z } from "zod";
import { mkdir, mkdtemp, rename, rm, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readWorkspaceFile } from "../../runner/files.ts";
import { command } from "../../runner/process.ts";
import { packageDigest } from "../../domain/harness-package.ts";
import {
  packageFiles,
  readPackageFiles,
  type HarnessPackage,
  type PackageSource,
} from "../../shared/harness-package.ts";
const maxBytes = 4_000_000;
function limited(read: (path: string) => Promise<string>) {
  let count = 0,
    bytes = 0;
  return async (path: string) => {
    if (++count > 1000) throw Error("하네스 파일 개수 한도를 넘었습니다.");
    const text = await read(path);
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes)
      throw Error("하네스 전체 크기는 4 MB 이내여야 합니다.");
    return text;
  };
}
export async function importPackageFolder(root: string, verifyLock = true) {
  const pack = await readPackageFiles(
    limited(async (path) =>
      (
        await readWorkspaceFile(
          root,
          path,
          path === "harness.json" ? 180000 : 80000,
        )
      ).toString("utf8"),
    ),
  );
  if (verifyLock) {
    try {
      await lstat(join(root, "harness.lock.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return pack;
      throw e;
    }
    validatePackageLock(
      JSON.parse(
        (await readWorkspaceFile(root, "harness.lock.json", 10000)).toString(
          "utf8",
        ),
      ),
      pack,
    );
  }
  return pack;
}
export async function exportPackageFolder(
  parent: string,
  input: HarnessPackage,
) {
  const files = {
    ...packageFiles(input),
    "harness.lock.json": JSON.stringify(packageLock(input), null, 2) + "\n",
  };
  const total = Object.values(files).reduce(
    (n, s) => n + Buffer.byteLength(s),
    0,
  );
  if (total > maxBytes || Object.keys(files).length > 1000)
    throw Error("하네스 패키지 크기/파일 수 한도를 넘었습니다.");
  for (const [path, text] of Object.entries(files))
    if (Buffer.byteLength(text) > (path === "harness.json" ? 180000 : 80000))
      throw Error("하네스 파일 크기 한도를 넘었습니다.");
  const temp = await mkdtemp(join(parent, ".roopre-export-"));
  const target = join(
    parent,
    `${input.id}-${input.version}-${randomUUID().slice(0, 8)}`,
  );
  try {
    for (const [path, text] of Object.entries(files)) {
      const full = join(temp, path);
      await mkdir(join(full, ".."), { recursive: true, mode: 0o700 });
      await writeFile(full, text, { flag: "wx", mode: 0o600 });
    }
    await rename(temp, target);
    return target;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
export function validateGitSource(input: { url: string; ref: string }) {
  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("토큰이 없는 HTTPS Git 주소를 사용하세요.");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,150}$/.test(input.ref) ||
    input.ref.includes("..")
  )
    throw Error("브랜치·태그 또는 commit을 확인하세요.");
  return { url: url.toString(), ref: input.ref };
}
// No checkout, hooks, submodules, smudge filters or repository commands are run.
// Disable global Git config; only macOS's standard credential helper is allowed.
export async function importPackageGit(input: { url: string; ref: string }) {
  const { url, ref } = validateGitSource(input);
  const root = await mkdtemp(join(tmpdir(), "roopre-harness-git-"));
  const git = async (...args: string[]) => {
    const r = await command(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "http.followRedirects=false",
        "-c",
        "credential.helper=" +
          (process.platform === "darwin" ? "osxkeychain" : ""),
        ...args,
      ],
      {
        cwd: root,
        timeout: 60000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_LFS_SKIP_SMUDGE: "1",
        },
      },
    );
    if (r.code !== 0 || r.outputTruncated)
      throw Error(
        "Git 표준을 읽지 못했습니다. 주소·ref·macOS Git 자격 증명 또는 폴더 가져오기를 확인하세요.",
      );
    return r.output;
  };
  try {
    await git("init", "--bare", "--template=");
    await git(
      "fetch",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      url,
      ref,
    );
    const commit = (await git("rev-parse", "FETCH_HEAD^{commit}")).trim();
    if (!/^[a-f0-9]{40}$/.test(commit))
      throw Error("지원하지 않는 Git commit입니다.");
    const pack = await readPackageGitTree(git, commit);
    return {
      package: pack,
      digest: packageDigest(pack),
      source: { kind: "git", url, commit } as PackageSource,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function readPackageGitTree(
  git: (...args: string[]) => Promise<string>,
  commit: string,
) {
  const pack = await readPackageFiles(
    limited(async (path) => {
      const mode = await git("ls-tree", commit, "--", path);
      if (
        !/^100644 blob [a-f0-9]{40}\t/.test(mode) ||
        mode.trimEnd().slice(mode.indexOf("\t") + 1) !== path
      )
        throw Error("일반 하네스 파일만 허용합니다.");
      const result = await git("show", `${commit}:${path}`);
      if (
        Buffer.byteLength(result) > (path === "harness.json" ? 180000 : 80000)
      )
        throw Error("하네스 파일이 너무 큽니다.");
      return result;
    }),
  );
  const lockEntry = await git("ls-tree", commit, "--", "harness.lock.json");
  if (lockEntry.trim()) {
    if (!/^100644 blob [a-f0-9]{40}\t/.test(lockEntry))
      throw Error("lock은 일반 파일이어야 합니다.");
    validatePackageLock(
      JSON.parse(await git("show", `${commit}:harness.lock.json`)),
      pack,
    );
  }
  return pack;
}

export function packageLock(p: HarnessPackage) {
  return {
    schema: "roopre.harness-lock/v1",
    packageId: p.id,
    version: p.version,
    digest: packageDigest(p),
  };
}
export function validatePackageLock(input: unknown, p: HarnessPackage) {
  const expected = packageLock(p);
  z.object({
    schema: z.literal(expected.schema),
    packageId: z.literal(expected.packageId),
    version: z.literal(expected.version),
    digest: z.literal(expected.digest),
  })
    .strict()
    .parse(input);
}
export async function writePackageLock(root: string, p: HarnessPackage) {
  const file = join(root, "harness.lock.json");
  try {
    const stat = await lstat(file);
    if (!stat.isFile()) throw Error("lock은 일반 파일이어야 합니다.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const temp = join(root, `.harness-lock-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(packageLock(p), null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
