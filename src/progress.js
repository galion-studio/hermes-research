// In-flight progress for one research session. The shape matches the voice desk's
// GET /research/progress. This desk spends one completion, so the calm line
// stays short: a phase, not a call count.

export const PROGRESS_POLL_MS = 1000;

export const PROGRESS_LINES = Object.freeze({
  planning: "Planning.",
  reading: "Reading.",
  direct: "One lookup.",
  synthesis: "Synthesis.",
  helperOne: "1 helper.",
  helpers: "Helpers.",
});

const PHASES = new Set(["idle", "planning", "reading", "direct", "helpers", "synthesis", "done"]);
const HELPER_STATUS = new Set([
  "queued",
  "running",
  "skipped",
  "Found",
  "Inferred",
  "Unknown",
  "Unreachable",
  "Denied",
  "Offline",
  "Returned",
]);

export function idleProgress() {
  return { phase: "idle", calls: 0, call_budget: 1, helpers: [] };
}

function clampCount(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, 7);
}

function normalizeHelper(helper) {
  const question = [...String(helper && helper.question != null ? helper.question : "")].slice(0, 240).join("");
  const status = HELPER_STATUS.has(helper && helper.status) ? helper.status : "queued";
  return { question, status };
}

export function progressDocument(live) {
  const phase = PHASES.has(live && live.phase) ? live.phase : "idle";
  const helpers = Array.isArray(live && live.helpers) ? live.helpers.slice(0, 8).map(normalizeHelper) : [];
  return {
    schema: "galion-research/1",
    app: "hermes",
    phase,
    calls: clampCount(live && live.calls),
    call_budget: clampCount(live && live.call_budget) || 1,
    helpers,
  };
}

export function progressLine(progress) {
  const phase = progress && progress.phase;
  if (phase === "planning") return PROGRESS_LINES.planning;
  if (phase === "reading") return PROGRESS_LINES.reading;
  if (phase === "direct") return PROGRESS_LINES.direct;
  if (phase === "synthesis") return PROGRESS_LINES.synthesis;
  if (phase === "helpers") {
    const count = Array.isArray(progress.helpers) ? progress.helpers.length : 0;
    if (count === 1) return PROGRESS_LINES.helperOne;
    if (count > 1) return `${count} helpers.`;
    return PROGRESS_LINES.helpers;
  }
  return "";
}
