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
      "Authentication was cancelled or unavailable. Check your macOS password or Touch ID settings.",
    );
  }
}
