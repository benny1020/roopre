import { spawn } from "node:child_process";
import { createServer } from "node:net";
// Check before launching so a second dev command cannot reuse another API.
for (const port of [4317, 4318]) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is in use. Stop the previous Roopre/Team Devflow session first.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
function launch(script) {
  const child = spawn("pnpm", ["run", script], {
    stdio: "inherit",
    detached: true,
    env: process.env,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
launch("server");
let ready = false;
for (let i = 0; i < 60 && !stopping; i++) {
  try {
    if ((await fetch("http://127.0.0.1:4318/health")).ok) {
      ready = true;
      break;
    }
  } catch {
    /* API starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (ready && !stopping) launch("dev:desktop");
else if (!stopping) {
  console.error("API not ready. Run pnpm db:start first.");
  stop(1);
}
