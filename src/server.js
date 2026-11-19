// Galion Research. The page, the galion-one-voice /research backend, and Hermes.
// The gateway key is read from the environment inside the Hermes client. It is not logged.

import { randomBytes } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { newNonce, postOriginAllowed, securityHeaders, uploadContentDisposition, withNonce } from "./headers.js";
import { isLoopback } from "./loopback.js";
import {
  BAD_JSON,
  BODY_LIMIT,
  BODY_TOO_LONG,
  EMPTY_QUESTION,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  QUESTION_LIMIT,
  QUESTION_TOO_LONG,
  ORIGIN_REFUSED,
  RATE_LIMITED,
  UPSTREAM_REFUSED,
  createRateLimiter,
  errorBody,
  questionLength,
  rateLimitsFromEnv,
} from "./limits.js";
export { BODY_LIMIT, QUESTION_LIMIT };

let deskModules = null;
function loadDesk() {
  if (!deskModules) {
    deskModules = Promise.all([
      import("./answer.js"),
      import("./desk.js"),
      import("./forward.js"),
      import("./hermes.js"),
      import("./local.js"),
      import("./uploads.js"),
    ]).then(([answer, desk, forward, hermes, local, uploads]) => ({ answer, desk, forward, hermes, local, uploads }));
  }
  return deskModules;
}

export const BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;

