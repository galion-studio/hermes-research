// Galion Research. The page, the galion-one-voice /research backend, and Hermes.
// The gateway key is read from the environment inside the Hermes client. It is not logged.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { HELPERS_OFFLINE, createDesk } from "./desk.js";
import {
  acceptAnswer,
  acceptHistory,
  acceptStatus,
  exchange,
  failureState,
  forwardConfig,
  leaksKey,
  wireReport,
  withWireIndicator,
} from "./forward.js";
import { UPLOAD_FORM, UPLOAD_NAME, parseMultipart, removeUploads, uploadDir } from "./uploads.js";
import { localKnowledge } from "./local.js";
import { LLM_NAME, configFromEnv, isLoopback, keyState } from "./hermes.js";
import {
  BAD_JSON,
  BODY_LIMIT,
  BODY_TOO_LONG,
  EMPTY_QUESTION,
  QUESTION_LIMIT,
  QUESTION_TOO_LONG,
  errorBody,
  questionLength,
} from "./limits.js";

export { BODY_LIMIT, QUESTION_LIMIT };

const PAGE = withWireIndicator(readFileSync(fileURLToPath(new URL("../public/research.html", import.meta.url))));

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
  const wire = forwardConfig(env);
  const one = wire.openmind.origin
    ? `${wire.openmind.origin}/one`
    : oneTarget(env.GALION_ONE_URL || "https://galion.app/one");

  async function fromUpstream(path, init) {
    if (!wire.voice.forward) return null;
    try {
      const result = await exchange(wire.voice.forward, path, init, wire.timeoutMs);
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

  function sessionIdFor(req, res) {
    const fromCookie = sessionToken(req.headers.cookie);
    const fromHeader = sessionToken(req.headers["x-research-session"]);
    const id = fromCookie || fromHeader || newSessionId();
    if (!fromCookie) {
      res.setHeader("Set-Cookie", `research_session=${id}; HttpOnly; SameSite=Strict; Path=/`);
    }
    return id;
  }

  return async function handle(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method || "GET";
    const sessionId = sessionIdFor(req, res);

    if (method === "GET" && path === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (method === "GET" && path === "/health") {
      json(res, 200, { ok: true, service: "galion-research", bind: "127.0.0.1" });
      return;
    }

    if (method === "GET" && path === "/research/wire") {
      json(res, 200, await wireReport(env, hermes));
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

    if (method === "POST" && path === "/research/ask" && /^multipart\/form-data\b/i.test(String(req.headers["content-type"] || ""))) {
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
      const body = await desk.ask(question, sessionId, parsed.files);
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
        });
        return;
      }
      json(res, 200, body);
      return;
    }

    if (method === "POST" && path === "/research/ask") {
      const declared = Number(req.headers["content-length"] || "");
      if (Number.isFinite(declared) && declared > BODY_LIMIT) {
        json(res, 413, errorBody("too-large", BODY_TOO_LONG));
        req.resume();
        return;
      }
      let raw = "";
      try {
        raw = await readBody(req);
      } catch (err) {
        const tooLarge = err && err.code === 413;
        json(res, tooLarge ? 413 : 400, errorBody(tooLarge ? "too-large" : "bad-request", tooLarge ? BODY_TOO_LONG : BAD_JSON));
        req.resume();
        return;
      }
      let question = "";
      try {
        const parsed = JSON.parse(raw);
        question = typeof parsed.question === "string" ? parsed.question.trim() : "";
      } catch {
        json(res, 400, errorBody("bad-json", BAD_JSON));
        return;
      }
      if (!question) {
        json(res, 400, errorBody("empty", EMPTY_QUESTION));
        return;
      }
      if (questionLength(question) > QUESTION_LIMIT) {
        json(res, 413, errorBody("too-large", QUESTION_TOO_LONG));
        return;
      }
      const proxied = await fromUpstream("/research/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (proxied && proxied.state === "http" && proxied.status === 400) {
        send(res, 400, "text/plain; charset=utf-8", proxied.text);
        return;
      }
      if (proxied && proxied.state === "http" && proxied.status >= 200 && proxied.status < 300) {
        const accepted = acceptedJson("answer", proxied.text);
        if (accepted) {
          json(res, 200, accepted);
          return;
        }
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
