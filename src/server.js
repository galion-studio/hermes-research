// Galion Research. The page, the galion-one-voice /research backend, and Hermes.
// The gateway key is read from the environment inside the Hermes client. It is not logged.

import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { createDesk } from "./desk.js";
import { LLM_NAME, configFromEnv, isLoopback, keyState } from "./hermes.js";

const PAGE = readFileSync(fileURLToPath(new URL("../public/research.html", import.meta.url)));

export function researchOrigin(raw) {
  if (!raw || !String(raw).trim()) return null;
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLoopback(url.hostname)) return url.origin;
  return null;
}

export function oneTarget(raw) {
  const origin = researchOrigin(raw);
  if (!origin) return "https://galion.app/one";
  if (String(raw).trim() === origin) return `${origin}/one`;
  try {
    const url = new URL(String(raw).trim());
    if (url.pathname && url.pathname !== "/") return url.origin + url.pathname;
  } catch {
    return "https://galion.app/one";
  }
  return `${origin}/one`;
}

function readBody(req, limit = 32_768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("limit"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function proxy(origin, path, init) {
  const response = await fetch(new URL(path, origin), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  const text = await response.text();
  return { status: response.status, text };
}

function send(res, status, type, body) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function json(res, status, value) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

export function createApp(env = process.env) {
  const hermes = configFromEnv(env);
  const desk = createDesk(hermes);
  const upstream = researchOrigin(env.GALION_RESEARCH_URL);
  const one = oneTarget(env.GALION_ONE_URL || "https://galion.app/one");
  let upstreamLive = Boolean(upstream);

  async function fromUpstream(path, init) {
    if (!upstream || !upstreamLive) return null;
    try {
      const result = await proxy(upstream, path, init);
      if (result.status >= 200 && result.status < 300) return result;
      if (result.status === 400) return result;
    } catch {
      upstreamLive = false;
    }
    upstreamLive = false;
    return null;
  }

  return async function handle(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method || "GET";

    if (method === "GET" && path === "/health") {
      json(res, 200, { ok: true, service: "galion-research", bind: "127.0.0.1" });
      return;
    }

    if (method === "GET" && (path === "/" || path === "/research" || path === "/research/")) {
      send(res, 200, "text/html; charset=utf-8", PAGE);
      return;
    }

    if (method === "GET" && (path === "/one" || path === "/one/")) {
      res.writeHead(302, { Location: one, "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (method === "GET" && path === "/research/hermes") {
      const proxied = await fromUpstream("/research/hermes");
      if (proxied) {
        send(res, proxied.status, "application/json; charset=utf-8", proxied.text);
        return;
      }
      const body = desk.statusBody();
      if (upstream) body.upstream = "down";
      json(res, 200, body);
      return;
    }

    if (method === "GET" && path === "/research/history") {
      const proxied = await fromUpstream("/research/history");
      if (proxied) {
        send(res, proxied.status, "application/json; charset=utf-8", proxied.text);
        return;
      }
      json(res, 200, desk.historyBody());
      return;
    }

    if (method === "POST" && path === "/research/ask") {
      let raw = "";
      try {
        raw = await readBody(req);
      } catch {
        send(res, 413, "text/plain; charset=utf-8", "question");
        return;
      }
      let question = "";
      try {
        const parsed = JSON.parse(raw);
        question = typeof parsed.question === "string" ? parsed.question.trim() : "";
      } catch {
        question = "";
      }
      if (!question) {
        send(res, 400, "text/plain; charset=utf-8", "question");
        return;
      }
      const proxied = await fromUpstream("/research/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (proxied) {
        send(res, proxied.status, proxied.status === 400 ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", proxied.text);
        return;
      }
      const body = await desk.ask(question);
      if (hermes.key && JSON.stringify(body).includes(hermes.key)) {
        json(res, 200, {
          schema: "galion-research/1",
          app: "hermes",
          model: hermes.model || LLM_NAME,
          status: "Local",
          question: "",
          reply: "Local. The research path is not reachable from here.",
          citations: [],
          found: [],
          inferred: [],
          unknown: ["Local. The research path is not reachable from here."],
          helpers: "Helpers are quiet. Local knowledge carries the question.",
          key: keyState(hermes.key),
        });
        return;
      }
      json(res, 200, body);
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", "not found");
  };
}

export function start(options = {}) {
  const env = options.env || process.env;
  const server = http.createServer(createApp(env));
  const port = options.port ?? Number(env.PORT || 8787);
  const host = "127.0.0.1";
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  start().then((server) => {
    const address = server.address();
    console.log(`Galion Research http://127.0.0.1:${address.port}/research`);
  });
}
