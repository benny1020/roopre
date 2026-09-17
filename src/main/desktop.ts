import { checkedArtifact } from "../runner/artifacts.ts";
import { shell } from "electron";
import { app, ipcMain, dialog, BrowserWindow, safeStorage } from "electron";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "../database/store.ts";
import { commandSchema } from "../shared/contracts.ts";
import { profileSchema, connectionInputSchema } from "../shared/runtime.ts";
import { approvalBinding } from "../domain/runtime.ts";
import { ConnectionVault } from "./connections/vault.ts";
import { authenticateOwner } from "./approval/native.ts";
import { RunnerManager } from "../runner/manager.ts";
import { command, git } from "../runner/process.ts";
export async function installDesktop() {
  const store = new Store("roopre-owner-v02", undefined, "local-owner");
  await store.init();
  const resources = join(app.getAppPath(), "resources");
  const helper = app.isPackaged
    ? join(process.resourcesPath, "roopre-approve")
    : join(resources, "bin/roopre-approve");
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
  const runner = new RunnerManager(
    store,
    vault,
    join(app.getPath("userData"), "runs"),
    app.isPackaged ? process.resourcesPath : resources,
  );
  await runner.init();
  let authenticating = false;
  ipcMain.handle(
    "roopre:request",
    async (event, operation: string, payload: unknown) => {
      const sender = BrowserWindow.fromWebContents(event.sender);
      const url = event.senderFrame?.url;
      if (
        !sender ||
        event.senderFrame !== event.sender.mainFrame ||
        !url ||
        !(app.isPackaged
          ? url.startsWith("file://")
          : url.startsWith("http://127.0.0.1:4317/") ||
            url.startsWith("http://localhost:4317/"))
      )
        return { ok: false, error: "허용되지 않은 앱 요청입니다." };
      try {
        let value: unknown;
        switch (operation) {
          case "snapshot":
            value = await store.read("owner");
            break;
          case "command": {
            const c = commandSchema.parse(payload);
            if (c.type === "configure_execution")
              throw Error("저장소 선택 경로를 사용하세요.");
            if (c.type === "review" && c.decision === "approve") {
              if (authenticating)
                throw Error("진행 중인 본인 확인을 완료하세요.");
              authenticating = true;
              try {
                const w = await store.read("owner");
                const f = w.features.find((f) => f.id === c.featureId);
                if (!f || f.designs.at(-1)?.id !== c.designId)
                  throw Error("최신 설계를 확인하세요.");
                const binding = approvalBinding(w, f);
                await authenticateOwner(
                  helper,
                  `루프리: ${f.title.slice(0, 70)} 설계 v${f.designs.at(-1)!.number} 승인`,
                );
                value = await store.execute("owner", randomUUID(), c, {
                  binding,
                  authentication: "macos-owner",
                });
              } finally {
                authenticating = false;
              }
            } else value = await store.execute("owner", randomUUID(), c);
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
            value = {
              path,
              branch: await git(path, "branch", "--show-current"),
              commit: await git(path, "rev-parse", "HEAD"),
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
            p.baseCommit = await git(
              p.repositoryPath,
              "rev-parse",
              p.baseBranch,
            );
            const connection = vault.get(p.connectionId);
            p.connectionVersion = connection.info.version;
            const image = await command("docker", [
              "image",
              "inspect",
              "--format",
              "{{.Id}}",
              p.image,
            ]);
            if (image.code !== 0)
              throw Error(
                "실행 이미지가 없습니다. pnpm runner:image로 준비하세요.",
              );
            p.image = image.output.trim();
            value = await store.execute("owner", randomUUID(), {
              type: "configure_execution",
              projectId: input.projectId,
              profile: p,
            });
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
              ["image", "inspect", "roopre-runner:0.2"],
              { timeout: 6000 },
            ).catch(() => ({ code: 1 }));
            value = {
              docker: docker.code === 0,
              image: image.code === 0,
              approvalHelper: existsSync(helper),
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
            const r = (await store.read("owner")).runs.find(
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
                ? JSON.stringify(await runner.retry(a.id))
                : await runner.diff(a.id);
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
              : e instanceof Error
                ? e.message
                : "요청을 처리하지 못했습니다.",
        };
      }
    },
  );
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void runner.stop().finally(async () => {
      await store.close();
      app.quit();
    });
  });
}
