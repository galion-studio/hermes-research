// Request limits for the research desk. A question past the limit is refused.
// It is not clipped and then answered.

export const BODY_LIMIT = 32_768;
export const QUESTION_LIMIT = 2_000;
export const REQUEST_LIMIT = 240;
export const ASK_LIMIT = 30;
export const RATE_WINDOW_MS = 60_000;
export const GLOBAL_REQUEST_LIMIT = 10_000;
export const GLOBAL_ASK_LIMIT = 1_000;

export const EMPTY_QUESTION = "The question is empty.";
export const BAD_JSON = "The question was not sent as JSON.";
export const QUESTION_TOO_LONG = `The question is longer than ${QUESTION_LIMIT} characters.`;
export const BODY_TOO_LONG = `The request is longer than ${BODY_LIMIT} bytes.`;
export const NOT_FOUND = "That path is not on this desk.";
export const METHOD_NOT_ALLOWED = "That method is not allowed.";
export const RATE_LIMITED = "Too many requests. Wait a moment and try again.";
export const UPSTREAM_REFUSED = "The research origin refused the question.";

export const ERROR_KEYS = Object.freeze([
  "schema",
  "app",
  "status",
  "error",
  "reply",
  "citations",
  "found",
  "inferred",
  "unknown",
  "sources",
  "helpers",
]);

export function questionLength(value) {
  return [...String(value ?? "")].length;
}

export function errorBody(error, reply) {
  return {
    schema: "galion-research/1",
    app: "hermes",
    status: "Error",
    error,
    reply,
    citations: [],
    found: [],
    inferred: [],
    unknown: [],
    sources: [],
    helpers: "Helpers are quiet.",
  };
}

function clamp(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function rateLimitsFromEnv(env = process.env) {
  return {
    requestLimit: clamp(env.GALION_RATE_LIMIT, REQUEST_LIMIT, 1, 100_000),
    askLimit: clamp(env.GALION_ASK_RATE, ASK_LIMIT, 1, 100_000),
    windowMs: clamp(env.GALION_RATE_WINDOW_MS, RATE_WINDOW_MS, 10, 3_600_000),
    globalRequestLimit: clamp(env.GALION_GLOBAL_RATE_LIMIT, GLOBAL_REQUEST_LIMIT, 1, 1_000_000),
    globalAskLimit: clamp(env.GALION_GLOBAL_ASK_RATE, GLOBAL_ASK_LIMIT, 1, 1_000_000),
  };
}

function retryAfter(list, now, windowMs) {
  const oldest = list[0];
  if (oldest == null) return 1;
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

function prune(list, now, windowMs) {
  return list.filter((at) => now - at < windowMs);
}

export function createRateLimiter(options = {}) {
  const requestLimit = options.requestLimit ?? REQUEST_LIMIT;
  const askLimit = options.askLimit ?? ASK_LIMIT;
  const windowMs = options.windowMs ?? RATE_WINDOW_MS;
  const globalRequestLimit = options.globalRequestLimit ?? GLOBAL_REQUEST_LIMIT;
  const globalAskLimit = options.globalAskLimit ?? GLOBAL_ASK_LIMIT;
  const sessions = new Map();
  const global = { requests: [], asks: [] };

  return {
    hit(id, kind, now = Date.now()) {
      const key = String(id || "anon");
      global.requests = prune(global.requests, now, windowMs);
      global.asks = prune(global.asks, now, windowMs);
      let row = sessions.get(key);
      if (!row) {
        row = { requests: [], asks: [] };
        sessions.set(key, row);
        while (sessions.size > 512) {
          let drop = null;
          for (const candidate of sessions.keys()) {
            if (candidate === key || candidate === "anon") continue;
            drop = candidate;
            break;
          }
          if (!drop) break;
          sessions.delete(drop);
        }
      }
      row.requests = prune(row.requests, now, windowMs);
      row.asks = prune(row.asks, now, windowMs);
      const ask = kind === "ask";
      if (row.requests.length >= requestLimit || global.requests.length >= globalRequestLimit) {
        const list = row.requests.length >= requestLimit ? row.requests : global.requests;
        return { ok: false, retryAfter: retryAfter(list, now, windowMs) };
      }
      if (ask && (row.asks.length >= askLimit || global.asks.length >= globalAskLimit)) {
        const list = row.asks.length >= askLimit ? row.asks : global.asks;
        return { ok: false, retryAfter: retryAfter(list, now, windowMs) };
      }
      const at = now;
      row.requests.push(at);
      global.requests.push(at);
      if (ask) {
        row.asks.push(at);
        global.asks.push(at);
      }
      return { ok: true };
    },
  };
}
