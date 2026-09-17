// The unprivileged sidecar forwards only to the fixed host broker. No API key lives here.
const http = require("node:http");
http
  .createServer((req, res) => {
    const upstream = http.request(
      {
        hostname: "host.docker.internal",
        port: process.env.BROKER_PORT,
        path: req.url,
        method: req.method,
        headers: {
          "content-type": "application/json",
          "x-api-key": req.headers["x-api-key"] || "",
          "anthropic-beta": req.headers["anthropic-beta"] || "",
        },
      },
      (r) => {
        res.writeHead(r.statusCode, {
          "content-type": r.headers["content-type"] || "application/json",
        });
        r.on("error", () => res.destroy());
        r.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    upstream.setTimeout(180000, () => upstream.destroy());
    req.pipe(upstream);
  })
  .listen(8080, "0.0.0.0");
