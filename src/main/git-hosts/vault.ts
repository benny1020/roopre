import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  gitHostConnectionInputSchema,
  validateGitHostEndpoint,
  type GitHostConnectionInfo,
  type GitHostConnectionInput,
} from "../../shared/git-host.ts";
import type { Cipher } from "../connections/vault.ts";

type Record = { info: GitHostConnectionInfo; sealed: string };
const recordsSchema = z
  .array(
    z.object({
      info: gitHostConnectionInputSchema.omit({ token: true }).extend({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        hasToken: z.literal(true),
        testedAt: z.string().datetime().optional(),
        testStatus: z.enum(["passed", "failed"]).optional(),
        diagnostic: z.string().max(2000).optional(),
      }),
      sealed: z
        .string()
        .min(1)
        .max(50000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    }),
  )
  .max(100);

export class GitHostVault {
  private records: Record[] = [];
  private chain = Promise.resolve();
  constructor(
    private path: string,
    private cipher: Cipher,
  ) {}
  async init() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.size > 6_000_000) throw Error("Invalid vault");
      this.records = recordsSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
      for (const record of this.records)
        validateGitHostEndpoint(record.info.endpoint);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error(
          "Git host connection store could not be read. Preserve the original file and recover it.",
        );
    }
  }
  list() {
    return this.records.map((r) => ({ ...r.info }));
  }
  get(id: string) {
    const record = this.records.find((r) => r.info.id === id);
    if (!record) throw Error("No Git host connection configured.");
    return {
      info: { ...record.info },
      token: this.cipher.decrypt(Buffer.from(record.sealed, "base64")),
    };
  }
  private async change(fn: () => void) {
    const work = this.chain.then(async () => {
      const previous = structuredClone(this.records);
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        fn();
        recordsSchema.parse(this.records);
        await writeFile(temp, JSON.stringify(this.records), { mode: 0o600 });
        await rename(temp, this.path);
      } catch (error) {
        this.records = previous;
        throw error;
      } finally {
        await rm(temp, { force: true }).catch(() => {});
      }
    });
    this.chain = work.catch(() => {});
    await work;
  }
  async save(raw: GitHostConnectionInput) {
    const input = gitHostConnectionInputSchema.parse(raw);
    const endpoint = validateGitHostEndpoint(input.endpoint);
    const id = input.id ?? randomUUID();
    await this.change(() => {
      const old = this.records.find((r) => r.info.id === id);
      if (input.id && !old) throw Error("Git host connection not found.");
      if (!old && !input.token) throw Error("Enter an access token.");
      const info: GitHostConnectionInfo = {
        id,
        name: input.name,
        kind: input.kind,
        host: input.host,
        endpoint,
        version: (old?.info.version ?? 0) + 1,
        hasToken: true,
      };
      this.records = this.records.filter((r) => r.info.id !== id);
      this.records.push({
        info,
        sealed: (input.token
          ? this.cipher.encrypt(input.token)
          : Buffer.from(old!.sealed, "base64")
        ).toString("base64"),
      });
    });
    return this.list();
  }
  async remove(id: string) {
    await this.change(() => {
      this.records = this.records.filter((r) => r.info.id !== id);
    });
    return this.list();
  }
  async test(id: string) {
    const { info, token } = this.get(id);
    let passed = false;
    let diagnostic = "Connection failed";
    try {
      const url =
        info.kind === "github"
          ? `${validateGitHostEndpoint(info.endpoint)}/user`
          : `${validateGitHostEndpoint(info.endpoint).replace(/\/api\/v4$/, "")}/api/v4/user`;
      const response = await fetch(url, {
        headers:
          info.kind === "github"
            ? {
                authorization: `Bearer ${token}`,
                accept: "application/vnd.github+json",
              }
            : { "private-token": token },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      passed = response.ok;
      diagnostic = passed
        ? "Authentication and user lookup verified."
        : ({
            401: "Authentication failed. Check the token.",
            403: "Access denied. Check token scopes and instance policies.",
            404: "Check the API endpoint.",
          }[response.status] ?? `Connection failed (HTTP ${response.status})`);
      await response.body?.cancel();
    } catch {
      diagnostic = "Connection failed. Check the URL, TLS and network.";
    }
    await this.change(() => {
      const current = this.records.find((r) => r.info.id === id);
      if (current && current.info.version === info.version)
        Object.assign(current.info, {
          testedAt: new Date().toISOString(),
          testStatus: passed ? "passed" : "failed",
          diagnostic,
        });
    });
    return this.list();
  }
}
