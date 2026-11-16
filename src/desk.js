// Galion Research desk. One Hermes turn, then the notebook.
// Helpers are a single quiet line. The desk may split the work on its own.

import { localKnowledge } from "./local.js";
import { idleProgress, progressDocument } from "./progress.js";
import {
  LLM_NAME,
  REFUSED,
  UNREACHABLE,
  keyState,
  researchTurn,
} from "./hermes.js";

export const HELPER_NAMES = Object.freeze(["reading", "sources", "notebook"]);
export const HELPERS_QUIET = "Helpers are quiet.";
export const HELPERS_OFFLINE = "Helpers are quiet. Local knowledge carries the question.";
export const HELPERS_LOCAL = HELPERS_OFFLINE;
export const HELPERS_RUNNING = `Helpers: ${HELPER_NAMES.join(", ")}.`;

const HISTORY_CAP = 32;
const SESSION_CAP = 64;
const SOURCE_CAP = 48;

const LOCAL_SOURCE = "What is already known stays marked local.";

export function notebookPiles(reply) {
  const found = [];
  const inferred = [];
  const unknown = [];
  let which = 0;
  for (const line of String(reply).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\[\d+\]/.test(trimmed)) continue;
    const head = trimmed.replace(/:$/, "").toLowerCase();
    if (head === "found") which = 1;
    else if (head === "inferred") which = 2;
    else if (head === "unknown") which = 3;
    else {
      const item = trimmed.replace(/^[- ]+/, "");
      if (which === 1) found.push(item);
      else if (which === 2) inferred.push(item);
      else if (which === 3) unknown.push(item);
    }
  }
  return { found, inferred, unknown };
}

export function researchState(text) {
  const low = String(text).toLowerCase();
  if (text === UNREACHABLE || low.includes("not reachable")) return "Unreachable";
  if (text === REFUSED || low.includes("not allowed")) return "Denied";
  if (low.includes("don't have a source") || low.includes("do not have a source") || low.includes("not found")) {
    return "NotFound";
  }
  return "Returned";
}

function scrub(value, key) {
  if (!key || !value) return value;
  return String(value).split(key).join("");
}

function offlineResult(question, key) {
  const local = localKnowledge(scrub(question, key));
  return {
    status: "Offline",
    reply: local.reply,
    citations: [],
    found: [],
    inferred: [],
    unknown: local.unknown,
    helpers: HELPERS_OFFLINE,
  };
}

function finish(turn, question, key) {
  const leaked = Boolean(key) && (turn.text.includes(key) || turn.citations.some((cite) => cite.text.includes(key)));
  if (leaked || turn.text === UNREACHABLE) return offlineResult(question, key);
  let status = researchState(turn.text);
  let citations = status === "Returned" ? turn.citations.map((cite) => ({ n: cite.n, text: scrub(cite.text, key) })) : [];
  citations = citations.filter((cite) => cite.text);
  const piles = notebookPiles(scrub(turn.raw || turn.text, key));
  if ((status === "NotFound" || status === "Unreachable" || status === "Denied") && piles.unknown.length === 0) {
    piles.unknown.push(scrub(turn.text, key));
  }
  if (status !== "Returned") piles.found = [];
  return {
    status,
    reply: scrub(turn.text, key),
    citations,
    found: piles.found,
    inferred: piles.inferred,
    unknown: piles.unknown,
    helpers: status === "Unreachable" ? HELPERS_OFFLINE : HELPERS_QUIET,
  };
}

