// Hermes research turn. Loopback OpenAI-compatible chat only.
// GALION_LLM_KEY is read from the environment and sent as Authorization.
// It is never copied into a reply, a status line, or a log.

import http from "node:http";

export const UNREACHABLE = "model can't be reached";
export const REFUSED = "I'll stay on what you said.";
export const LLM_NAME = "hermes-agent";
export const DEFAULT_URL = "http://127.0.0.1:8642/v1/chat/completions";
export const DEFAULT_TIMEOUT_MS = 3_000;

export const RESEARCH_PROMPT =
  'You are Galion Research, the research app on Hermes, a voice of Galion One. Answer the question first, then the limit. Separate found, inferred, and unknown. Cite only a source that was handed to you, one per line, starting with [1]. If you have no source, say "I don\'t have a source for that." Do not invent a paper, a URL, a date, or a measurement. English only.';

export const FORBIDDEN = Object.freeze([
  "i hear you",
  "that sounds so hard",
  "that sounds hard",
  "i'm here for you",
  "i feel that in my soul",
  "i know this is difficult",
  "i'm worried about you",
  "take a deep breath",
  "so what i'm hearing",
  "noted, that is hard",
  "i'm sorry for your loss",
  "let's slow down",
  "i'm sorry",
  "i am sorry",
  "i'm so sorry",
  "i am so sorry",
  "so sorry to hear",
  "sorry to hear",
  "sorry for your loss",
  "my condolences",
  "my deepest condolences",
  "you are not alone",
  "you're not alone",
  "allow yourself to grieve",
  "losing a loved one",
  "i can only imagine",
  "i can't imagine how",
  "that must be so hard",
  "that must be hard",
  "that must be difficult",
]);

export function isLoopback(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) {
    return expandV6(host) === "0000:0000:0000:0000:0000:0000:0000:0001";
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => n > 255)) return false;
  return nums[0] === 127;
}

function expandV6(host) {
  const [head, tail] = host.split("::");
  if (host.split("::").length > 2) return "";
  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail ? tail.split(":").filter(Boolean) : [];
  if (left.length + right.length > 8) return "";
  const mid = Array(8 - left.length - right.length).fill("0");
  return [...left, ...mid, ...right].map((part) => part.padStart(4, "0")).join(":");
}

export function parseLoopbackChatUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!isLoopback(url.hostname)) return null;
  if (url.pathname.includes("\n") || url.pathname.includes("\r")) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const path = url.pathname && url.pathname !== "/" ? url.pathname : "/v1/chat/completions";
  if (!path.startsWith("/")) return null;
  return { hostname: url.hostname, port, path };
}

export function keyOk(key) {
  return typeof key === "string" && key.length > 0 && key.length <= 512 && /^[\x21-\x7E]+$/.test(key);
}

export function keyState(key) {
  return key ? "set" : "none";
}

export function citeLines(raw) {
  const out = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    const end = trimmed.indexOf("]");
    if (end < 2) continue;
    const n = Number(trimmed.slice(1, end).trim());
    if (!Number.isInteger(n)) continue;
    const text = trimmed
      .slice(end + 1)
      .trim()
      .replace(/^[:\- ]+/, "")
      .trim();
    if (!text || out.length >= 12) continue;
    out.push({ n, text: [...text].slice(0, 240).join("") });
  }
  return out;
}

export function containsForbidden(reply) {
  const low = String(reply)
    .replace(/[\u2018\u2019\u02BC`]/g, "'")
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
  return FORBIDDEN.some((phrase) => low.includes(phrase));
}

function stripBrackets(raw) {
  let depth = 0;
  let out = "";
  for (const ch of String(raw)) {
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

export function guardText(raw, cap = 4_000) {
  const text = stripBrackets(raw).trim();
  if (!text) return UNREACHABLE;
  if (containsForbidden(text)) return REFUSED;
  const limit = Math.min(4_000, Math.max(80, cap));
  const chars = [...text];
  if (chars.length <= limit) return text;
  const clipped = chars.slice(0, limit).join("");
  const space = clipped.lastIndexOf(" ");
  return space > 80 ? clipped.slice(0, space) : clipped;
}

export function clipChars(value, max) {
  return [...String(value)].slice(0, max).join("");
}

function readCapped(res, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on("data", (chunk) => {
      size += chunk.length;
      if (size > cap) {
        res.destroy();
        reject(new Error("cap"));
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

export function researchTurn(config, user) {
  const target = parseLoopbackChatUrl(config.url || "");
  const text = clipChars(String(user ?? "").trim(), 2_000);
  if (!target || !text) return Promise.resolve({ text: UNREACHABLE, citations: [], cause: "refused" });
  if (config.key && !keyOk(config.key)) return Promise.resolve({ text: UNREACHABLE, citations: [], cause: "refused" });

  const body = JSON.stringify({
    model: config.model || LLM_NAME,
    messages: [
      { role: "system", content: RESEARCH_PROMPT },
      { role: "user", content: text },
    ],
  });
  const timeout = config.timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    let incoming = null;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const miss = (cause) => finish({ text: UNREACHABLE, citations: [], cause });
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "close",
          ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
        },
      },
      (res) => {
        incoming = res;
        readCapped(res, 64 * 1024)
          .then((payload) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              miss("status");
              return;
            }
            const content = assistantContent(payload);
            if (content == null) {
              miss("response");
              return;
            }
            finish({
              citations: citeLines(content),
              text: guardText(content, 4_000),
              raw: content,
              cause: "returned",
            });
          })
          .catch(() => miss("response"));
      },
    );
    // Wall clock. A socket timeout would reset while bytes trickle in.
    timer = setTimeout(() => {
      incoming?.destroy();
      req.destroy();
      miss("timeout");
    }, timeout);
    req.on("error", () => miss("unreachable"));
    req.end(body);
  });
}

function assistantContent(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const content = parsed?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

export function configFromEnv(env = process.env) {
  const mode = String(env.GALION_LLM || "").trim().toLowerCase();
  const url = String(env.GALION_LLM_URL || "").trim();
  const attach =
    mode === "hermes" || (mode === "" && url !== "")
      ? true
      : mode === "canned" || mode === "echo" || mode === "mock"
        ? false
        : false;
  const timeout = Number(env.GALION_LLM_TIMEOUT_MS);
  return {
    attached: attach,
    url: url || DEFAULT_URL,
    model: String(env.GALION_LLM_MODEL || LLM_NAME).trim().slice(0, 64) || LLM_NAME,
    key: String(env.GALION_LLM_KEY || "").trim(),
    timeoutMs: Number.isFinite(timeout) ? Math.min(30_000, Math.max(50, timeout)) : DEFAULT_TIMEOUT_MS,
  };
}
