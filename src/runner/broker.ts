import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { modelUrl } from "../main/connections/vault.ts";
import type { ConnectionInfo } from "../shared/runtime.ts";
export function sameToken(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function startBroker(
  info: ConnectionInfo,
  key: string,
  token: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  let requests = 0;
  const controllers = new Set<AbortController>();
  const server = createServer(async (req, res) => {
    if (
      !sameToken(
        String(
          req.headers["x-api-key"] ??
            req.headers.authorization?.replace(/^Bearer /, "") ??
            "",
        ),
        token,
      )
    ) {
      res.writeHead(401).end();
      return;
    }
    if (
      req.method !== "POST" ||
      ![
        "/v1/messages",
        "/v1/messages?beta=true",
        "/v1/messages/count_tokens",
        "/v1/messages/count_tokens?beta=true",
      ].includes(req.url ?? "")
    ) {
      res.writeHead(404).end();
      return;
    }
    if (signal.aborted || ++requests > 500) {
      res.writeHead(429).end();
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 180000);
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8_000_000) throw Error("size");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks, bytes).toString("utf8");
      const parsed = JSON.parse(body);
      if (parsed.model !== info.model) {
        res.writeHead(403).end();
        return;
      }
      if (parsed.max_tokens && parsed.max_tokens > 64000) {
        res.writeHead(400).end();
        return;
      }
      const url =
        modelUrl(info.endpoint) +
        (req.url!.includes("count_tokens") ? "/count_tokens" : "");
      const upstream = await request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(req.headers["anthropic-beta"]
            ? { "anthropic-beta": String(req.headers["anthropic-beta"]) }
            : {}),
          ...(info.auth === "api-key"
            ? { "x-api-key": key }
            : { authorization: `Bearer ${key}` }),
        },
        body,
        redirect: "error",
        signal: controller.signal,
      });
      res.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "api_error",
              message: `Configured gateway returned HTTP ${upstream.status}`,
            },
          }),
        );
        return;
      }
      if (upstream.body)
        for await (const chunk of upstream.body) {
          if (!res.write(chunk))
            await new Promise<void>((resolve) => {
              const done = () => {
                res.off("drain", done);
                res.off("close", done);
                resolve();
              };
              res.once("drain", done);
              res.once("close", done);
            });
          if (res.destroyed) break;
        }
      res.end();
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "Model gateway unavailable" },
        }),
      );
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Broker address unavailable");
  const close = () => {
    signal.removeEventListener("abort", close);
    for (const c of controllers) c.abort();
    server.closeAllConnections();
    server.close();
  };
  signal.addEventListener("abort", close, { once: true });
  return { port: address.port, close };
}