export function createDesk(hermes, deps = {}) {
  const turnFn = deps.researchTurn || researchTurn;
  const sessions = new Map();
  let chain = Promise.resolve();

  function open(sessionId) {
    const id = sessionId || "session";
    let session = sessions.get(id);
    if (!session) {
      session = { notes: [], sources: [], status: "Idle", nextId: 0, at: Date.now(), flight: 0, live: idleProgress() };
      sessions.set(id, session);
      evict(id);
    }
    session.at = Date.now();
    return session;
  }

  function evict(keep) {
    while (sessions.size > SESSION_CAP) {
      let oldest = null;
      let oldestAt = Infinity;
      for (const [id, session] of sessions) {
        if (id === keep) continue;
        if (session.at < oldestAt) {
          oldest = id;
          oldestAt = session.at;
        }
      }
      if (!oldest) break;
      sessions.delete(oldest);
    }
  }

  function gatewayStatus(session) {
    if (session.status === "Running") return "Running";
    if (!hermes.attached) return session.notes.length ? session.status : "Offline";
    return session.status === "Idle" ? "Idle" : session.status;
  }

  function statusBody(sessionId) {
    const session = open(sessionId);
    return {
      schema: "galion-research/1",
      app: "hermes",
      voice: "galion-research",
      product: "galion-one",
      model: hermes.model || LLM_NAME,
      key: keyState(hermes.key),
      status: gatewayStatus(session),
      history: session.notes.length,
      upstream: "none",
    };
  }

  function noteBody(note) {
    return {
      id: note.id,
      status: note.status,
      age_s: Math.max(0, Math.round((Date.now() - note.at) / 1000)),
      question: note.question,
      reply: note.reply,
      citations: note.citations,
      found: note.found,
      inferred: note.inferred,
      unknown: note.unknown,
      helpers: note.helpers,
    };
  }

  function sourcesOf(session) {
    return session.sources.map((source) => ({ ...source }));
  }

  function rememberSources(session, note) {
    if (note.status === "Offline") {
      if (!session.sources.some((source) => source.label === "Local")) {
        session.sources.push({ label: "Local", text: LOCAL_SOURCE, questionId: note.id });
      }
    } else if (note.status === "Returned") {
      for (const cite of note.citations) {
        if (!cite.text || session.sources.length >= SOURCE_CAP) continue;
        session.sources.push({ label: "Citation", n: cite.n, text: cite.text, questionId: note.id });
      }
    }
    for (const source of note.handed || []) {
      if (!source.text || session.sources.length >= SOURCE_CAP) continue;
      session.sources.push({ label: "File", text: source.text, questionId: note.id });
    }
    while (session.sources.length > SOURCE_CAP) session.sources.shift();
  }

  function historyBody(sessionId) {
    const session = open(sessionId);
    return {
      schema: "galion-research/1",
      app: "hermes",
      items: session.notes
        .slice()
        .reverse()
        .map(noteBody),
      sources: sourcesOf(session),
    };
  }

  function sourcesBody(sessionId) {
    const session = open(sessionId);
    return {
      schema: "galion-research/1",
      app: "hermes",
      sources: sourcesOf(session),
    };
  }

  function beginProgress(sessionId) {
    const session = open(sessionId);
    session.flight += 1;
    session.live = { phase: "reading", calls: 0, call_budget: 1, helpers: [] };
    return session.flight;
  }

  function endProgress(sessionId, token, calls = 0) {
    const session = open(sessionId);
    if (token !== session.flight) return;
    const spent = Number.isInteger(calls) && calls > 0 ? calls : 0;
    session.live = { phase: "done", calls: spent, call_budget: 1, helpers: [] };
  }

  function progressBody(sessionId) {
    const session = open(sessionId);
    return progressDocument(session.live || idleProgress());
  }

  function ask(question, sessionId, files) {
    const job = chain.then(() => run(question, sessionId, files));
    chain = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  function handedText(files, key) {
    const sources = [];
    const lines = [];
    for (const file of files || []) {
      const name = scrub(file.name, key);
      sources.push({ label: "File", text: name });
      const excerpt = scrub(file.excerpt || "", key).replace(/\s+/g, " ").trim();
      lines.push(excerpt ? `Handed file ${name}, ${file.bytes} bytes. ${excerpt}` : `Handed file ${name}, ${file.bytes} bytes.`);
    }
    return { line: lines.join(" "), sources };
  }

  async function run(question, sessionId, files) {
    const session = open(sessionId);
    session.status = "Running";
    session.nextId += 1;
    const id = session.nextId;
    const clean = scrub(question, hermes.key);
    const handed = handedText(files, hermes.key);
    const room = 2_000 - [...clean].length - 1;
    const extra = room > 0 ? [...handed.line].slice(0, room).join("") : "";
    const asked = extra ? `${clean}\n${extra}` : clean;
    let done;
    if (!hermes.attached) {
      const local = offlineResult(clean, hermes.key);
      done = handed.line ? { ...local, reply: `${local.reply} ${handed.line}` } : local;
    } else {
      const turn = await turnFn(hermes, asked);
      done = finish(turn, clean, hermes.key);
      if (handed.line && done.status === "Offline") done = { ...done, reply: `${done.reply} ${handed.line}` };
    }
    const note = { id, at: Date.now(), question: clean, ...done, handed: handed.sources };
    session.notes.push(note);
    while (session.notes.length > HISTORY_CAP) session.notes.shift();
    rememberSources(session, note);
    session.status = done.status;
    session.at = Date.now();
    return {
      schema: "galion-research/1",
      app: "hermes",
      model: hermes.model || LLM_NAME,
      ...noteBody(note),
      sources: sourcesOf(session),
    };
  }

  return { ask, statusBody, historyBody, sourcesBody, beginProgress, endProgress, progressBody, runningLine: HELPERS_RUNNING };
}
