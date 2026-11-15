// Forward contract for the two loopback upstreams.
// openmind-desktop serves GET /one and GET /research on its loopback listener.
// galion-one-voice serves GET /health as the text "ok", and the /research JSON routes.
// A citation is kept only when the upstream JSON already carried it as { n, text }.
// This module does not add one from reply prose, and it does not dial a non-loopback host.

import { isLoopback, parseLoopbackChatUrl } from "./hermes.js";

export const OPENMIND_PORT = 18181;
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 4_000;
// A research ask waits on Hermes through the voice desk, which allows 85 s.
// Cloudflare drops an origin reply after 100 s, so the ask stays under that.
export const DEFAULT_ASK_TIMEOUT_MS = 90_000;
export const MAX_ASK_TIMEOUT_MS = 95_000;
const BODY_CAP = 64 * 1024;

export function timeoutFromEnv(env = process.env) {
  const timeout = Number(env.GALION_UPSTREAM_TIMEOUT_MS);
  if (!Number.isFinite(timeout)) return DEFAULT_UPSTREAM_TIMEOUT_MS;
  return Math.min(DEFAULT_UPSTREAM_TIMEOUT_MS, Math.max(50, timeout));
}

export function askTimeoutFromEnv(env = process.env) {
  const raw = env.GALION_ASK_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_ASK_TIMEOUT_MS;
  const timeout = Number(raw);
  if (!Number.isFinite(timeout)) return DEFAULT_ASK_TIMEOUT_MS;
  return Math.min(MAX_ASK_TIMEOUT_MS, Math.max(50, timeout));
}

export function loopbackOrigin(raw) {
  if (raw == null || !String(raw).trim()) return { origin: null, state: "unset" };
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { origin: null, state: "refused" };
  }
  if (url.username || url.password) return { origin: null, state: "refused" };
  if (url.protocol !== "http:") return { origin: null, state: "refused" };
  if (!isLoopback(url.hostname)) return { origin: null, state: "refused" };
  const port = url.port ? Number(url.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { origin: null, state: "refused" };
  return { origin: url.origin, state: "ok" };
}

export function voiceTarget(env = process.env) {
  const explicit = env.GALION_VOICE_URL;
  if (explicit != null && String(explicit).trim() !== "") {
    const parsed = loopbackOrigin(explicit);
    return { origin: parsed.origin, state: parsed.state, forward: parsed.origin };
  }
  const legacy = env.GALION_RESEARCH_URL;
  if (legacy == null || String(legacy).trim() === "") {
    return { origin: null, state: "unset", forward: null };
  }
  const parsed = loopbackOrigin(legacy);
  if (parsed.state === "ok") return { origin: parsed.origin, state: "ok", forward: parsed.origin };
  return { origin: null, state: parsed.state, forward: null };
}

export function forwardConfig(env = process.env) {
  return {
    openmind: loopbackOrigin(env.GALION_OPENMIND_URL),
    voice: voiceTarget(env),
    timeoutMs: timeoutFromEnv(env),
    askTimeoutMs: askTimeoutFromEnv(env),
  };
}

export function failureState(err) {
  const name = err && err.name;
  const code = err && err.cause && err.cause.code;
  if (name === "TimeoutError" || name === "AbortError" || code === "ABORT_ERR") return "timeout";
  return "down";
}

function portOf(origin) {
  const url = new URL(origin);
  return url.port ? Number(url.port) : 80;
}

