import { profileOf } from "../shared/harness-package.ts";
import { z } from "zod";
import { sections } from "../shared/contracts.ts";
import type { ResolvedAgent, AgentExecution } from "../shared/harness.ts";
import { collectArtifacts, archiveArtifacts } from "./artifacts.ts";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  lstat,
  writeFile,
  copyFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Store } from "../database/store.ts";
import type { ConnectionVault } from "../main/connections/vault.ts";
import { activeStatuses, type Evidence } from "../shared/runtime.ts";
import { gate, type Run, type Workspace } from "../shared/contracts.ts";
import { approvalBinding, policyBinding } from "../domain/runtime.ts";
import { command, git } from "./process.ts";
import { startBroker } from "./broker.ts";
import { readWorkspaceFile } from "./files.ts";
const occupiesSlot = (r: Run) =>
  r.runtime?.terminationConfirmed === false ||
  (activeStatuses.includes(r.status) && r.status !== "queued");
export class RunnerManager {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private active = new Map<string, AbortController>();
  private jobs = new Map<string, Promise<void>>();
  constructor(
    private store: Store,
    private vault: ConnectionVault,
    private root: string,
    private resources: string,
  ) {}
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const w = await this.store.read("owner");
    for (const run of w.runs.filter(
      (r) =>
        r.runtime &&
        ((activeStatuses.includes(r.status) && r.status !== "queued") ||
          r.runtime.terminationConfirmed === false),
    )) {
      await this.cleanup(run.id);
      await this.update(run.id, (r) => {
        r.runtime!.terminationConfirmed = true;
      });
      await this.update(run.id, (r) => {
        r.status = "interrupted";
        r.reason =
          "이전 실행이 중단됐습니다. 근거를 보존했습니다. 재시도로 새 작업 공간에서 시작하세요.";
      });
    }
    this.timer = setInterval(() => void this.tick(), 1000);
    void this.tick();
  }
  private names(id: string) {
    if (!/^run-[a-f0-9-]+$/.test(id)) throw Error("실행 ID 오류");
    return {
      container: `roopre-${id}`,
      proxy: `roopre-proxy-${id}`,
      network: `roopre-net-${id}`,
      dependencies: `roopre-deps-${id}`,
    };
  }
  async cleanup(id: string) {
    const n = this.names(id);
    await command("docker", ["rm", "-f", n.container, n.proxy], {
      timeout: 20000,
    });
    for (const name of [n.container, n.proxy]) {
      const result = await command(
        "docker",
        ["inspect", "--format", "{{.State.Running}}", name],
        { timeout: 10000 },
      );
      if (
        result.code === 0 ||
        !/No such (object|container)/i.test(result.output)
      )
        throw Error(
          "이전 컨테이너 종료를 확인하지 못했습니다. Docker 상태를 복구한 뒤 앱을 다시 시작하세요.",
        );
    }
    await command("docker", ["network", "rm", n.network], { timeout: 10000 });
    await command("docker", ["volume", "rm", n.dependencies], {
      timeout: 10000,
    });
    await command(
      "docker",
      ["image", "rm", `roopre-deps-${id}:latest`, `roopre-base-${id}:locked`],
      {
        timeout: 30000,
      },
    );
  }
  async update(id: string, fn: (run: Run) => void) {
    await this.store.mutate((w) => {
      const r = w.runs.find((r) => r.id === id);
      if (r) fn(r);
    });
  }
  private async event(id: string, message: string) {
    await this.update(id, (r) => {
      r.runtime!.heartbeat = new Date().toISOString();
      r.runtime!.events.push({ at: r.runtime!.heartbeat, message });
      r.runtime!.events = r.runtime!.events.slice(-120);
      r.reason = message;
    });
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const w = await this.store.read("owner");
      for (const [id, abort] of this.active) {
        const r = w.runs.find((r) => r.id === id)!;
        try {
          await this.valid(id);
        } catch {
          abort.abort();
        }
      }
      const occupied = w.runs.filter(
        (r) => this.active.has(r.id) || occupiesSlot(r),
      );
      if (occupied.length >= 2) return;
      const projectIds = new Set(
        occupied.map(
          (r) => w.features.find((f) => f.id === r.featureId)?.projectId,
        ),
      );
      const run = w.runs.find(
        (r) =>
          r.runtime &&
          r.status === "queued" &&
          !projectIds.has(
            w.features.find((f) => f.id === r.featureId)!.projectId,
          ),
      );
      if (run) {
        const controller = new AbortController();
        this.active.set(run.id, controller);
        const job = this.execute(run.id, controller)
          .catch(() => {})
          .finally(() => {
            this.active.delete(run.id);
            this.jobs.delete(run.id);
          });
        this.jobs.set(run.id, job);
      }
    } catch {
      /* Reconnect on next tick; running jobs check validity before every phase. */
    } finally {
      this.busy = false;
    }
  }
  private async valid(id: string) {
    const w = await this.store.read("owner");
    const r = w.runs.find((r) => r.id === id)!;
    if (!r?.runtime) throw Error("실행 계약이 없습니다.");
    const connections = [
      {
        connectionId: r.runtime.profile.connectionId,
        connectionVersion: r.runtime.profile.connectionVersion,
      },
      ...(r.runtime.harness?.agents ?? []),
    ];
    for (const c of connections) {
      const info = this.vault.get(c.connectionId).info;
      if (info.version !== c.connectionVersion || info.testStatus !== "passed")
        throw Error(
          "AI 연결이 변경되거나 검증되지 않았습니다. 실행 계약을 갱신하세요.",
        );
    }
    const f = w.features.find((f) => f.id === r.featureId)!;
    const planning = r.runtime.kind === "planning";
    if (
      ["blocked", "cancelled"].includes(r.status) ||
      (planning
        ? r.runtime.binding !== policyBinding(w, f) ||
          r.runtime.draftRevision !== f.draft.revision
        : !gate(w, f).eligible || r.runtime.binding !== approvalBinding(w, f))
    )
      throw Error("설계·지침·초안 또는 승인 계약이 바뀌었습니다.");
    return { w, r, f };
  }
  private async docker(
    args: string[],
    signal?: AbortSignal,
    timeout = 60000,
    input?: string,
  ) {
    const result = await command("docker", args, { signal, timeout, input });
    if (result.code !== 0)
      throw Error(
        `격리 환경 명령 실패: docker ${args[0]}. 실행 환경과 저장소 검사를 확인하세요.`,
      );
    return result.output.trim();
  }
  private async phase(id: string, status: Run["status"], message: string) {
    await this.valid(id);
    await this.update(id, (r) => {
      if (["cancelled", "blocked"].includes(r.status))
        throw Error("실행이 중단됐습니다.");
      r.status = status;
    });
    await this.event(id, message);
  }
  async execute(id: string, abort: AbortController) {
    let claimed = false;
    await this.store.mutate((w) => {
      const r = w.runs.find((r) => r.id === id);
      if (!r?.runtime || r.status !== "queued") return;
      const f = w.features.find((f) => f.id === r.featureId)!;
      const running = w.runs.filter((x) => x.id !== id && occupiesSlot(x));
      if (
        running.length >= 2 ||
        running.some(
          (x) =>
            w.features.find((f) => f.id === x.featureId)?.projectId ===
            f.projectId,
        )
      )
        return;
      r.status = "preparing";
      r.runtime.terminationConfirmed = false;
      r.runtime.lease = randomUUID();
      r.runtime.heartbeat = new Date().toISOString();
      claimed = true;
    });
    if (!claimed) return;

    let broker: Awaited<ReturnType<typeof startBroker>> | undefined;
    let clock: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const n = this.names(id);
    const area = join(this.root, id);
    const checkout = join(area, "checkout");
    try {
      const { r, f, w } = await this.valid(id);
      const profile = r.runtime!.profile;
      const standard = w.projects.find((p) => p.id === f.projectId)?.harness;
      const scope =
        standard &&
        profileOf(standard).scopes.find((s) => s.id === f.harnessScope);
      const checkScope = async () => {
        if (!scope) return;
        const paths = (
          await git(
            checkout,
            "diff",
            "--cached",
            "--no-renames",
            "--name-only",
            "-z",
            profile.baseCommit,
          )
        )
          .split("\0")
          .filter(Boolean);
        if (
          paths.some(
            (path) => !scope.paths.some((prefix) => path.startsWith(prefix)),
          )
        )
          throw Error(
            "승인된 기능 디렉토리 밖의 변경입니다. 범위와 설계를 다시 검토하세요.",
          );
      };
      if (f.dependencies.length)
        throw Error(
          "선행 기능의 통합을 확인하기 전에는 실행할 수 없습니다. 의존 관계를 정리하고 설계를 재승인하세요.",
        );
      let connection = this.vault.get(profile.connectionId);
      const planning = r.runtime!.kind === "planning";
      if (
        connection.info.version !== profile.connectionVersion ||
        connection.info.testStatus !== "passed"
      )
        throw Error("AI 연결을 검사하고 해당 연결 버전으로 설계를 승인하세요.");
      if (
        (await git(profile.repositoryPath, "rev-parse", profile.baseBranch)) !==
        profile.baseCommit
      )
        throw Error(
          "기준 브랜치가 변경됐습니다. 실행 프로필과 설계를 갱신하세요.",
        );
      clock = setTimeout(() => abort.abort(), profile.timeoutMinutes * 60000);
      await this.phase(
        id,
        "preparing",
        "격리된 체크아웃과 테스트 환경을 준비합니다.",
      );
      await this.update(id, (r) => {
        r.runtime!.lease = randomUUID();
        r.runtime!.container = n.container;
        r.runtime!.heartbeat = new Date().toISOString();
      });
      heartbeat = setInterval(
        () =>
          void this.update(id, (r) => {
            r.runtime!.heartbeat = new Date().toISOString();
          }).catch(() => abort.abort()),
        10000,
      );
      await mkdir(area, { recursive: true, mode: 0o700 });
      await this.docker(["image", "inspect", profile.image], abort.signal);
      await git(
        profile.repositoryPath,
        "clone",
        "--no-hardlinks",
        "--no-local",
        profile.repositoryPath,
        checkout,
      );
      await git(checkout, "checkout", "-b", `codex/${id}`, profile.baseCommit);
      await git(checkout, "remote", "remove", "origin");
      await writeFile(
        join(checkout, ".git/info/exclude"),
        "node_modules/\n.roopre-artifacts/\ntest-results/\nplaywright-report/\n",
      );
      await git(checkout, "config", "user.name", "Roopre Agent");
      await git(checkout, "config", "user.email", "agent@roopre.local");
      await this.update(id, (r) => {
        r.runtime!.worktree = checkout;
        r.runtime!.branch = `codex/${id}`;
      });
      const rootConfig =
        /^(package\.json$|pnpm-lock\.yaml$|package-lock\.json$|\.gitignore$|\.npmrc$|\.pnpmfile\.[cm]?js$|\.yarnrc|\.eslintrc|\.babelrc|tsconfig|eslint|vitest|playwright|(?:babel|jest|vite|webpack|rollup|next|svelte|postcss|tailwind)\.config\.)/;
      const tracked = await git(checkout, "ls-files", "-z");
      if (tracked.includes("\uFFFD"))
        throw Error(
          "UTF-8 파일 이름만 지원합니다. 저장소 파일 이름을 확인하세요.",
        );
      const protectedPaths = tracked
        .split("\0")
        .filter((p) =>
          /(^|\/)(tests?|__tests__|scripts|config|\.github)\/|\.(test|spec)\.[a-z]+$|^(package\.json|pnpm-lock\.yaml|package-lock\.json|tsconfig|eslint|vitest|playwright)/.test(
            p,
          ),
        );
      const fingerprint = async () => {
        const h = createHash("sha256");
        // New root configuration can redirect pnpm/npm or suppress tests too.
        const paths = [
          ...new Set([
            ...protectedPaths,
            ...(await readdir(checkout)).filter((p) => rootConfig.test(p)),
          ]),
        ].sort();
        for (const p of paths) {
          h.update(p);
          try {
            if ((await lstat(join(checkout, p))).isSymbolicLink()) {
              h.update("SYMLINK");
              continue;
            }
            h.update(
              await readWorkspaceFile(checkout, p, 20_000_000, abort.signal),
            );
          } catch {
            h.update("MISSING");
          }
        }
        return h.digest("hex");
      };
      const baseline = await fingerprint();
      if (r.runtime!.resumeFrom) {
        const previous = w.runs.find((x) => x.id === r.runtime!.resumeFrom);
        if (
          !previous?.runtime?.worktree ||
          previous.runtime.binding !== r.runtime!.binding
        )
          throw Error("복구할 실행 계약을 확인하세요.");
        await git(previous.runtime.worktree, "add", "-A");
        const patch = await git(
          previous.runtime.worktree,
          "diff",
          "--cached",
          "--binary",
          profile.baseCommit,
        );
        if (patch.length > 180000)
          throw Error(
            "복구 변경량이 큽니다. 보존된 작업 공간을 직접 검토하세요.",
          );
        if (patch) {
          const applied = await command(
            "git",
            ["-c", "core.hooksPath=/dev/null", "apply", "--index", "-"],
            {
              cwd: checkout,
              input: patch + "\n",
              env: {
                PATH: process.env.PATH,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
              },
            },
          );
          if (applied.code !== 0)
            throw Error("체크포인트를 적용하지 못했습니다.");
        }
        if ((await fingerprint()) !== baseline)
          throw Error(
            "복구 변경이 필수 검사/설정에 영향을 줍니다. 설계를 재검토하세요.",
          );
      }
      // Dependency preparation is deterministic and separate from the agent. No host home/config is mounted.
      const setup = join(area, "setup");
      await mkdir(setup);
      let hasManifest = false;
      for (const file of [
        "package.json",
        "pnpm-lock.yaml",
        "package-lock.json",
      ]) {
        try {
          if ((await lstat(join(checkout, file))).isSymbolicLink())
            throw Error("Dependency manifest symlink is not supported");
          await copyFile(join(checkout, file), join(setup, file));
          if (file === "package.json") hasManifest = true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      let image = profile.image;
      if (hasManifest && !planning) {
        const lockedBase = `roopre-base-${id}:locked`;
        await this.docker(["tag", profile.image, lockedBase], abort.signal);
        await writeFile(
          join(setup, "Dockerfile"),
          `FROM ${lockedBase}\nUSER root\nWORKDIR /opt/project\nCOPY . .\nRUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --ignore-scripts; elif [ -f package-lock.json ]; then npm ci --ignore-scripts; else echo 'A dependency lockfile is required' >&2; exit 1; fi\nRUN mkdir -p /opt/project/node_modules && chmod -R a+rX /opt/project\nUSER pwuser\nWORKDIR /workspace\n`,
        );
        image = `roopre-deps-${id}:latest`;
        await this.docker(["build", "-t", image, setup], abort.signal, 600000);
      }
      // Only this trusted, networkless setup writes the dependency volume.
      // Every agent/check/review container receives it read-only.
      await this.docker(["volume", "create", n.dependencies], abort.signal);
      await this.docker(
        [
          "run",
          "--rm",
          "--name",
          n.container,
          "--network",
          "none",
          "--user",
          "root",
          "--cap-drop=ALL",
          "--security-opt",
          "no-new-privileges",
          "--mount",
          `type=volume,src=${n.dependencies},dst=/locked-deps`,
          image,
          "sh",
          "-c",
          `${hasManifest && !planning ? "cp -a /opt/project/node_modules/. /locked-deps/ && " : ""}mkdir -p /locked-deps/.vite /locked-deps/.vite-temp`,
        ],
        abort.signal,
        120000,
      );
      await this.docker(
        ["network", "create", "--internal", n.network],
        abort.signal,
      );
      let token = "";
      const gateway = async () => {
        await command("docker", ["rm", "-f", n.container, n.proxy]);
        broker?.close();
        token = randomBytes(32).toString("hex");
        broker = await startBroker(
          connection.info,
          connection.key,
          token,
          abort.signal,
        );
        await this.docker(
          [
            "create",
            "--name",
            n.proxy,
            "--network",
            n.network,
            "--network-alias",
            "model-gateway",
            ...(process.platform !== "darwin"
              ? ["--add-host", "host.docker.internal:host-gateway"]
              : []),
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges",
            "--read-only",
            "--pids-limit",
            "64",
            "--memory",
            "128m",
            "--env",
            `BROKER_PORT=${broker.port}`,
            "--mount",
            `type=bind,src=${join(this.resources, "runner-proxy.cjs")},dst=/proxy.cjs,readonly`,
            profile.image,
            "node",
            "/proxy.cjs",
          ],
          abort.signal,
        );
        await this.docker(
          ["network", "connect", "bridge", n.proxy],
          abort.signal,
        );
        await this.docker(["start", n.proxy], abort.signal);
      };
      const createContainer = async (readonly = false) => {
        // Docker cannot create a nested mountpoint under a read-only workspace.
        // This empty ignored directory is owned by the runner, not agent output.
        await mkdir(join(checkout, "node_modules"), { recursive: true });
        await command("docker", ["rm", "-f", n.container]);
        await this.docker(
          [
            "run",
            "-d",
            "--name",
            n.container,
            "--network",
            n.network,
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "256",
            "--memory",
            "4g",
            "--cpus",
            "2",
            "--ipc",
            "private",
            "--shm-size",
            "512m",
            "--mount",
            `type=bind,src=${checkout},dst=/workspace${readonly ? ",readonly" : ""}`,
            "--mount",
            `type=bind,src=${join(checkout, ".git")},dst=/workspace/.git,readonly`,
            "--mount",
            `type=volume,src=${n.dependencies},dst=/workspace/node_modules,readonly,volume-nocopy`,
            "--tmpfs",
            "/tmp:rw,nosuid,size=512m",
            "--tmpfs",
            "/workspace/node_modules/.vite:rw,nosuid,size=256m,mode=1777",
            "--tmpfs",
            "/workspace/node_modules/.vite-temp:rw,nosuid,size=128m,mode=1777",
            "--env",
            `ANTHROPIC_API_KEY=${token}`,
            "--env",
            "ANTHROPIC_BASE_URL=http://model-gateway:8080",
            "--env",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
            image,
            "sleep",
            "infinity",
          ],
          abort.signal,
        );
      };
      const invoke = async (prompt: string, review = false) => {
        await this.valid(id);
        const current = (await this.store.read("owner")).runs.find(
          (x) => x.id === id,
        )!;
        const remaining = profile.budgetUsd - current.runtime!.costUsd;
        if (remaining <= 0) throw Error("설정한 추정 예산에 도달했습니다.");
        const args = [
          "exec",
          "-i",
          n.container,
          "claude",
          "--bare",
          "--no-session-persistence",
          "--setting-sources",
          "",
          "-p",
          "--verbose",
          "--output-format",
          "stream-json",
          "--model",
          connection.info.model,
          "--max-budget-usd",
          String(remaining),
          "--permission-mode",
          "dontAsk",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--tools",
          review ? "Read,Glob,Grep" : "Read,Glob,Grep,Edit,Write,Bash",
          "--allowedTools",
          review ? "Read,Glob,Grep" : "Read,Glob,Grep,Edit,Write,Bash",
        ];
        let result: any;
        let lastEvent = 0;
        const output = await command("docker", args, {
          input: prompt,
          signal: abort.signal,
          timeout: profile.timeoutMinutes * 60000,
          onLine: (line) => {
            try {
              const e = JSON.parse(line);
              if (e.type === "result") result = e;
              else if (
                Date.now() - lastEvent > 4000 &&
                e.type === "assistant"
              ) {
                const names =
                  e.message?.content
                    ?.filter((b: any) => b.type === "tool_use")
                    .map((b: any) => String(b.name))
                    .filter((n: string) => /^[A-Za-z_]{1,40}$/.test(n)) ?? [];
                if (names.length) {
                  lastEvent = Date.now();
                  void this.event(
                    id,
                    `Claude Code 도구 작업: ${names.join(", ")}`,
                  ).catch(() => {});
                }
              }
            } catch {}
          },
        });
        if (
          typeof result?.total_cost_usd === "number" &&
          Number.isFinite(result.total_cost_usd) &&
          result.total_cost_usd >= 0
        ) {
          await this.update(id, (r) => {
            r.runtime!.costUsd += result.total_cost_usd;
            r.runtime!.costReported = true;
          });
        } else if (result && !result.is_error)
          throw Error(
            "CLI 비용 정보가 없어 자동 실행을 중단했습니다. 청구 상태를 확인하세요.",
          );
        if (output.code !== 0 || !result || result.is_error)
          throw Error(
            "Claude Code가 정상 완료하지 못했습니다. 연결·예산·권한을 확인하세요.",
          );
        return String(result.result ?? "")
          .replaceAll(token, "[redacted]")
          .replaceAll(connection.key, "[redacted]");
      };
      const runAgent = async (
        assignment: ResolvedAgent,
        prompt: string,
        readonly: boolean,
      ) => {
        await this.valid(id);
        connection = this.vault.get(assignment.connectionId);
        if (
          connection.info.version !== assignment.connectionVersion ||
          connection.info.testStatus !== "passed"
        )
          throw Error("에이전트 연결을 다시 검증하세요.");
        await gateway();
        await createContainer(readonly);
        await git(checkout, "add", "-A");
        const inputTree = await git(checkout, "write-tree");
        const instructions = `${assignment.instructions}\n\n# 기능 입력\n${prompt}`;
        const execution: AgentExecution = {
          id: randomUUID(),
          assignmentId: assignment.id,
          name: assignment.agent.name,
          stage: assignment.stage,
          revision: assignment.agent.revision,
          connectionId: assignment.connectionId,
          connectionVersion: assignment.connectionVersion,
          model: connection.info.model,
          required: assignment.required,
          status: "running",
          attempt: (await this.store.read("owner")).runs.find(
            (x) => x.id === id,
          )!.runtime!.attempt,
          startedAt: new Date().toISOString(),
          inputTree,
          instructionHash: createHash("sha256")
            .update(instructions)
            .digest("hex"),
          instructions,
        };
        await this.update(id, (r) => {
          (r.runtime!.agents ??= []).push(execution);
        });
        await this.event(id, `${assignment.agent.name} 실행 중`);
        try {
          const output = await invoke(instructions, readonly);
          if (output.length > 60000)
            throw Error("에이전트 결과가 저장 한도를 넘었습니다.");
          await this.valid(id);
          await git(checkout, "add", "-A");
          const outputTree = await git(checkout, "write-tree");
          if (readonly && outputTree !== inputTree)
            throw Error("읽기 전용 단계에서 소스가 변경됐습니다.");
          await this.update(id, (r) => {
            Object.assign(
              r.runtime!.agents!.find((a) => a.id === execution.id)!,
              {
                status: "passed",
                endedAt: new Date().toISOString(),
                output,
                outputTree,
              },
            );
          });
          return { output, executionId: execution.id };
        } catch (e) {
          await this.update(id, (r) => {
            Object.assign(
              r.runtime!.agents!.find((a) => a.id === execution.id)!,
              {
                status: "failed",
                endedAt: new Date().toISOString(),
                error: (e as Error).message,
              },
            );
          });
          // A process timeout/cancellation is never a skippable advisory result.
          throw e;
        }
      };
      const defaultAssignment = (
        stage: "implementation" | "review",
      ): ResolvedAgent => ({
        id: `default-${stage}`,
        agentId: `default-${stage}`,
        stage,
        required: true,
        connectionId: profile.connectionId,
        connectionVersion: profile.connectionVersion,
        instructions: r.effectivePolicy,
        agent: {
          id: `default-${stage}`,
          revision: 1,
          name: stage === "implementation" ? "기본 구현자" : "기본 리뷰어",
          description: "기존 실행 계약",
          capability:
            stage === "implementation" ? "implementation" : "read-only",
          markdown: "",
          archived: false,
        },
      });
      if (planning) {
        await this.phase(
          id,
          "reviewing",
          "저장소를 읽고 요구사항·설계 초안을 작성합니다. 소스는 수정하지 않습니다.",
        );
        let draft = { ...f.draft };
        let validDrafts = 0;
        const planAgents = r.runtime!.harness!.agents.filter(
          (a) => a.stage === "requirements" || a.stage === "design",
        );
        for (const a of planAgents) {
          const result = await runAgent(
            a,
            `Read the repository without running code. Refine requirements and design. Do not approve or implement. Return ONLY JSON {"requirements":"...", "body":"..."}. Requirements must identify AC01 etc. Body must include these markdown headings: ${sections.map((s) => "## " + s).join(", ")}.\nCurrent requirements: ${draft.requirements}\nCurrent design: ${draft.body}`,
            true,
          );
          try {
            const next = z
              .object({
                requirements: z.string().min(1).max(60000),
                body: z.string().min(1).max(60000),
              })
              .parse(
                JSON.parse(
                  result.output.replace(/^```(?:json)?\s*|\s*```$/g, ""),
                ),
              );
            if (
              !sections.every((s) => next.body.includes(`## ${s}\n`)) ||
              !/AC[- ]?\d+/i.test(next.requirements)
            )
              throw Error("설계 항목 또는 완료 기준이 누락됐습니다.");
            draft = { ...draft, ...next };
            validDrafts++;
          } catch {
            await this.update(id, (r) => {
              Object.assign(
                r.runtime!.agents!.find((a) => a.id === result.executionId)!,
                { status: "failed", error: "초안 구조 검증 실패" },
              );
            });
            if (a.required)
              throw Error(
                "필수 설계 에이전트가 유효한 초안을 반환하지 않았습니다.",
              );
          }
        }
        if (!validDrafts)
          throw Error("유효한 설계 초안이 없어 기존 입력을 보존합니다.");
        await this.valid(id);
        await this.store.mutate((w) => {
          const current = w.runs.find((r) => r.id === id)!;
          const target = w.features.find((f) => f.id === current.featureId)!;
          if (
            abort.signal.aborted ||
            ["blocked", "cancelled"].includes(current.status) ||
            current.runtime!.binding !== policyBinding(w, target) ||
            target.draft.revision !== current.runtime!.draftRevision
          )
            throw Error("초안이 변경됐습니다. 기존 입력을 보존합니다.");
          target.draft = {
            body: draft.body,
            requirements: draft.requirements,
            revision: draft.revision + 1,
          };
          target.updatedAt = new Date().toISOString();
          current.status = "completed";
          current.reason =
            "새 설계 초안을 저장했습니다. 내용을 검토하고 게시한 뒤 본인 승인하세요.";
        });
        return;
      }
      let feedback = "";
      let finished = false;
      for (let attempt = 0; attempt <= profile.repairLimit; attempt++) {
        await this.update(id, (r) => {
          r.runtime!.attempt = attempt + 1;
        });
        await this.phase(
          id,
          attempt ? "repairing" : "implementing",
          attempt
            ? "검증 실패를 승인 범위 안에서 수정합니다."
            : "승인한 설계에 따라 Claude Code가 구현합니다.",
        );
        for (const assignment of r.runtime!.harness?.agents.filter(
          (a) => a.stage === "implementation",
        ) ?? [defaultAssignment("implementation")]) {
          await runAgent(
            assignment,
            `You are implementing an approved task. Work only in /workspace. Do not weaken tests, edit policy/configuration/dependency manifests, access credentials, push, deploy, or claim completion without evidence. If the design must change, stop and explain.\nTEAM POLICY\n${r.effectivePolicy}\nDESIGN\n${f.designs.at(-1)!.body}\nACCEPTANCE\n${f.designs.at(-1)!.requirements}\nFEEDBACK\n${feedback}`,
            false,
          );
        }
        if ((await fingerprint()) !== baseline)
          throw Error(
            "필수 검사·설정·의존성 파일이 변경됐습니다. 설계와 검사 기준 재검토가 필요합니다.",
          );
        // Verify the candidate Git tree, never ignored outputs/caches left by the agent.
        await this.docker(["rm", "-f", n.container], abort.signal);
        await git(checkout, "add", "-A");
        await git(checkout, "clean", "-ffdx");
        await createContainer();
        await this.phase(
          id,
          "verifying",
          "고정 검사와 웹 시나리오를 실행합니다.",
        );
        await git(checkout, "add", "-A");
        await checkScope();
        const tree = await git(checkout, "write-tree");
        const evidence: Evidence[] = [];
        for (const check of profile.checks) {
          await this.valid(id);
          const test = await command(
            "docker",
            ["exec", n.container, ...check.argv],
            { signal: abort.signal, timeout: check.timeoutSeconds * 1000 },
          );
          const log = test.output
            .replaceAll(token, "[redacted]")
            .replaceAll(connection.key, "[redacted]")
            .slice(-40000);
          evidence.push({
            name: check.name,
            status: test.code === 0 ? "passed" : "failed",
            code: test.code,
            at: new Date().toISOString(),
            tree,
            log,
            attempt: attempt + 1,
          });
          await this.update(id, (r) => {
            r.runtime!.evidence.push(evidence.at(-1)!);
          });
          if (test.code === -1) {
            // Killing docker exec's client does not kill the container's process.
            // Leave this attempt immediately; finally destroys and verifies it.
            throw Error(
              `검사 ${check.name} 시간 한도 또는 중단: 컨테이너를 종료하고 후속 검사를 중지합니다.`,
            );
          }
        }
        await createContainer(true);
        const artifactRoot = join(area, "artifacts");
        const artifacts = await archiveArtifacts(
          checkout,
          artifactRoot,
          await collectArtifacts(checkout, attempt + 1, abort.signal),
          abort.signal,
        );
        await this.update(id, (r) => {
          r.runtime!.artifactRoot = artifactRoot;
          r.runtime!.artifacts = [
            ...(r.runtime!.artifacts ?? []),
            ...artifacts,
          ];
        });
        if ((await fingerprint()) !== baseline)
          throw Error("검사 중 필수 테스트/설정이 변경됐습니다.");
        await git(checkout, "add", "-A");
        if ((await git(checkout, "write-tree")) !== tree)
          throw Error(
            "검사 도중 소스가 변경되어 증거가 오래됐습니다. 변경 내용을 검토하세요.",
          );
        if (evidence.some((e) => e.status === "failed")) {
          feedback = evidence
            .filter((e) => e.status === "failed")
            .map((e) => `${e.name}: ${e.log}`)
            .join("\n");
          continue;
        }
        await this.phase(
          id,
          "reviewing",
          "읽기 전용 검토자가 설계·diff·완료 기준을 대조합니다.",
        );
        const diff = await git(
          checkout,
          "diff",
          "--cached",
          profile.baseCommit,
        );
        if (diff.length > 150000)
          throw Error(
            "변경량이 검토 한도를 넘었습니다. 기능을 나눠 검토하세요.",
          );
        const ac = [
          ...new Set(
            f.designs.at(-1)!.requirements.match(/AC[- ]?\d+/gi) ?? [],
          ),
        ];
        const reviewAssignments = r.runtime!.harness?.agents.filter(
          (a) => a.stage === "verification" || a.stage === "review",
        ) ?? [defaultAssignment("review")];
        let blocked = false;
        const reviews: string[] = [];
        for (const assignment of reviewAssignments) {
          const { output: review, executionId } = await runAgent(
            assignment,
            `Review skeptically. Read files but do not execute code. Compare approved requirements, design and implementation. Return ONLY JSON: {"passed": boolean,"acceptance": [{"id":"AC01","passed":boolean,"evidence":"specific file/test evidence"}],"findings":["blocking issue"]}. Every required AC must have concrete evidence.\nRequired IDs: ${ac.join(",")}\nRequirements: ${f.designs.at(-1)!.requirements}\nDesign: ${f.designs.at(-1)!.body}\nDIFF\n${diff}\nChecks: ${evidence.map((e) => e.name + ":" + e.status).join(", ")}`,
            true,
          );
          reviews.push(`${assignment.agent.name}\n${review}`);
          let passed = false;
          try {
            const verdict = z
              .object({
                passed: z.boolean(),
                findings: z.array(z.string()),
                acceptance: z.array(
                  z.object({
                    id: z.string(),
                    passed: z.boolean(),
                    evidence: z.string(),
                  }),
                ),
              })
              .parse(
                JSON.parse(review.replace(/^```(?:json)?\s*|\s*```$/g, "")),
              );
            passed =
              verdict.passed &&
              verdict.findings.length === 0 &&
              ac.every((id) =>
                verdict.acceptance.some(
                  (x) => x.id === id && x.passed && x.evidence.length > 12,
                ),
              );
          } catch {}
          if (!passed) {
            await this.update(id, (r) => {
              Object.assign(
                r.runtime!.agents!.find((a) => a.id === executionId)!,
                {
                  status: "failed",
                  error: "리뷰 통과 기준 또는 결과 형식 미충족",
                },
              );
            });
            if (assignment.required) blocked = true;
          }
        }
        await this.update(id, (r) => {
          r.runtime!.review = reviews.join("\n\n").slice(0, 60000);
        });
        if (blocked) {
          feedback = reviews.join("\n\n").slice(0, 60000);
          continue;
        }
        await this.valid(id);
        await git(checkout, "add", "-A");
        if ((await git(checkout, "write-tree")) !== tree)
          throw Error("리뷰 이후 소스가 변경됐습니다.");
        await checkScope();
        await git(
          checkout,
          "commit",
          "--allow-empty",
          "-m",
          `Roopre: ${f.title}`,
        );
        const head = await git(checkout, "rev-parse", "HEAD");
        await this.store.mutate((w) => {
          const r = w.runs.find((r) => r.id === id)!;
          const f = w.features.find((f) => f.id === r.featureId)!;
          if (
            abort.signal.aborted ||
            ["cancelled", "blocked"].includes(r.status) ||
            !gate(w, f).eligible ||
            r.runtime!.binding !== approvalBinding(w, f)
          )
            throw Error("완료 직전 승인이 변경됐습니다.");
          r.status = "ready_for_merge";
          r.reason =
            "필수 검사와 별도 리뷰를 통과했습니다. 변경 내용 확인 후 기존 병합 절차를 따르세요.";
          r.runtime!.head = head;
        });
        finished = true;
        break;
      }
      if (!finished)
        throw Error(
          "자동 수정 횟수 한도에 도달했습니다. 실패 근거를 확인하세요.",
        );
    } catch (error) {
      await this.update(id, (r) => {
        if (r.status !== "cancelled" && r.status !== "blocked") {
          r.status = abort.signal.aborted ? "interrupted" : "failed";
          r.reason = abort.signal.aborted
            ? "시간 한도 또는 실행 중단. 변경 내용과 근거를 보존했습니다."
            : (error as Error).message;
        }
      }).catch(() => {});
    } finally {
      if (clock) clearTimeout(clock);
      if (heartbeat) clearInterval(heartbeat);
      broker?.close();
      try {
        await this.cleanup(id);
        await this.update(id, (r) => {
          r.runtime!.terminationConfirmed = true;
        });
      } catch {
        await this.update(id, (r) => {
          r.status = "blocked";
          r.reason =
            "컨테이너 종료 확인이 필요합니다. Docker를 복구하고 앱을 다시 시작하세요.";
          r.runtime!.terminationConfirmed = false;
        }).catch(() => {});
      }
    }
  }
  async retry(id: string) {
    if (this.active.has(id)) throw Error("이전 실행 종료를 기다리세요.");
    await this.validForRetry(id);
    const entityId = `run-${randomUUID().slice(0, 12)}`;
    await this.store.mutate((w) => {
      const old = w.runs.find((r) => r.id === id)!;
      const f = w.features.find((f) => f.id === old.featureId)!;
      if (
        !old.runtime ||
        old.runtime.terminationConfirmed !== true ||
        !["failed", "interrupted"].includes(old.status) ||
        !gate(w, f).eligible ||
        old.runtime.binding !== approvalBinding(w, f)
      )
        throw Error("현재 설계를 다시 승인하세요.");
      if (
        w.runs.some(
          (r) => r.featureId === f.id && activeStatuses.includes(r.status),
        )
      )
        throw Error("진행 중인 실행이 있습니다.");
      const checkpoint = old.runtime.worktree ? id : undefined;
      old.status = "cancelled";
      old.reason = `${entityId} 실행으로 이어서 재시작했습니다.`;
      w.runs.push({
        ...structuredClone(old),
        id: entityId,
        status: "queued",
        reason: "보존한 변경으로 새 실행을 준비합니다.",
        at: new Date().toISOString(),
        runtime: {
          profile: structuredClone(old.runtime.profile),
          harness: structuredClone(old.runtime.harness),
          agents: [],
          binding: old.runtime.binding,
          attempt: 0,
          costUsd: 0,
          costEstimated: true,
          events: [],
          evidence: [],
          resumeFrom: checkpoint,
        },
      });
    });
    return { entityId };
  }

  private async validForRetry(id: string) {
    const w = await this.store.read("owner");
    const r = w.runs.find((r) => r.id === id);
    if (
      !r?.runtime ||
      r.runtime.terminationConfirmed !== true ||
      !["failed", "interrupted"].includes(r.status)
    )
      throw Error("실패/중단된 실행만 재시도할 수 있습니다.");
    const f = w.features.find((f) => f.id === r.featureId)!;
    if (r.runtime.kind === "planning")
      throw Error("계획 작업은 최신 초안에서 새로 요청하세요.");
    if (!gate(w, f).eligible || r.runtime.binding !== approvalBinding(w, f))
      throw Error("현재 설계를 다시 승인하세요.");
    return { w, r, f };
  }
  async diff(id: string) {
    const w = await this.store.read("owner");
    const r = w.runs.find((r) => r.id === id);
    if (!r?.runtime?.worktree) throw Error("변경 파일이 아직 없습니다.");
    return git(r.runtime.worktree, "diff", r.runtime.profile.baseCommit, "--");
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.active.values()) c.abort();
    await Promise.allSettled([...this.jobs.values()]);
  }
}
