// Galion Research. The page, the galion-one-voice /research backend, and Hermes.
// The gateway key is read from the environment inside the Hermes client. It is not logged.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { HELPERS_OFFLINE, createDesk } from "./desk.js";
import { newNonce, securityHeaders, withNonce } from "./headers.js";
import { localKnowledge } from "./local.js";
import { LLM_NAME, configFromEnv, isLoopback, keyState } from "./hermes.js";
import {
  BAD_JSON,
  BODY_LIMIT,
  BODY_TOO_LONG,
  EMPTY_QUESTION,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  QUESTION_LIMIT,
  QUESTION_TOO_LONG,
  RATE_LIMITED,
  UPSTREAM_REFUSED,
  createRateLimiter,
  errorBody,
  questionLength,
  rateLimitsFromEnv,
} from "./limits.js";

export { BODY_LIMIT, QUESTION_LIMIT };

export const BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;

const PAGE = readFileSync(fileURLToPath(new URL("../public/research.html", import.meta.url)), "utf8");

const ALLOW = Object.freeze({
  "/favicon.ico": "GET",
  "/health": "GET",
  "/": "GET",
  "/research": "GET",
  "/research/": "GET",
  "/one": "GET",
  "/one/": "GET",
  "/research/hermes": "GET",
  "/research/history": "GET",
  "/research/sources": "GET",
  "/research/ask": "POST",
});

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

export function newSessionId() {
  return randomBytes(16).toString("hex");
}

export function sessionToken(value) {
  const text = String(value || "");
  if (/^[a-f0-9]{32}$/.test(text)) return text;
  const match = /(?:^|;\s*)research_session=([a-f0-9]{32})\b/.exec(text);
  return match ? match[1] : null;
}

