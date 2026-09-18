import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

// Nonblocking open + fstat prevents an agent-created FIFO/device from hanging
// cancellation or app shutdown. Limit actual bytes too, not just initial size.
export async function readWorkspaceFile(
  root: string,
  relativePath: string,
  limit: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const base = await realpath(root);
  const target = resolve(base, relativePath);
  if (!target.startsWith(base + sep) || (await realpath(target)) !== target)
    throw Error("일반 파일 경로만 읽을 수 있습니다.");
  const file = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw Error("일반 파일이 아니거나 파일 크기 한도를 넘었습니다.");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      signal?.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw Error("파일 크기 한도를 넘었습니다.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await file.close();
  }
}
