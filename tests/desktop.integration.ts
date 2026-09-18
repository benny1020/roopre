import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";
import { command } from "../src/runner/process.ts";

test(
  "Electron startup survives a missing DB, retries, then closes cleanly without touching the real profile",
  { timeout: 20000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "roopre-native-startup-"));
    try {
      const report = join(root, "dialogs.json");
      const entry = join(root, "main.mjs");
      // Native dialog response is an explicit fixture, never owner authentication.
      // The built application's actual startup, pool cleanup and retry loop run.
      await writeFile(
        entry,
        `import { app, dialog } from 'electron';
import { writeFileSync } from 'node:fs';
app.setPath('appData', ${JSON.stringify(root)});
const dialogs = [];
dialog.showMessageBox = async (options) => {
  dialogs.push({ message: options.message, detail: options.detail, buttons: options.buttons });
  writeFileSync(${JSON.stringify(report)}, JSON.stringify(dialogs));
  return { response: dialogs.length === 1 ? 0 : 2 };
};
await import(${JSON.stringify(pathToFileURL(resolve("out/main/index.js")).href)});
`,
      );
      const result = await command(electron as unknown as string, [entry], {
        timeout: 15000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          DEVFLOW_DATABASE_URL:
            "postgres://fixture:never-a-real-secret@127.0.0.1:1/unavailable",
        },
      });
      assert.equal(result.code, 0, result.output);
      const dialogs = JSON.parse(await readFile(report, "utf8"));
      assert.equal(dialogs.length, 2);
      assert(
        dialogs.every((d: { detail: string }) =>
          d.detail.includes("PostgreSQL"),
        ),
      );
      assert(!JSON.stringify(dialogs).includes("never-a-real-secret"));
      assert.deepEqual(dialogs[0].buttons, [
        "다시 연결",
        "설치 안내 열기",
        "종료",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
