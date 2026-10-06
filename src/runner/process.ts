import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
export async function command(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    input?: string;
    onLine?: (line: string) => void;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return new Promise<{
    code: number;
    output: string;
    outputTruncated: boolean;
  }>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? {
        PATH: [
          process.env.PATH,
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/usr/bin",
          "/bin",
        ]
          .filter(Boolean)
          .join(":"),
        HOME: process.env.HOME,
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "",
      pending = "";
    let settled = false;
    let terminated = false;
    let outputTruncated = false;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const append = (text: string) => {
      if (output.length + text.length > 200000) outputTruncated = true;
      output = (output + text).slice(-200000);
    };
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (settled || terminated) return;
      terminated = true;
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {}
      forceStop = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
      }, 1500).unref();
    };
    const timer = setTimeout(stop, options.timeout ?? 60000);
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    const add = (b: Buffer) => {
      const t = stdoutDecoder.write(b);
      append(t);
      pending += t;
      const lines = pending.split("\n");
      pending = lines.pop()!.slice(-200000);
      for (const line of lines) options.onLine?.(line);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", (b: Buffer) => {
      append(stderrDecoder.write(b));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
    const cleanup = () => {
      clearTimeout(timer);
      if (forceStop) clearTimeout(forceStop);
      options.signal?.removeEventListener("abort", stop);
    };
    child.on("error", () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(Error(`${file} Could not find or start the executable.`));
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        cleanup();
        const tail = stdoutDecoder.end();
        append(tail + stderrDecoder.end());
        pending += tail;
        if (pending) options.onLine?.(pending);
        resolve({
          code: terminated ? -1 : (code ?? -1),
          output,
          outputTruncated,
        });
      }
    });
  });
}
export async function git(cwd: string, ...args: string[]) {
  const r = await command("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: {
      PATH: [
        process.env.PATH,
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
      ]
        .filter(Boolean)
        .join(":"),
      HOME: process.env.HOME,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  if (r.code !== 0)
    throw Error(
      `Git ${args[0]} failed. Check repository, branch and permissions.`,
    );
  if (r.outputTruncated)
    throw Error(
      "Git output exceeds the review limit. Execution stopped to avoid a partial review. Reduce the scope.",
    );
  // Preserve leading/trailing whitespace in NUL-delimited filenames.
  return args.includes("-z") ? r.output : r.output.trim();
}
