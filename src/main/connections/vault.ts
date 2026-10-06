import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { z } from "zod";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  connectionInputSchema,
  type ConnectionInfo,
  type ConnectionInput,
} from "../../shared/runtime.ts";
export function validateEndpoint(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error(
      "Endpoint must be an HTTPS base URL without credentials, query parameters or fragments.",
    );
  return u.href.replace(/\/$/, "");
}
export function modelUrl(endpoint: string) {
  return `${validateEndpoint(endpoint).replace(/\/v1$/, "")}/v1/messages`;
}
export type Cipher = {
  encrypt: (s: string) => Buffer;
  decrypt: (b: Buffer) => string;
};
type VaultRecord = { info: ConnectionInfo; sealed: string };
const recordsSchema = z
  .array(
    z.object({
      info: connectionInputSchema.omit({ key: true }).extend({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        hasKey: z.literal(true),
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
  .max(100)
  .refine((rows) => new Set(rows.map((r) => r.info.id)).size === rows.length);
export class ConnectionVault {
  private records: VaultRecord[] = [];
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
      const records = recordsSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
      for (const record of records) validateEndpoint(record.info.endpoint);
      this.records = records;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error(
          "Connection store could not be read. Preserve the original file and recover it.",
        );
    }
  }
  list() {
    return this.records.map((x) => ({ ...x.info }));
  }
  get(id: string) {
    const r = this.records.find((r) => r.info.id === id);
    if (!r) throw Error("No AI connection configured.");
    return {
      info: { ...r.info },
      key: this.cipher.decrypt(Buffer.from(r.sealed, "base64")),
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
      } catch (e) {
        this.records = previous;
        throw e;
      } finally {
        await rm(temp, { force: true }).catch(() => {});
      }
    });
    this.chain = work.catch(() => {});
    await work;
  }
  async save(raw: ConnectionInput) {
    const input = connectionInputSchema.parse(raw);
    const endpoint = validateEndpoint(input.endpoint);
    const id = input.id ?? randomUUID();
    await this.change(() => {
      const old = this.records.find((r) => r.info.id === id);
      if (input.id && !old) throw Error("Connection not found.");
      if (!old && !input.key) throw Error("Enter an API key.");
      const sealed = input.key
        ? this.cipher.encrypt(input.key).toString("base64")
        : old!.sealed;
      const info: ConnectionInfo = {
        id,
        name: input.name,
        endpoint,
        auth: input.auth,
        model: input.model,
        version: (old?.info.version ?? 0) + 1,
        hasKey: true,
      };
      this.records = this.records.filter((r) => r.info.id !== id);
      this.records.push({ info, sealed });
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
    const { info, key } = this.get(id);
    let passed = false,
      diagnostic = "Connection failed";
    try {
      const response = await fetch(modelUrl(info.endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(info.auth === "api-key"
            ? { "x-api-key": key }
            : { authorization: `Bearer ${key}` }),
        },
        body: JSON.stringify({
          model: info.model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply OK." }],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        diagnostic =
          (
            {
              401: "Authentication failed. Check the key and authentication method.",
              403: "Access denied. Check model permissions.",
              404: "Check the API path and model.",
              429: "Check request limits and account balance.",
            } as Record<number, string>
          )[response.status] ??
          `Model request failed (HTTP ${response.status})`;
        await response.body?.cancel();
      } else {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let body = "";
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          body += decoder.decode(r.value, { stream: true });
          if (body.length > 64000) {
            await reader.cancel();
            throw Error();
          }
        }
        const data = JSON.parse(body + decoder.decode());
        passed = data.type === "message" && Array.isArray(data.content);
        diagnostic = passed
          ? "Authentication and model response verified. Streaming and tool execution are checked during a run."
          : "Response is not Anthropic Messages-compatible.";
      }
    } catch {
      diagnostic =
        "Connection failed. Check the URL, TLS, network and response format.";
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