async function readLimited(response, cap) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function exchange(origin, path, init, timeoutMs) {
  const response = await fetch(new URL(path, origin), {
    method: init && init.method ? init.method : "GET",
    headers: init && init.headers ? init.headers : undefined,
    body: init && init.body ? init.body : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await readLimited(response, BODY_CAP);
  if (text == null) return { status: response.status, text: "", overflow: true };
  return { status: response.status, text, overflow: false };
}

function entryState(result, id) {
  if (!result || result.overflow) return "malformed";
  if (result.status < 200 || result.status >= 300) return "down";
  if (!String(result.text).includes(`data-entry="${id}"`)) return "malformed";
  return "up";
}

function combineEntry(one, research) {
  if (one === "up" && research === "up") return "up";
  if (one === "timeout" || research === "timeout") return "timeout";
  if (one === "malformed" || research === "malformed") return "malformed";
  return "down";
}

export async function probeOpenmind(openmind, timeoutMs) {
  if (!openmind || openmind.state !== "ok" || !openmind.origin) {
    return { state: openmind && openmind.state ? openmind.state : "unset" };
  }
  const port = portOf(openmind.origin);
  try {
    const [one, research] = await Promise.all([
      exchange(openmind.origin, "/one", { method: "GET" }, timeoutMs),
      exchange(openmind.origin, "/research", { method: "GET" }, timeoutMs),
    ]);
    return { state: combineEntry(entryState(one, "one"), entryState(research, "research")), port };
  } catch (err) {
    return { state: failureState(err), port };
  }
}

export async function probeVoice(voice, timeoutMs) {
  if (!voice || voice.state !== "ok" || !voice.origin) {
    return { state: voice && voice.state ? voice.state : "unset" };
  }
  const port = portOf(voice.origin);
  try {
    const result = await exchange(voice.origin, "/health", { method: "GET" }, timeoutMs);
    if (result.overflow) return { state: "malformed", port };
    if (result.status < 200 || result.status >= 300) return { state: "down", port };
    if (result.text.trim() !== "ok") return { state: "malformed", port };
    return { state: "up", port };
  } catch (err) {
    return { state: failureState(err), port };
  }
}

export async function probeHermes(hermes, timeoutMs) {
  if (!hermes || !hermes.attached) return { state: "offline" };
  const target = parseLoopbackChatUrl(hermes.url || "");
  if (!target) return { state: "refused" };
  const host = target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
  const origin = `http://${host}:${target.port}`;
  try {
    const result = await exchange(origin, "/health", { method: "GET" }, timeoutMs);
    if (result.overflow) return { state: "malformed", port: target.port };
    if (result.status >= 200 && result.status < 300) return { state: "up", port: target.port };
    return { state: "down", port: target.port };
  } catch (err) {
    return { state: failureState(err), port: target.port };
  }
}

export async function wireReport(env, hermes) {
  const cfg = forwardConfig(env);
  const [openmind, voice, hermesRow] = await Promise.all([
    probeOpenmind(cfg.openmind, cfg.timeoutMs),
    probeVoice(cfg.voice, cfg.timeoutMs),
    probeHermes(hermes, cfg.timeoutMs),
  ]);
  return {
    schema: "galion-research/1",
    app: "hermes",
    upstreams: { openmind, voice },
    hermes: { attached: Boolean(hermes && hermes.attached), state: hermesRow.state },
  };
}

export function acceptCitations(value) {
  if (!Array.isArray(value) || value.length > 12) return null;
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (!Number.isInteger(item.n) || item.n < 1 || item.n > 999) return null;
    if (typeof item.text !== "string") return null;
    const text = item.text.trim();
    if (!text || [...text].length > 240) return null;
    out.push({ n: item.n, text });
  }
  return out;
}

function parsedObject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.schema !== "galion-research/1") return null;
  return parsed;
}

function keyAllowed(parsed) {
  if (parsed.key == null) return true;
  return parsed.key === "set" || parsed.key === "none";
}

export function acceptAnswer(text) {
  const parsed = parsedObject(text);
  if (!parsed) return null;
  if (typeof parsed.status !== "string" || !parsed.status.trim() || parsed.status.length > 32) return null;
  if (typeof parsed.reply !== "string") return null;
  if (!keyAllowed(parsed)) return null;
  const citations = acceptCitations(parsed.citations);
  if (!citations) return null;
  return { ...parsed, citations };
}

export function acceptStatus(text) {
  const parsed = parsedObject(text);
  if (!parsed) return null;
  if (typeof parsed.status !== "string" || !parsed.status.trim() || parsed.status.length > 32) return null;
  if (!keyAllowed(parsed)) return null;
  if (parsed.citations != null && acceptCitations(parsed.citations) == null) return null;
  if (Array.isArray(parsed.citations)) parsed.citations = acceptCitations(parsed.citations);
  return parsed;
}

export function acceptHistory(text) {
  const parsed = parsedObject(text);
  if (!parsed || !Array.isArray(parsed.items)) return null;
  const items = [];
  for (const item of parsed.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (item.citations == null) {
      items.push(item);
      continue;
    }
    const citations = acceptCitations(item.citations);
    if (!citations) return null;
    items.push({ ...item, citations });
  }
  return { ...parsed, items };
}

export function leaksKey(text, key) {
  return Boolean(key) && String(text).includes(key);
}

const WIRE_STYLE =
  "#wire-status{margin:0 0 18px;font:13px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb, var(--amber) 75%, var(--ink))}";

const WIRE_NODE =
  '<p id="wire-status" data-wire="openmind voice" aria-live="polite">One · unset · Voice · unset · Hermes · offline</p>';

const WIRE_SCRIPT =
  'fetch("/research/wire",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){var el=document.getElementById("wire-status");if(!el)return;var u=j&&j.upstreams||{};var o=u.openmind&&u.openmind.state||"unset";var v=u.voice&&u.voice.state||"unset";var h=j&&j.hermes&&j.hermes.state||"offline";el.textContent="One · "+o+" · Voice · "+v+" · Hermes · "+h;}).catch(function(){var el=document.getElementById("wire-status");if(el)el.textContent="One · down · Voice · down · Hermes · offline";});';

export function withWireIndicator(html) {
  let text = Buffer.isBuffer(html) ? html.toString("utf8") : String(html);
  if (text.includes('id="wire-status"')) return Buffer.from(text);
  if (text.includes("</style>")) {
    text = text.replace("</style>", `${WIRE_STYLE}</style>`);
  }
  const marker = 'id="hermes-status"';
  const at = text.indexOf(marker);
  const end = at >= 0 ? text.indexOf("</p>", at) : -1;
  if (end >= 0) text = `${text.slice(0, end + 4)}\n  ${WIRE_NODE}${text.slice(end + 4)}`;
  const fetchAt = text.indexOf('fetch("/research/hermes"');
  if (fetchAt >= 0) text = `${text.slice(0, fetchAt)}${WIRE_SCRIPT}\n  ${text.slice(fetchAt)}`;
  return Buffer.from(text);
}
