// Loopback stand-in for Hermes. /health answers. Everything else hangs or resets.
// The desk tests point at this process. It never calls out.

import http from "node:http";

const port = Number(process.env.PORT || 0);
const mode = process.env.FIXTURE === "reset" ? "reset" : "hang";

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("ok");
    return;
  }
  if (mode === "reset") {
    req.socket.destroy();
    return;
  }
});

server.listen(port, "127.0.0.1");
