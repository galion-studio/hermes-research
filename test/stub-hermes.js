// Loopback Hermes stub. Tests speak to this process. It never calls out.

import { createServer } from "node:http";

export function stubHermes(script) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      calls.push({
        url: req.url || "",
        host: req.headers.host || "",
        authorization: req.headers.authorization || "",
        body,
      });
      Promise.resolve()
        .then(() => (typeof script === "function" ? script({ url: req.url, body, calls }) : script))
        .then((step) => {
          if (!step || step.hang) return;
          if (step.down) {
            res.writeHead(step.status || 503, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("down");
            return;
          }
          const content = step.content ?? "";
          const payload = JSON.stringify({ choices: [{ message: { content } }] });
          res.writeHead(step.status || 200, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          });
          res.end(payload);
        })
        .catch(() => {
          if (res.writableEnded) return;
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("stub");
        });
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        calls,
        port,
        url: `http://127.0.0.1:${port}/v1/chat/completions`,
        close() {
          return new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
  });
}
