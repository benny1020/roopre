import { Store } from "../database/store.ts";
import { createApp } from "./app.ts";
// Keep the old demo workspace untouched; normal preview starts without samples.
const store = new Store("local-preview-v1");
await store.init();
const app = await createApp(store);
await app.listen({ host: "127.0.0.1", port: 4318 });
console.log(
  "Roopre API: http://127.0.0.1:4318 (local development fixture, no agent runner)",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    await store.close();
    process.exit(0);
  });