export function sessionCookie(id) {
  return `research_session=${id}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function listenTarget(options = {}, env = process.env) {
  const raw = options.port != null && options.port !== "" ? options.port : env.PORT;
  const port = raw == null || raw === "" ? DEFAULT_PORT : Number(raw);
  return { host: BIND_HOST, port };
}

function declaredLength(req) {
  const raw = req.headers["content-length"];
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(String(raw))) return Number.NaN;
  return Number(raw);
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        req.pause();
        reject(Object.assign(new Error("limit"), { code: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!settled) reject(err);
    });
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

function send(res, status, type, body, nonce = newNonce(), extra) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    ...securityHeaders(nonce),
    "Content-Type": type,
    "Content-Length": payload.length,
    ...extra,
  });
  res.end(payload);
}

function json(res, status, value, extra) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value), newNonce(), extra);
}

function sendEmpty(res, status, extra) {
  res.writeHead(status, { ...securityHeaders(newNonce()), ...extra });
  res.end();
}

function isErrorDocument(parsed) {
  return Boolean(parsed && parsed.schema === "galion-research/1" && parsed.status === "Error" && Array.isArray(parsed.citations));
}

function sendProxied(res, proxied) {
  let parsed = null;
  if (proxied.text) {
    try {
      parsed = JSON.parse(proxied.text);
    } catch {
      parsed = null;
    }
  }
  if (proxied.status >= 200 && proxied.status < 300) {
    send(res, proxied.status, "application/json; charset=utf-8", proxied.text);
    return;
  }
  if (isErrorDocument(parsed)) {
    json(res, proxied.status, parsed);
    return;
  }
  const status = proxied.status >= 400 && proxied.status <= 599 ? proxied.status : 502;
  json(res, status, errorBody("upstream", UPSTREAM_REFUSED));
}

export function createApp(env = process.env) {
  const hermes = configFromEnv(env);
  const desk = createDesk(hermes);
  const upstream = researchOrigin(env.GALION_RESEARCH_URL);
  const one = oneTarget(env.GALION_ONE_URL || "https://galion.app/one");
  const limiter = createRateLimiter(rateLimitsFromEnv(env));
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
    const fromCookie = sessionToken(req.headers.cookie);
    const fromHeader = sessionToken(req.headers["x-research-session"]);
    const presented = fromCookie || fromHeader;

    function fail(status, code, reply, extra) {
      json(res, status, errorBody(code, reply), extra);
      req.resume();
    }

    const declared = declaredLength(req);
    if (Number.isNaN(declared) || (declared != null && declared > BODY_LIMIT)) {
      fail(413, "too-large", BODY_TOO_LONG);
      return;
    }

    const kind = method === "POST" && path === "/research/ask" ? "ask" : "request";
    const gate = limiter.hit(presented || "anon", kind);
    if (!gate.ok) {
      fail(429, "rate", RATE_LIMITED, { "Retry-After": String(gate.retryAfter) });
      return;
    }

    const sessionId = presented || newSessionId();
    if (!fromCookie) res.setHeader("Set-Cookie", sessionCookie(sessionId));

    const allowed = ALLOW[path];
    if (allowed && method !== allowed) {
      fail(405, "method", METHOD_NOT_ALLOWED, { Allow: allowed });
      return;
    }

    if (method === "GET" && path === "/favicon.ico") {
      sendEmpty(res, 204);
      return;
    }

    if (method === "GET" && path === "/health") {
      json(res, 200, { ok: true, service: "galion-research", bind: BIND_HOST });
      return;
    }

    if (method === "GET" && (path === "/" || path === "/research" || path === "/research/")) {
      const nonce = newNonce();
      send(res, 200, "text/html; charset=utf-8", withNonce(PAGE, nonce), nonce);
      return;
    }

    if (method === "GET" && (path === "/one" || path === "/one/")) {
      sendEmpty(res, 302, { Location: one });
      return;
    }

    if (method === "GET" && path === "/research/hermes") {
      const proxied = await fromUpstream("/research/hermes");
      if (proxied) {
        sendProxied(res, proxied);
        return;
      }
      const body = desk.statusBody(sessionId);
      if (upstream) body.upstream = "down";
      json(res, 200, body);
      return;
    }

    if (method === "GET" && path === "/research/history") {
      const proxied = await fromUpstream("/research/history");
      if (proxied) {
        sendProxied(res, proxied);
        return;
      }
      json(res, 200, desk.historyBody(sessionId));
      return;
    }

    if (method === "GET" && path === "/research/sources") {
      json(res, 200, desk.sourcesBody(sessionId));
      return;
    }

    if (method === "POST" && path === "/research/ask") {
      let raw = "";
      try {
        raw = await readBody(req);
      } catch (err) {
        const tooLarge = err && err.code === 413;
        fail(tooLarge ? 413 : 400, tooLarge ? "too-large" : "bad-request", tooLarge ? BODY_TOO_LONG : BAD_JSON);
        return;
      }
      let question = "";
      try {
        const parsed = JSON.parse(raw);
        question = typeof parsed.question === "string" ? parsed.question.trim() : "";
      } catch {
        fail(400, "bad-json", BAD_JSON);
        return;
      }
      if (!question) {
        fail(400, "empty", EMPTY_QUESTION);
        return;
      }
      if (questionLength(question) > QUESTION_LIMIT) {
        fail(413, "too-large", QUESTION_TOO_LONG);
        return;
      }
      const proxied = await fromUpstream("/research/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (proxied) {
        sendProxied(res, proxied);
        return;
      }
      const body = await desk.ask(question, sessionId);
      if (hermes.key && JSON.stringify(body).includes(hermes.key)) {
        const local = localKnowledge("");
        json(res, 200, {
          schema: "galion-research/1",
          app: "hermes",
          model: hermes.model || LLM_NAME,
          status: "Offline",
          question: "",
          reply: local.reply,
          citations: [],
          found: [],
          inferred: [],
          unknown: local.unknown,
          sources: [{ label: "Local", text: "What is already known stays marked local." }],
          helpers: HELPERS_OFFLINE,
          key: keyState(hermes.key),
        });
        return;
      }
      json(res, 200, body);
      return;
    }

    fail(404, "not-found", NOT_FOUND);
  };
}

export function start(options = {}) {
  const env = options.env || process.env;
  const server = http.createServer(createApp(env));
  const { host, port } = listenTarget(options, env);
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  start().then((server) => {
    const address = server.address();
    console.log(`Galion Research http://${address.address}:${address.port}/research`);
  });
}
