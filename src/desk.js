// Galion Research desk. One Hermes turn, then the notebook.
// Helpers are a single quiet line. The desk may split the work on its own.

import { localKnowledge } from "./local.js";
import {
  LLM_NAME,
  REFUSED,
  UNREACHABLE,
  keyState,
  researchTurn,
} from "./hermes.js";

export const HELPER_NAMES = Object.freeze(["reading", "sources", "notebook"]);
export const HELPERS_QUIET = "Helpers are quiet.";
export const HELPERS_LOCAL = "Helpers are quiet. Local knowledge carries the question.";
export const HELPERS_RUNNING = `Helpers: ${HELPER_NAMES.join(", ")}.`;

const HISTORY_CAP = 32;

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

function finish(turn, question, key) {
  const leaked = Boolean(key) && (turn.text.includes(key) || turn.citations.some((cite) => cite.text.includes(key)));
  if (leaked || turn.text === UNREACHABLE) {
    const local = localKnowledge(scrub(question, key));
    return {
      status: "Local",
      reply: local.reply,
      citations: [],
      found: [],
      inferred: [],
      unknown: local.unknown,
      helpers: HELPERS_LOCAL,
    };
  }
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
    helpers: status === "Unreachable" ? HELPERS_LOCAL : HELPERS_QUIET,
  };
}

export function createDesk(hermes) {
  const notes = [];
  let nextId = 0;
  let status = "Idle";
  let chain = Promise.resolve();

  function gatewayStatus() {
    if (status === "Running") return "Running";
    if (!hermes.attached) return notes.length ? status : "Local";
    return status === "Idle" ? "Idle" : status;
  }

  function statusBody() {
    return {
      schema: "galion-research/1",
      app: "hermes",
      voice: "galion-research",
      product: "galion-one",
      model: hermes.model || LLM_NAME,
      key: keyState(hermes.key),
      status: gatewayStatus(),
      history: notes.length,
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

  function historyBody() {
    return {
      schema: "galion-research/1",
      app: "hermes",
      items: notes
        .slice()
        .reverse()
        .map(noteBody),
    };
  }

  function ask(question) {
    const job = chain.then(() => run(question));
    chain = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  async function run(question) {
    status = "Running";
    nextId += 1;
    const id = nextId;
    const clean = scrub(question, hermes.key);
    let done;
    if (!hermes.attached) {
      const local = localKnowledge(clean);
      done = {
        status: "Local",
        reply: local.reply,
        citations: [],
        found: [],
        inferred: [],
        unknown: local.unknown,
        helpers: HELPERS_LOCAL,
      };
    } else {
      const turn = await researchTurn(hermes, clean);
      done = finish(turn, clean, hermes.key);
    }
    const note = { id, at: Date.now(), question: clean, ...done };
    notes.push(note);
    while (notes.length > HISTORY_CAP) notes.shift();
    status = done.status;
    return {
      schema: "galion-research/1",
      app: "hermes",
      model: hermes.model || LLM_NAME,
      ...noteBody(note),
    };
  }

  return { ask, statusBody, historyBody, runningLine: HELPERS_RUNNING };
}
