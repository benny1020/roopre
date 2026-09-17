import {
  readdir,
  lstat,
  readFile,
  realpath,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep, dirname } from "node:path";
import { createHash } from "node:crypto";
export async function collectArtifacts(checkout: string, attempt: number) {
  const files: {
    path: string;
    hash: string;
    bytes: number;
    attempt: number;
  }[] = [];
  async function scan(path: string, depth: number) {
    if (depth > 5 || files.length >= 100) return;
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= 100) break;
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await scan(child, depth + 1);
      else if (/\.(png|webm|zip|json|html)$/.test(entry.name)) {
        const size = (await lstat(child)).size;
        if (size <= 20_000_000) {
          files.push({
            path: relative(checkout, child),
            hash: createHash("sha256")
              .update(await readFile(child))
              .digest("hex"),
            bytes: size,
            attempt,
          });
        }
      }
    }
  }
  for (const dir of [
    ".roopre-artifacts",
    "test-results",
    "playwright-report",
  ]) {
    const path = join(checkout, dir);
    try {
      if ((await lstat(path)).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    await scan(path, 0);
  }
  return files;
}
export async function checkedArtifact(
  checkout: string,
  path: string,
  hash: string,
) {
  const root = await realpath(checkout);
  const target = await realpath(resolve(root, path));
  if (!target.startsWith(root + sep))
    throw Error("산출물 경로가 올바르지 않습니다.");
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size > 20_000_000)
    throw Error("산출물을 열 수 없습니다.");
  if (
    createHash("sha256")
      .update(await readFile(target))
      .digest("hex") !== hash
  )
    throw Error("산출물이 변경됐습니다. 해당 실행의 원본 근거를 확인하세요.");
  return target;
}

export async function archiveArtifacts(
  checkout: string,
  destination: string,
  files: Awaited<ReturnType<typeof collectArtifacts>>,
) {
  const archived = [];
  for (const file of files) {
    const source = await checkedArtifact(checkout, file.path, file.hash);
    const path = join(`attempt-${file.attempt}`, file.path);
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, await readFile(source), { mode: 0o600 });
    archived.push({ ...file, path });
  }
  return archived;
}
