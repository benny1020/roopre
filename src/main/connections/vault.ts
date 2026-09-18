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
      "endpoint는 인증 정보·query·fragment 없는 HTTPS 기본 주소여야 합니다.",
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
          "연결 저장소를 읽지 못했습니다. 원본 파일을 보존하고 복구하세요.",
        );
    }
  }
  list() {
    return this.records.map((x) => ({ ...x.info }));
  }
  get(id: string) {
    const r = this.records.find((r) => r.info.id === id);
    if (!r) throw Error("AI 연결이 없습니다.");
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
      if (input.id && !old) throw Error("연결을 찾을 수 없습니다.");
      if (!old && !input.key) throw Error("API key를 입력하세요.");
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
      diagnostic = "연결 실패";
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
              401: "인증 실패: key와 인증 방식을 확인하세요.",
              403: "권한 없음: 모델 접근 권한을 확인하세요.",
              404: "API 경로 또는 모델을 확인하세요.",
              429: "요청 한도 또는 잔액을 확인하세요.",
            } as Record<number, string>
          )[response.status] ?? `모델 요청 실패 (HTTP ${response.status})`;
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
          ? "인증·모델 응답 확인. 스트리밍·도구 실행은 실제 실행 시 추가 검증합니다."
          : "Anthropic Messages 응답 규격이 아닙니다.";
      }
    } catch {
      diagnostic = "연결 실패: 주소·TLS·네트워크 또는 응답 규격을 확인하세요.";
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
