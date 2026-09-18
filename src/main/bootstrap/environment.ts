import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  writeFile,
  rename,
  rm,
  lstat,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Cipher } from "../connections/vault.ts";
import { command } from "../../runner/process.ts";
import {
  onboardingSchema,
  type BootstrapStatus,
} from "../../shared/onboarding.ts";
const stateSchema = z.object({
  progress: onboardingSchema,
  database: z
    .object({ id: z.string().uuid(), sealed: z.string().min(1).max(20000) })
    .optional(),
});
export class Bootstrap {
  private state: z.infer<typeof stateSchema> = {
    progress: { version: 1, step: "connection", dismissed: false },
  };
  private busy = false;
  private stage = "시작 준비";
  private error = "";
  private controller?: AbortController;
  private chain = Promise.resolve();
  constructor(
    private root: string,
    private cipher: Cipher,
    private recipe: string,
    private connect: (url: string) => Promise<void>,
    private isConnected: () => boolean,
    private run: typeof command = command,
  ) {}
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      const path = join(this.root, "onboarding.json");
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 200000) throw Error("Invalid state");
      this.state = stateSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error(
          "시작 설정을 읽지 못했습니다. 기존 파일을 보존하고 복구하세요.",
        );
    }
  }
  status(): BootstrapStatus {
    return {
      connected: this.isConnected(),
      busy: this.busy,
      stage: this.stage,
      error: this.error,
      managed: !!this.state.database,
      progress: { ...this.state.progress },
    };
  }
  private persist() {
    const data = JSON.stringify(this.state);
    const job = this.chain.then(async () => {
      const temp = join(this.root, `state-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, data, { mode: 0o600, flag: "wx" });
        await rename(temp, join(this.root, "onboarding.json"));
      } finally {
        await rm(temp, { force: true });
      }
    });
    this.chain = job.catch(() => {});
    return job;
  }
  async progress(input: unknown) {
    const next = onboardingSchema.parse(input);
    const old = this.state.progress;
    // Preserve the draft for reopen/step-only calls from the app shell.
    const candidate = { ...next, draft: next.draft ?? old.draft };
    this.state.progress = candidate;
    try {
      await this.persist();
    } catch (e) {
      if (this.state.progress === candidate) this.state.progress = old;
      throw e;
    }
    return this.status();
  }
  async restore(legacyUrl: string) {
    this.busy = true;
    try {
      if (!this.state.database) {
        try {
          await this.connect(legacyUrl);
          this.stage = "기존 환경 연결됨";
        } catch {
          this.stage = "환경 준비 필요";
        }
      } else {
        // Existing managed data is started only on the explicit Prepare action.
        try {
          await this.connect(await this.databaseUrl());
          this.stage = "로컬 환경 연결됨";
        } catch {
          this.stage = "저장된 환경을 다시 준비하세요";
        }
      }
    } finally {
      this.busy = false;
    }
  }
  cancel() {
    this.controller?.abort();
    return this.status();
  }
  async stop() {
    this.cancel();
    await this.work;
    await this.chain;
  }
  private work?: Promise<void>;
  prepare() {
    if (this.busy) return this.status();
    this.busy = true;
    this.error = "";
    this.controller = new AbortController();
    this.work = this.prepareWork(this.controller.signal)
      .catch(() => {
        this.error = this.controller?.signal.aborted
          ? "환경 준비를 중단했습니다. 데이터는 보존되며 다시 준비할 수 있습니다."
          : `${this.stage} 단계에 실패했습니다. Git·Docker 실행 상태와 네트워크/디스크 공간을 확인하고 다시 시도하세요.`;
      })
      .finally(() => {
        this.busy = false;
      });
    return this.status();
  }
  migrate(
    transfer: (
      url: string,
      backupDirectory: string,
    ) => Promise<() => Promise<void>>,
  ) {
    if (this.busy) throw Error("진행 중인 환경 준비를 먼저 마치세요.");
    if (this.state.database) throw Error("이미 전용 환경을 사용 중입니다.");
    this.busy = true;
    this.error = "";
    this.stage = "기존 데이터 백업·이전";
    this.controller = new AbortController();
    const controller = this.controller;
    this.work = (async () => {
      const area = join(this.root, `migration-${randomUUID()}`);
      let activate: (() => Promise<void>) | undefined;
      const candidate = new Bootstrap(
        area,
        this.cipher,
        this.recipe,
        async (url) => {
          activate = await transfer(url, join(area, "backup"));
        },
        () => false,
        this.run,
      );
      await candidate.init();
      candidate.controller = controller;
      await candidate.prepareWork(controller.signal);
      controller.signal.throwIfAborted();
      const old = this.state.database;
      this.state.database = candidate.state.database;
      try {
        await this.persist();
      } catch (e) {
        this.state.database = old;
        throw e;
      }
      await activate!();
      this.stage = "백업·복원 검증 후 전용 환경으로 전환했습니다";
    })()
      .catch(() => {
        this.error =
          "데이터 이전을 완료하지 못했습니다. 원본 DB와 백업/후보 DB를 보존했습니다. 기존 환경을 유지하거나 앱을 다시 열어 연결 상태를 확인하세요.";
      })
      .finally(() => {
        this.busy = false;
      });
    return this.status();
  }
  private async docker(args: string[], signal?: AbortSignal, timeout = 30000) {
    const result = await this.run("docker", args, { signal, timeout });
    if (result.code !== 0) throw Error("Docker operation failed");
    return result.output.trim();
  }
  private names() {
    const id = this.state.database!.id;
    return {
      container: `roopre-db-${id}`,
      volume: `roopre-data-${id}`,
      label: `dev.roopre.profile=${id}`,
    };
  }
  private async ownedContainer() {
    const { container } = this.names();
    const raw = await this.docker(["inspect", container]);
    const item = JSON.parse(raw)[0];
    if (
      item?.Config?.Labels?.["dev.roopre.profile"] !== this.state.database!.id
    )
      throw Error("Foreign container");
    return item;
  }
  private async databaseUrl() {
    const item = await this.ownedContainer();
    const ports = item.NetworkSettings?.Ports?.["5432/tcp"];
    if (
      !Array.isArray(ports) ||
      ports.length !== 1 ||
      ports[0].HostIp !== "127.0.0.1" ||
      !/^\d+$/.test(ports[0].HostPort)
    )
      throw Error("Invalid database binding");
    const key = this.cipher.decrypt(
      Buffer.from(this.state.database!.sealed, "base64"),
    );
    return `postgres://roopre:${encodeURIComponent(key)}@127.0.0.1:${ports[0].HostPort}/roopre`;
  }
  private async prepareWork(signal: AbortSignal) {
    this.stage = "필수 도구 확인";
    if (
      (await this.run("git", ["--version"], { signal, timeout: 6000 })).code !==
      0
    )
      throw Error("Git required");
    await this.docker(["info", "--format", "{{.ServerVersion}}"], signal, 6000);
    if (this.state.database || !this.isConnected()) {
      this.stage = "개인 데이터베이스 준비";
      if (!this.state.database) {
        this.state.database = {
          id: randomUUID(),
          sealed: this.cipher
            .encrypt(randomBytes(32).toString("hex"))
            .toString("base64"),
        };
      }
      // Every attempt must durably save identity before any external resource.
      // A failed write must not make retry skip persistence based on memory alone.
      await this.persist();
      const n = this.names();
      const exists = await this.run(
        "docker",
        [
          "container",
          "ls",
          "-a",
          "--filter",
          `name=^/${n.container}$`,
          "--format",
          "{{.Names}}",
        ],
        { signal, timeout: 10000 },
      );
      if (exists.code !== 0) throw Error("Container inventory failed");
      if (!exists.output.trim()) {
        const volumes = await this.run(
          "docker",
          [
            "volume",
            "ls",
            "--filter",
            `name=^${n.volume}$`,
            "--format",
            "{{.Name}}",
          ],
          { signal, timeout: 10000 },
        );
        if (volumes.code !== 0) throw Error("Volume inventory failed");
        if (volumes.output.trim()) {
          const volume = JSON.parse(
            await this.docker(["volume", "inspect", n.volume], signal),
          )[0];
          if (volume.Labels?.["dev.roopre.profile"] !== this.state.database.id)
            throw Error("Foreign volume");
        } else
          await this.docker(
            ["volume", "create", "--label", n.label, n.volume],
            signal,
          );
        await this.docker(["pull", "postgres:18-alpine"], signal, 600000);
        const env = join(this.root, `database-${randomUUID()}.env`);
        try {
          await writeFile(
            env,
            `POSTGRES_USER=roopre\nPOSTGRES_DB=roopre\nPOSTGRES_PASSWORD=${this.cipher.decrypt(Buffer.from(this.state.database.sealed, "base64"))}\n`,
            { mode: 0o600, flag: "wx" },
          );
          await this.docker(
            [
              "create",
              "--name",
              n.container,
              "--label",
              n.label,
              "--publish",
              "127.0.0.1::5432",
              "--mount",
              `type=volume,src=${n.volume},dst=/var/lib/postgresql`,
              "--env-file",
              env,
              "postgres:18-alpine",
            ],
            signal,
          );
        } finally {
          await rm(env, { force: true });
        }
      }
      await this.ownedContainer();
      await this.docker(["start", n.container], signal);
      for (let i = 0; i < 30; i++) {
        signal.throwIfAborted();
        const ready = await this.run(
          "docker",
          [
            "exec",
            n.container,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "roopre",
            "-d",
            "roopre",
          ],
          { signal, timeout: 5000 },
        );
        if (ready.code === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      signal.throwIfAborted();
      await this.connect(await this.databaseUrl());
    }
    this.stage = "격리 실행 이미지 준비";
    const image = await this.run(
      "docker",
      ["image", "inspect", "roopre-runner:0.2"],
      { signal, timeout: 10000 },
    );
    if (image.code !== 0) {
      // A dedicated context contains only our bundled recipe, never the user's repo.
      const context = join(this.root, "image-context");
      await mkdir(context, { recursive: true, mode: 0o700 });
      await writeFile(
        join(context, "Dockerfile"),
        await readFile(this.recipe),
        { mode: 0o600 },
      );
      await this.docker(
        ["build", "-t", "roopre-runner:0.2", context],
        signal,
        900000,
      );
    }
    signal.throwIfAborted();
    this.stage = "환경 준비 완료";
  }
}