const ALLOW = Object.freeze({
  "/favicon.ico": "GET",
  "/health": "GET",
  "/": "GET",
  "/research": "GET",
  "/research/": "GET",
  "/one": "GET",
  "/one/": "GET",
  "/research/wire": "GET",
  "/research/hermes": "GET",
  "/research/history": "GET",
  "/research/sources": "GET",
  "/research/progress": "GET",
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

function isMultipart(req) {
  return /^multipart\/form-data\b/i.test(String(req.headers["content-type"] || ""));
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

// A browser status page on loopback http may read GET /health. The origin is
// echoed only in that case. Any other Origin is dropped, so a public host is
// not copied into the response.
export function healthReadHeaders(origin) {
  if (!origin || typeof origin !== "string") return {};
  let url;
  try {
    url = new URL(origin);
  } catch {
    return {};
  }
  if (url.username || url.password) return {};
  if (url.protocol !== "http:") return {};
  const host = url.hostname;
  if (host !== "localhost" && !isLoopback(host)) return {};
  return {
    "Access-Control-Allow-Origin": url.origin,
    Vary: "Origin",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
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

export async function createApp(env = process.env, life = {}) {
  const loaded = await loadDesk();
  const { withAnswerSurface } = loaded.answer;
  const { HELPERS_OFFLINE, createDesk } = loaded.desk;
  const {
    acceptAnswer,
    acceptHistory,
    acceptStatus,
    exchange,
    failureState,
    forwardConfig,
    leaksKey,
    wireReport,
    withWireIndicator,
  } = loaded.forward;
  const { localKnowledge } = loaded.local;
  const { LLM_NAME, configFromEnv, keyState } = loaded.hermes;
  const { UPLOAD_FORM, UPLOAD_NAME, parseMultipart, readHanded, removeUploads, uploadDir } = loaded.uploads;
  let page = null;
  async function pageText() {
    if (page == null) {
      const { readFileSync } = await import("node:fs");
      page = withAnswerSurface(
        withWireIndicator(readFileSync(fileURLToPath(new URL("../public/research.html", import.meta.url)))).toString("utf8"),
      );
    }
    return page;
  }
  const hermes = configFromEnv(env);
  if (life.signal) hermes.signal = life.signal;
  const desk = createDesk(hermes);
  const wire = forwardConfig(env);
  const one = wire.openmind.origin
    ? `${wire.openmind.origin}/one`
    : oneTarget(env.GALION_ONE_URL || "https://galion.app/one");
  const limiter = createRateLimiter(rateLimitsFromEnv(env));

  async function fromUpstream(path, init, timeoutMs = wire.timeoutMs) {
    if (!wire.voice.forward) return null;
    try {
      const result = await exchange(wire.voice.forward, path, init, timeoutMs, life.signal);
      if (result.overflow) return { state: "malformed" };
      if (leaksKey(result.text, hermes.key)) return { state: "malformed" };
      return { state: "http", status: result.status, text: result.text };
    } catch (err) {
      return { state: failureState(err) };
    }
  }

  function acceptedJson(kind, text) {
    if (kind === "answer") return acceptAnswer(text);
    if (kind === "history") return acceptHistory(text);
    return acceptStatus(text);
  }

  return async function handle(req, res) {
    if (life.signal?.aborted) {
      json(res, 503, errorBody("closed", "Galion Research is stopping."));
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method || "GET";
    const fromCookie = sessionToken(req.headers.cookie);
    const fromHeader = sessionToken(req.headers["x-research-session"]);
    const presented = fromCookie || fromHeader;
    const multipart = method === "POST" && path === "/research/ask" && isMultipart(req);

    function fail(status, code, reply, extra) {
      json(res, status, errorBody(code, reply), extra);
      req.resume();
    }

    const declared = declaredLength(req);
    if (!multipart && (Number.isNaN(declared) || (declared != null && declared > BODY_LIMIT))) {
      fail(413, "too-large", BODY_TOO_LONG);
      return;
    }

    if (path === "/health" && method === "GET") {
      json(res, 200, { ok: true, service: "galion-research", bind: BIND_HOST }, {
        Allow: "GET",
        ...healthReadHeaders(req.headers.origin),
      });
      req.resume();
      return;
    }

    if ((method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") && !postOriginAllowed(req.headers)) {
      fail(403, "origin", ORIGIN_REFUSED);
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

    if (method === "GET" && path === "/research/wire") {
      json(res, 200, await wireReport(env, hermes));
      return;
    }

    if (method === "GET" && (path === "/" || path === "/research" || path === "/research/")) {
      const nonce = newNonce();
      send(res, 200, "text/html; charset=utf-8", withNonce(await pageText(), nonce), nonce);
      return;
    }

    if (method === "GET" && (path === "/one" || path === "/one/")) {
      sendEmpty(res, 302, { Location: one });
      return;
    }

    if (method === "GET" && path === "/research/hermes") {
      const proxied = await fromUpstream("/research/hermes");
      const accepted = proxied && proxied.state === "http" && proxied.status >= 200 && proxied.status < 300
        ? acceptedJson("status", proxied.text)
        : null;
      if (accepted) {
        json(res, 200, accepted);
        return;
      }
      const body = desk.statusBody(sessionId);
      if (wire.voice.forward) body.upstream = proxied && proxied.state === "timeout" ? "timeout" : "down";
      json(res, 200, body);
      return;
    }

    if (method === "GET" && path === "/research/history") {
      const proxied = await fromUpstream("/research/history");
      const accepted = proxied && proxied.state === "http" && proxied.status >= 200 && proxied.status < 300
        ? acceptedJson("history", proxied.text)
        : null;
      if (accepted) {
        json(res, 200, accepted);
        return;
      }
      json(res, 200, desk.historyBody(sessionId));
      return;
    }

    if (method === "GET" && path === "/research/sources") {
      json(res, 200, desk.sourcesBody(sessionId));
      return;
    }

    if (method === "GET" && path === "/research/progress") {
      json(res, 200, desk.progressBody(sessionId));
      return;
    }

    async function whileAsking(work) {
      const token = desk.beginProgress(sessionId);
      const mark = { calls: 0 };
      try {
        return await work(mark);
      } finally {
        desk.endProgress(sessionId, token, mark.calls);
      }
    }

    if (multipart) {
      const dir = uploadDir(env);
      let parsed;
      try {
        parsed = await parseMultipart(req, req.headers["content-type"], dir);
      } catch (err) {
        const tooLarge = err && err.code === 413;
        const reply = err && err.reason === "name" ? UPLOAD_NAME : tooLarge ? QUESTION_TOO_LONG : UPLOAD_FORM;
        json(res, tooLarge ? 413 : 400, errorBody(tooLarge ? "too-large" : err && err.reason === "name" ? "name" : "bad-request", reply));
        return;
      }
      const question = String(parsed.question || "").trim();
      if (!question || questionLength(question) > QUESTION_LIMIT) {
        await removeUploads(parsed.files, dir);
        const tooLarge = questionLength(question) > QUESTION_LIMIT;
        json(res, tooLarge ? 413 : 400, errorBody(tooLarge ? "too-large" : "empty", tooLarge ? QUESTION_TOO_LONG : EMPTY_QUESTION));
        return;
      }
      const disposition = uploadContentDisposition(parsed.files);
      const uploadHeaders = disposition ? { "Content-Disposition": disposition } : undefined;
      const body = await whileAsking(async (mark) => {
        // The desk reads its own private upload back by random id. Hermes gets text, never a path.
        const handed = hermes.attached ? await readHanded(parsed.files, dir) : parsed.files;
        const asked = await desk.ask(question, sessionId, handed);
        if (asked && asked.status === "Returned") mark.calls = 1;
        return asked;
      });
      if (hermes.key && JSON.stringify(body).includes(hermes.key)) {
        await removeUploads(parsed.files, dir);
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
        }, uploadHeaders);
        return;
      }
      json(res, 200, body, uploadHeaders);
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
      const body = await whileAsking(async (mark) => {
        const proxied = hermes.attached
          ? null
          : await fromUpstream(
              "/research/ask",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question }),
              },
              wire.askTimeoutMs,
            );
        if (proxied && proxied.state === "http" && proxied.status === 400) {
          sendProxied(res, proxied);
          return null;
        }
        if (proxied && proxied.state === "http" && proxied.status >= 200 && proxied.status < 300) {
          const accepted = acceptedJson("answer", proxied.text);
          if (accepted) {
            json(res, 200, accepted);
            return null;
          }
        }
        const asked = await desk.ask(question, sessionId);
        if (asked && asked.status === "Returned") mark.calls = 1;
        return asked;
      });
      if (!body) return;
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
  const stop = new AbortController();
  const pending = new Set();
  let handlePromise = null;
  const server = http.createServer((req, res) => {
    const task = (async () => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if ((req.method || "GET") === "GET" && url.pathname === "/health") {
        const declared = declaredLength(req);
        if (Number.isNaN(declared) || (declared != null && declared > BODY_LIMIT)) {
          json(res, 413, errorBody("too-large", BODY_TOO_LONG));
          req.resume();
          return;
        }
        json(res, 200, { ok: true, service: "galion-research", bind: BIND_HOST }, {
          Allow: "GET",
          ...healthReadHeaders(req.headers.origin),
        });
        req.resume();
        return;
      }
      if (!handlePromise) handlePromise = createApp(env, { signal: stop.signal });
      const handle = await handlePromise;
      return handle(req, res);
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  let shutting = null;
  server.shutdown = () => {
    if (shutting) return shutting;
    stop.abort();
    shutting = (async () => {
      await Promise.allSettled([...pending]);
      await new Promise((resolve) => setImmediate(resolve));
      if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    })();
    return shutting;
  };
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

// Same wait as scripts/check-health.js. Not a product limit.
const NOTIFY_MS = 2_000;

async function signalSystemd(arg, env) {
  if (!env || !env.NOTIFY_SOCKET) return true;
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const child = spawn("systemd-notify", [arg], {
      env,
      stdio: "ignore",
      signal: AbortSignal.timeout(NOTIFY_MS),
    });
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

export async function run(options = {}) {
  const env = options.env || process.env;
  let server;
  try {
    server = await start(options);
  } catch {
    console.error("Galion Research could not listen.");
    process.exit(1);
  }
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log("Galion Research is stopping.");
    Promise.resolve()
      .then(() => server.shutdown())
      .then(() => signalSystemd("STOPPING=1", env))
      .then(
        () => process.exit(0),
        () => process.exit(0),
      );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log("Galion Research is ready.");
  if (env.NOTIFY_SOCKET && !stopping) {
    const ok = await signalSystemd("--ready", env);
    if (!ok && !stopping) {
      console.error("Galion Research could not signal readiness.");
      process.exit(1);
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  run();
}
