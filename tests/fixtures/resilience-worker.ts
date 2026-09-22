// Dedicated test process. Fake provider only; never used by the product.
import { readFile } from "node:fs/promises";
import { Store } from "../../src/database/store.ts";
import { RunnerManager } from "../../src/runner/manager.ts";
import type { ConnectionVault } from "../../src/main/connections/vault.ts";
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const store = new Store(config.workspace, undefined, "local-owner");
const vault = {
  get: (id: string) => ({
    info: {
      id,
      name: "Resilience fixture",
      endpoint: "https://invalid.example",
      auth: "api-key",
      model: "fixture-model",
      version: 1,
      hasKey: true,
      testStatus: "passed",
    },
    key: "not-a-real-key",
  }),
} as unknown as ConnectionVault;
const runner = new RunnerManager(store, vault, config.runs, config.resources);
await runner.init();
process.send?.({ ready: true });
process.on("message", async (message) => {
  if (message !== "stop") return;
  await runner.stop();
  await store.close();
  process.exit(0);
});
