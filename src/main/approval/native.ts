import { execFile } from "node:child_process";
import { promisify } from "node:util";
export async function authenticateOwner(helper: string, reason: string) {
  try {
    const r = await promisify(execFile)(helper, [reason], {
      timeout: 125000,
      maxBuffer: 4096,
    });
    if (r.stdout.trim() !== "authenticated") throw Error();
  } catch {
    throw new Error(
      "본인 확인이 취소됐거나 사용할 수 없습니다. macOS 로그인 암호/Touch ID 설정을 확인하세요.",
    );
  }
}
