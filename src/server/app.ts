import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { Store } from "../database/store.ts";
import { commandSchema } from "../shared/contracts.ts";
import { DomainError } from "../domain/index.ts";

export async function createApp(store: Store) {
  const app = Fastify({ logger: false, bodyLimit: 150000 });
  const origins = ["http://127.0.0.1:4317", "http://localhost:4317"];
  app.addHook("onRequest", async (request, reply) => {
    // CORS alone does not stop requests. This is a loopback development fixture,
    // never an authenticated server for other sites or DNS-rebound hosts.
    if (
      !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? "") ||
      (request.headers.origin !== undefined &&
        !origins.includes(request.headers.origin))
    )
      return reply.status(403).send({
        code: "forbidden_origin",
        message: "Accessible only from the local development UI.",
      });
  });
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST"],
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError)
      return reply
        .status(error.status)
        .send({ code: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply.status(400).send({
        code: "invalid_input",
        message: "Check the input fields.",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if ((error as { statusCode?: number }).statusCode === 400)
      return reply.status(400).send({
        code: "invalid_json",
        message: "Check the JSON request format.",
      });
    if ((error as { statusCode?: number }).statusCode === 413)
      return reply.status(413).send({
        code: "payload_too_large",
        message: "Request size limit exceeded.",
      });
    console.error("Roopre development API request failed");
    return reply.status(500).send({
      code: "internal_error",
      message: "Could not save. Check the connection and try again.",
    });
  });
  app.get("/health", async () => ({
    ok: true,
    mode: "development-fixture",
    runnerConnected: false,
  }));
  app.get("/state", async (request) =>
    store.read(String(request.headers["x-devflow-actor"] || "")),
  );
  app.post("/commands", async (request) => {
    const envelope = z
      .object({ requestId: z.string().uuid(), command: commandSchema })
      .parse(request.body);
    return store.execute(
      String(request.headers["x-devflow-actor"] || ""),
      envelope.requestId,
      envelope.command,
    );
  });
  const closeStreams = new Set<() => void>();
  app.get("/events", async (request, reply) => {
    const query = z
      .object({
        actor: z.string(),
        after: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(request.query);
    await store.read(query.actor);
    let cursor = Math.max(
      query.after,
      Number(request.headers["last-event-id"] || 0),
    );
    if (!Number.isSafeInteger(cursor))
      throw new DomainError("invalid_cursor", "Invalid event position.", 400);
    reply.hijack();
    const origin = request.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(origin && origins.includes(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
    });
    reply.raw.write("retry: 1000\n: connected\n\n");
    let busy = false;
    let closed = false;
    const poll = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const events = await store.events(query.actor, cursor);
        for (const event of events) {
          if (closed) break;
          reply.raw.write(
            `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          cursor = event.sequence;
        }
      } catch {
        close();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(poll, 400);
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(": heartbeat\n\n");
    }, 10000);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      closeStreams.delete(close);
      reply.raw.end();
    };
    closeStreams.add(close);
    request.raw.on("close", close);
    void poll();
  });
  app.addHook("onClose", async () => {
    for (const close of closeStreams) close();
  });
  return app;
}
