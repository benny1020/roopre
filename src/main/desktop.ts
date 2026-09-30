import { refineAgent } from "./connections/refine-agent.ts";
import { HarnessLibrary, harnessApplyRequestId } from "./harness/library.ts";
import {
  importPackageFolder,
  exportPackageFolder,
  importPackageGit,
} from "./harness/files.ts";
import { exportProject } from "../domain/harness-package.ts";
import { defaultPackage } from "../shared/default-package.ts";
import { transferWorkspace } from "../database/transfer.ts";
import { activeStatuses } from "../shared/runtime.ts";
import { basename, dirname } from "node:path";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { readWorkspaceFile } from "../runner/files.ts";
import { exportAgentMarkdown, latestAgents } from "../shared/harness.ts";
import { Bootstrap } from "./bootstrap/environment.ts";
import { databaseUrl } from "../database/store.ts";
import { checkedArtifact } from "../runner/artifacts.ts";
import { shell } from "electron";
import { app, ipcMain, dialog, BrowserWindow, safeStorage } from "electron";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../database/store.ts";
import { commandSchema } from "../shared/contracts.ts";
import { profileSchema, connectionInputSchema } from "../shared/runtime.ts";
import {
  gitHostConnectionInputSchema,
  parseGitRemote,
} from "../shared/git-host.ts";
import { approvalBinding } from "../domain/runtime.ts";
import { ConnectionVault } from "./connections/vault.ts";
import { GitHostVault } from "./git-hosts/vault.ts";
import { GitHostAdapter } from "./git-hosts/adapter.ts";
import { RunnerManager } from "../runner/manager.ts";
import { command, git } from "../runner/process.ts";
import { trustedRenderer } from "./security.ts";
import { ConversationService } from "./conversations/service.ts";
import { detectRepositoryRuntime } from "./project-runtime.ts";
import { interruptPendingConversations } from "../database/conversations.ts";
import {
  conversationScopeSchema,
  sendTurnSchema,
  listTurnsSchema,
  cancelTurnSchema,
  deleteThreadSchema,
  resetSummarySchema,
} from "../shared/conversations.ts";
export async function installDesktop() {
  let store: Store | undefined;
  let runner: RunnerManager | undefined;
  let conversations: ConversationService | undefined;
  let closing = false;
  let refining = false;
  let migrationCleanup: Promise<void> | undefined;
  const resources = join(app.getAppPath(), "resources");
  const vault = new ConnectionVault(
    join(app.getPath("userData"), "private", "connections.json"),
    {
      encrypt: (s) => {
        if (!safeStorage.isEncryptionAvailable())
          throw Error("macOS 비밀 저장 기능을 사용할 수 없습니다.");
        return safeStorage.encryptString(s);
      },
      decrypt: (b) => safeStorage.decryptString(b),
    },
  );
  await vault.init();
  const gitHostVault = new GitHostVault(
    join(app.getPath("userData"), "private", "git-host-connections.json"),
    {
      encrypt: (s) => {
        if (!safeStorage.isEncryptionAvailable())
          throw Error("macOS 비밀 저장 기능을 사용할 수 없습니다.");
        return safeStorage.encryptString(s);
      },
      decrypt: (b) => safeStorage.decryptString(b),
    },
  );
  await gitHostVault.init();
  const connect = async (url: string) => {
    if (store) return;
    const next = new Store("roopre-owner-v02", url, "local-owner");
    const nextRunner = new RunnerManager(
      next,
      vault,
      join(app.getPath("userData"), "runs"),
      app.isPackaged ? process.resourcesPath : resources,
    );
    try {
      await next.init();
      await interruptPendingConversations(next.pool, next.key);
      if (closing) throw Error("앱 종료 중입니다.");
      await nextRunner.init();
    } catch (error) {
      await nextRunner.stop();
      await next.close();
      throw error;
    }
    store = next;
    runner = nextRunner;
    conversations = new ConversationService(next, vault);
  };
  const bootstrap = new Bootstrap(
    join(app.getPath("userData"), "private"),
    {
      encrypt: (s) => {
        if (!safeStorage.isEncryptionAvailable())
          throw Error("macOS 비밀 저장 기능을 사용할 수 없습니다.");
        return safeStorage.encryptString(s);
      },
      decrypt: (b) => safeStorage.decryptString(b),
    },
    app.isPackaged
      ? join(process.resourcesPath, "setup/runner.Dockerfile")
      : join(app.getAppPath(), "config/runner.Dockerfile"),
    connect,
    () => !!store,
  );
  await bootstrap.init();
  const restoration = bootstrap.restore(databaseUrl);
  const harnessLibrary = new HarnessLibrary();
  let migrating = false;
  const deliveryLocks = new Set<string>();
  ipcMain.handle(
    "roopre:request",
    async (event, operation: string, payload: unknown) => {
      const sender = BrowserWindow.fromWebContents(event.sender);
      const url = event.senderFrame?.url;
      if (
        !sender ||
        event.senderFrame !== event.sender.mainFrame ||
        !url ||
        !trustedRenderer(
          url,
          join(app.getAppPath(), "out/renderer/index.html"),
          !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
        )
      )
        return { ok: false, error: "허용되지 않은 앱 요청입니다." };
      try {
        if (closing) throw Error("앱 종료 중입니다.");
        let value: unknown;
        if (
          migrating &&
          ![
            "bootstrap",
            "cancelEnvironment",
            "snapshot",
            "connections",
          ].includes(operation)
        )
          throw Error(
            "데이터 이전 중입니다. 완료될 때까지 변경을 기다려 주세요.",
          );
        if (
          ![
            "bootstrap",
            "prepareEnvironment",
            "cancelEnvironment",
            "onboarding",
            "connections",
            "saveConnection",
            "removeConnection",
            "testConnection",
            "gitHostConnections",
            "saveGitHostConnection",
            "removeGitHostConnection",
            "testGitHostConnection",
            "diagnostics",
            "chooseRepository",
            "harnessCandidate",
            "harnessExport",
            "deliverRun",
          ].includes(operation) &&
          !store
        )
          throw Error("시작 가이드에서 환경을 먼저 준비하세요.");
        switch (operation) {
          case "refineAgent":
            if (refining)
              throw Error("진행 중인 AI 초안 요청이 끝날 때까지 기다리세요.");
            refining = true;
            try {
              value = await refineAgent(vault, payload);
            } finally {
              refining = false;
            }
            break;
          case "harnessCandidate": {
            const input = z
              .discriminatedUnion("kind", [
                z.object({ kind: z.literal("default") }),
                z.object({ kind: z.literal("folder") }),
                z.object({ kind: z.literal("project"), projectId: z.string() }),
                z.object({
                  kind: z.literal("git"),
                  url: z.string().max(2000),
                  ref: z.string().max(151),
                }),
                z.object({
                  kind: z.literal("json"),
                  text: z.string().max(4_000_000),
                }),
              ])
              .parse(payload);
            if (input.kind === "default")
              value = harnessLibrary.add(defaultPackage(), { kind: "editor" });
            else if (input.kind === "json")
              value = harnessLibrary.add(JSON.parse(input.text), {
                kind: "editor",
              });
            else if (input.kind === "git") {
              const result = await importPackageGit(input);
              value = harnessLibrary.add(result.package, result.source);
            } else if (input.kind === "folder") {
              const chosen = await dialog.showOpenDialog(sender, {
                title: "harness.json이 있는 폴더 선택",
                properties: ["openDirectory"],
              });
              value = chosen.canceled
                ? null
                : harnessLibrary.add(
                    await importPackageFolder(chosen.filePaths[0]),
                    { kind: "folder" },
                  );
            } else {
              if (!store) throw Error("프로젝트 환경을 먼저 준비하세요.");
              const w = await store.read("owner");
              const p = w.projects.find((p) => p.id === input.projectId);
              if (!p) throw Error("프로젝트가 없습니다.");
              value = harnessLibrary.add(
                exportProject(w, p, {
                  id: p.harness?.package.id ?? `project.${p.id}`,
                  version: p.harness?.package.version ?? "1.0.0",
                  name: p.harness?.package.name ?? `${p.name} 개발 표준`,
                }),
                { kind: "editor" },
              );
            }
            break;
          }
          case "harnessExport": {
            const candidate = harnessLibrary.get(
              z.string().uuid().parse(payload),
            );
            const chosen = await dialog.showOpenDialog(sender, {
              title: "하네스 폴더를 만들 위치 선택",
              properties: ["openDirectory", "createDirectory"],
            });
            value = chosen.canceled
              ? null
              : await exportPackageFolder(
                  chosen.filePaths[0],
                  candidate.package,
                );
            break;
          }
          case "harnessApply": {
            const input = z
              .object({
                token: z.string().uuid(),
                projectId: z.string(),
                profileId: z.string(),
                expectedRevision: z.number().int().nonnegative(),
                bindings: z.record(z.string(), z.string().uuid()),
              })
              .parse(payload);
            const candidate = harnessLibrary.get(input.token);
            const bindings = Object.fromEntries(
              Object.entries(input.bindings).map(([alias, id]) => {
                const c = vault.get(id);
                return [alias, { id, version: c.info.version }];
              }),
            );
            value = await store!.execute(
              "owner",
              harnessApplyRequestId(input.token, { ...input, bindings }),
              {
                type: "apply_harness_package",
                projectId: input.projectId,
                profileId: input.profileId,
                expectedRevision: input.expectedRevision,
                package: candidate.package,
                source: candidate.source,
                bindings,
              },
            );
            break;
          }
          case "migrateEnvironment": {
            const source = store!;
            const state = await source.read("owner");
            if (
              state.runs.some(
                (r) =>
                  activeStatuses.includes(r.status) ||
                  r.runtime?.terminationConfirmed === false,
              )
            )
              throw Error("진행 중인 실행을 종료하고 다시 시도하세요.");
            migrating = true;
            let pending: Store | undefined;
            try {
              await conversations?.interruptAll();
              await runner!.stop();
              value = bootstrap.migrate(async (url, backup) => {
                pending = new Store(source.key, url, "local-owner");
                await pending.init();
                await transferWorkspace(source, pending, backup);
                const next = pending;
                return async () => {
                  store = next;
                  pending = undefined;
                  runner = new RunnerManager(
                    next,
                    vault,
                    join(app.getPath("userData"), "runs"),
                    app.isPackaged ? process.resourcesPath : resources,
                  );
                  conversations = new ConversationService(next, vault);
                  if (!closing) await runner.init();
                  await source.close();
                };
              });
              // Bootstrap owns the durable switch; keep mutations disabled until it settles.
              migrationCleanup = (async () => {
                while (bootstrap.status().busy)
                  await new Promise((r) => setTimeout(r, 100));
                await pending?.close();
                if (store === source && !closing) {
                  conversations?.resumeAdmissions();
                  await runner!.init();
                }
                migrating = false;
              })().catch(() => {
                migrating = false;
              });
            } catch (e) {
              migrating = false;
              if (!closing) {
                conversations?.resumeAdmissions();
                await runner!.init();
              }
              throw e;
            }
            break;
          }
          case "bootstrap":
            value = bootstrap.status();
            break;
          case "prepareEnvironment":
            value = bootstrap.prepare();
            break;
          case "cancelEnvironment":
            value = bootstrap.cancel();
            break;
          case "onboarding":
            value = await bootstrap.progress(payload);
            break;
          case "readMarkdown": {
            const chosen = await dialog.showOpenDialog(sender, {
              properties: ["openFile"],
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            value = chosen.canceled
              ? null
              : (
                  await readWorkspaceFile(
                    dirname(chosen.filePaths[0]),
                    basename(chosen.filePaths[0]),
                    24000,
                  )
                ).toString("utf8");
            break;
          }
          case "exportAgent": {
            const agent = latestAgents(await store!.read("owner")).find(
              (a) => a.id === z.string().uuid().parse(payload),
            );
            if (!agent) throw Error("에이전트가 없습니다.");
            const chosen = await dialog.showSaveDialog(sender, {
              defaultPath: "roopre-agent.md",
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (!chosen.canceled && chosen.filePath) {
              const file = await open(
                chosen.filePath,
                constants.O_WRONLY |
                  constants.O_CREAT |
                  constants.O_NOFOLLOW |
                  constants.O_NONBLOCK,
                0o600,
              );
              try {
                if (!(await file.stat()).isFile())
                  throw Error("일반 파일만 저장할 수 있습니다.");
                await file.truncate(0);
                await file.writeFile(exportAgentMarkdown(agent));
              } finally {
                await file.close();
              }
            }
            value = null;
            break;
          }
          case "snapshot":
            value = await store!.read("owner");
            break;
          case "conversations:listThreads":
            value = await conversations!.listThreads(
              conversationScopeSchema.parse(payload),
            );
            break;
          case "conversations:getThread":
            value = await conversations!.getThread(
              z.string().uuid().parse(payload),
            );
            break;
          case "conversations:listTurns": {
            const input = listTurnsSchema.parse(payload);
            value = await conversations!.listTurns(
              input.threadId,
              input.beforeOrdinal,
              input.limit,
            );
            break;
          }
          case "conversations:sendTurn":
            value = await conversations!.send(sendTurnSchema.parse(payload));
            break;
          case "conversations:cancelTurn": {
            const input = cancelTurnSchema.parse(payload);
            value = await conversations!.cancel(input.threadId, input.turnId);
            break;
          }
          case "conversations:resetSummary": {
            const input = resetSummarySchema.parse(payload);
            value = await conversations!.resetSummary(
              input.threadId,
              input.expectedRevision,
            );
            break;
          }
          case "conversations:deleteThread": {
            const input = deleteThreadSchema.parse(payload);
            await conversations!.deleteThread(
              input.threadId,
              input.deactivateDerivedMemoryIds,
            );
            value = null;
            break;
          }
          case "command": {
            const c = commandSchema.parse(payload);
            if (c.type === "save_agent" && c.agent.connectionId) {
              c.agent.connectionVersion = vault.get(
                c.agent.connectionId,
              ).info.version;
            }
            if (c.type === "apply_harness_package")
              throw Error("하네스 미리보기 적용 경로를 사용하세요.");
            if (c.type === "configure_execution")
              throw Error("저장소 선택 경로를 사용하세요.");
            if (c.type === "review" && c.decision === "approve") {
              const w = await store!.read("owner");
              const f = w.features.find((f) => f.id === c.featureId);
              if (!f || f.designs.at(-1)?.id !== c.designId)
                throw Error("최신 설계를 확인하세요.");
              const binding = approvalBinding(w, f);
              if (c.confirmationBinding !== binding)
                throw Error(
                  "설계 보고서가 변경됐습니다. 최신 내용을 읽고 다시 승인하세요.",
                );
              value = await store!.execute("owner", randomUUID(), c, {
                binding,
                authentication: "app-confirmation",
              });
            } else value = await store!.execute("owner", randomUUID(), c);
            break;
          }
          case "connections":
            value = vault.list();
            break;
          case "saveConnection":
            value = await vault.save(connectionInputSchema.parse(payload));
            break;
          case "removeConnection":
            value = await vault.remove(z.string().uuid().parse(payload));
            break;
          case "testConnection":
            value = await vault.test(z.string().uuid().parse(payload));
            break;
          case "gitHostConnections":
            value = gitHostVault.list();
            break;
          case "saveGitHostConnection":
            value = await gitHostVault.save(
              gitHostConnectionInputSchema.parse(payload),
            );
            break;
          case "removeGitHostConnection":
            value = await gitHostVault.remove(z.string().uuid().parse(payload));
            break;
          case "testGitHostConnection":
            value = await gitHostVault.test(z.string().uuid().parse(payload));
            break;
          case "chooseRepository": {
            const result = await dialog.showOpenDialog(sender, {
              properties: ["openDirectory"],
              title: "개발할 Git 저장소 선택",
            });
            if (result.canceled) {
              value = null;
              break;
            }
            const path = await git(
              result.filePaths[0],
              "rev-parse",
              "--show-toplevel",
            );
            const origin = await git(path, "remote", "get-url", "origin").catch(
              () => "",
            );
            let remote;
            if (origin) {
              try {
                remote = parseGitRemote(origin);
              } catch {
                // A local, credential-bearing, or otherwise unsupported remote still works locally.
              }
            }
            value = {
              path,
              branch: await git(path, "branch", "--show-current"),
              commit: await git(path, "rev-parse", "HEAD"),
              ...(await detectRepositoryRuntime(path)),
              ...(remote ? { remote } : {}),
            };
            break;
          }
          case "configureProject": {
            const input = z
              .object({ projectId: z.string(), profile: profileSchema })
              .parse(payload);
            const p = input.profile;
            p.repositoryPath = await git(
              p.repositoryPath,
              "rev-parse",
              "--show-toplevel",
            );
            p.runtime = (
              await detectRepositoryRuntime(p.repositoryPath)
            ).runtime;
            p.baseCommit = await git(
              p.repositoryPath,
              "rev-parse",
              p.baseBranch,
            );
            const connection = vault.get(p.connectionId);
            p.connectionVersion = connection.info.version;
            if (p.gitHost?.connectionId) {
              const hostConnection = gitHostVault.get(
                p.gitHost.connectionId,
              ).info;
              if (
                hostConnection.host !== p.gitHost.remote.host ||
                (p.gitHost.remote.kind &&
                  hostConnection.kind !== p.gitHost.remote.kind)
              )
                throw Error(
                  "Git host 연결과 저장소 remote가 일치하지 않습니다.",
                );
              if (hostConnection.testStatus !== "passed")
                throw Error(
                  "Git host 연결을 검사한 뒤 실행 프로필을 저장하세요.",
                );
            }
            const image = await command("docker", [
              "image",
              "inspect",
              "--format",
              "{{.Id}}",
              p.image,
            ]);
            if (image.code !== 0)
              throw Error(
                "실행 이미지가 없습니다. 시작 가이드에서 환경을 준비하세요.",
              );
            p.image = image.output.trim();
            value = await store!.execute("owner", randomUUID(), {
              type: "configure_execution",
              projectId: input.projectId,
              profile: p,
            });
            break;
          }
          case "deliverRun": {
            const input = z
              .object({
                runId: z.string().min(1),
                title: z.string().trim().min(1).max(180),
                body: z.string().max(60000),
              })
              .parse(payload);
            const workspace = await store!.read("owner");
            const run = workspace.runs.find((item) => item.id === input.runId);
            if (
              !run?.runtime ||
              run.status !== "ready_for_merge" ||
              !run.runtime.terminationConfirmed
            )
              throw Error(
                "검증과 독립 리뷰가 끝난 실행만 원격에 전달할 수 있습니다.",
              );
            const feature = workspace.features.find(
              (item) => item.id === run.featureId,
            )!;
            const profile = run.runtime.profile;
            const binding = profile.gitHost;
            if (!binding)
              throw Error(
                "프로젝트 실행 설정에서 Git remote를 먼저 감지하세요.",
              );
            const lock = `${feature.projectId}:${binding.remote.host}:${run.runtime.branch}`;
            if (deliveryLocks.has(lock))
              throw Error("같은 원격 branch의 전달 작업이 진행 중입니다.");
            deliveryLocks.add(lock);
            try {
              const worktree = run.runtime.worktree;
              const branch = run.runtime.branch;
              const head = run.runtime.head;
              if (!worktree || !branch || !head)
                throw Error("전달할 worktree·branch·commit 근거가 없습니다.");
              if ((await git(worktree, "rev-parse", "HEAD")) !== head)
                throw Error(
                  "worktree head가 검증 근거와 달라졌습니다. 새 실행이 필요합니다.",
                );
              if (
                (await git(worktree, "rev-parse", profile.baseBranch)) !==
                profile.baseCommit
              )
                throw Error(
                  "기준 브랜치가 변경됐습니다. 최신 base에서 다시 검증하세요.",
                );
              const remoteHead = await git(
                worktree,
                "ls-remote",
                "--heads",
                binding.remote.url,
                `refs/heads/${branch}`,
              );
              const existing = remoteHead.trim().split(/\s+/)[0];
              if (existing && existing !== head)
                throw Error(
                  "원격 branch가 다른 commit을 가리킵니다. 새 attempt branch를 사용하세요.",
                );
              if (!existing)
                await git(
                  worktree,
                  "push",
                  binding.remote.url,
                  `${head}:refs/heads/${branch}`,
                );
              let delivery: NonNullable<typeof run.runtime.delivery>;
              if (binding.connectionId) {
                const connection = gitHostVault.get(binding.connectionId);
                if (connection.info.testStatus !== "passed")
                  throw Error("Git host 연결을 다시 검사하세요.");
                const change = await new GitHostAdapter(
                  connection.info,
                  connection.token,
                ).createDraftChange({
                  remote: binding.remote,
                  head: branch,
                  base: profile.baseBranch,
                  title: input.title,
                  body: input.body,
                });
                if (
                  change.headSha !== head ||
                  change.baseSha !== profile.baseCommit
                )
                  throw Error(
                    "Draft PR/MR의 head 또는 base SHA가 검증 근거와 다릅니다.",
                  );
                delivery = {
                  provider: connection.info.kind,
                  branch,
                  headSha: head,
                  baseSha: profile.baseCommit,
                  changeId: change.id,
                  url: change.url,
                  deliveredAt: new Date().toISOString(),
                };
              } else {
                delivery = {
                  provider: "generic",
                  branch,
                  headSha: head,
                  baseSha: profile.baseCommit,
                  deliveredAt: new Date().toISOString(),
                };
              }
              await store!.mutate((current) => {
                const currentRun = current.runs.find(
                  (item) => item.id === run.id,
                );
                if (
                  !currentRun?.runtime ||
                  currentRun.status !== "ready_for_merge" ||
                  currentRun.runtime.head !== head ||
                  currentRun.runtime.profile.baseCommit !== profile.baseCommit
                )
                  throw Error(
                    "실행 계약이 변경됐습니다. 원격 전달을 다시 확인하세요.",
                  );
                currentRun.runtime.delivery = delivery;
                currentRun.reason = delivery.url
                  ? "Draft PR/MR을 만들었습니다. host의 검사와 사람 승인을 확인하세요."
                  : "원격 branch를 게시했습니다. 이 host의 PR/MR은 외부에서 만드세요.";
              });
              value = { url: delivery.url, branch };
            } finally {
              deliveryLocks.delete(lock);
            }
            break;
          }
          case "diagnostics": {
            const docker = await command(
              "docker",
              ["info", "--format", "{{.ServerVersion}}"],
              { timeout: 6000 },
            ).catch(() => ({ code: 1 }));
            const image = await command(
              "docker",
              ["image", "inspect", "roopre-runner:0.3"],
              { timeout: 6000 },
            ).catch(() => ({ code: 1 }));
            value = {
              docker: docker.code === 0,
              image: image.code === 0,
              approvalHelper: false,
              message:
                "로컬 파일럿 · 실제 팀 인증은 M3 · 앱 종료/맥 sleep 시 작업 중단 가능",
            };
            break;
          }
          case "revealArtifact": {
            const a = z
              .object({
                runId: z.string(),
                index: z.number().int().nonnegative(),
              })
              .parse(payload);
            const r = (await store!.read("owner")).runs.find(
              (r) => r.id === a.runId,
            );
            const file = r?.runtime?.artifacts?.[a.index];
            if (!file || !r?.runtime?.artifactRoot)
              throw Error("산출물이 없습니다.");
            shell.showItemInFolder(
              await checkedArtifact(
                r.runtime.artifactRoot,
                file.path,
                file.hash,
              ),
            );
            value = null;
            break;
          }
          case "runAction": {
            const a = z
              .object({ id: z.string(), action: z.enum(["retry", "diff"]) })
              .parse(payload);
            value =
              a.action === "retry"
                ? JSON.stringify(await runner!.retry(a.id))
                : await runner!.diff(a.id);
            break;
          }
          default:
            throw Error("지원하지 않는 요청입니다.");
        }
        return { ok: true, value };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof z.ZodError
              ? "입력 형식을 확인하세요."
              : operation.startsWith("conversations:") &&
                  !(
                    e instanceof Error &&
                    /^(프로젝트|이 프로젝트|이 에이전트|보관된|선택한|에이전트 연결|검증된 AI|다른 워크스페이스|대화가|동시에 상담|이미 사용|삭제된 대화|대화 저장 공간|필수 상담 맥락|진행 중인 상담|중지할 파생 기억|대기·실행)/.test(
                      e.message,
                    )
                  )
                ? "상담 요청을 처리하지 못했습니다. 입력은 유지됩니다."
                : e instanceof Error
                  ? e.message
                  : "요청을 처리하지 못했습니다.",
        };
      }
    },
  );
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void bootstrap
      .stop()
      .then(() => restoration)
      .then(() => migrationCleanup)
      .then(() => runner?.stop())
      .then(() => conversations?.interruptAll())
      .catch(() => {
        // A DB failure leaves pending rows for startup recovery; never resend.
      })
      .finally(async () => {
        await store?.close();
        app.quit();
      });
  });
}
