import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDesk } from "../../src/desk.js";
import { withAnswerSurface } from "../../src/answer.js";
import { PROGRESS_LINES, progressDocument, progressLine } from "../../src/progress.js";

const SESSION_A = "a".repeat(32);
const SESSION_B = "b".repeat(32);

function hermes() {
  return { attached: false, model: "hermes-agent", key: "", timeoutMs: 50 };
}

describe("progress document", () => {
  it("keeps the voice progress shape and a short line", () => {
    const reading = progressDocument({ phase: "reading", calls: 0, call_budget: 1, helpers: [] });
    assert.equal(reading.schema, "galion-research/1");
    assert.equal(reading.app, "hermes");
    assert.equal(reading.phase, "reading");
    assert.equal(progressLine(reading), PROGRESS_LINES.reading);
    assert.equal(progressLine({ phase: "planning", helpers: [] }), "Planning.");
    assert.equal(progressLine({ phase: "direct", helpers: [] }), "One lookup.");
    assert.equal(progressLine({ phase: "synthesis", helpers: [] }), "Synthesis.");
    assert.equal(progressLine({ phase: "helpers", helpers: [{}] }), "1 helper.");
    assert.equal(progressLine({ phase: "helpers", helpers: [{}, {}] }), "2 helpers.");
    assert.equal(progressLine({ phase: "helpers", helpers: [] }), "Helpers.");
    assert.equal(progressLine({ phase: "idle" }), "");
    assert.equal(progressLine({ phase: "done" }), "");
  });

  it("drops an unknown phase and clips helper text", () => {
    const doc = progressDocument({
      phase: "spinning",
      calls: 99,
      call_budget: -3,
      helpers: [{ question: "x".repeat(400), status: "nope" }, { question: "kept", status: "running" }],
    });
    assert.equal(doc.phase, "idle");
    assert.equal(doc.calls, 7);
    assert.equal(doc.call_budget, 1);
    assert.equal(doc.helpers.length, 2);
    assert.equal([...doc.helpers[0].question].length, 240);
    assert.equal(doc.helpers[0].status, "queued");
    assert.equal(doc.helpers[1].status, "running");
  });
});

describe("desk progress", () => {
  it("stays on the session that is asking, and an older finish does not clear a newer one", () => {
    const desk = createDesk(hermes());
    assert.equal(desk.progressBody(SESSION_A).phase, "idle");
    const first = desk.beginProgress(SESSION_A);
    assert.equal(desk.progressBody(SESSION_A).phase, "reading");
    assert.equal(desk.progressBody(SESSION_B).phase, "idle");
    const second = desk.beginProgress(SESSION_A);
    desk.endProgress(SESSION_A, first, 1);
    assert.equal(desk.progressBody(SESSION_A).phase, "reading");
    assert.equal(desk.progressBody(SESSION_A).calls, 0);
    desk.endProgress(SESSION_A, second, 1);
    assert.equal(desk.progressBody(SESSION_A).phase, "done");
    assert.equal(desk.progressBody(SESSION_A).calls, 1);
    assert.equal(desk.progressBody(SESSION_B).phase, "idle");
  });
});

describe("answer surface", () => {
  it("adds the progress line without a second copy", () => {
    const html = withAnswerSurface("<style></style><p id=\"loading\" role=\"status\" hidden>Reading the question.</p><script>fetch(\"/research/hermes\"</script>");
    assert.equal(html.includes('id="progress"'), true);
    assert.equal(html.includes('aria-live="polite"'), true);
    assert.equal(html.includes('"/research/progress"'), true);
    assert.equal(html.includes(PROGRESS_LINES.reading), true);
    assert.equal(html.includes("progress-calm"), true);
    assert.equal(html.includes('prefers-reduced-motion: reduce'), true);
    const again = withAnswerSurface(html);
    assert.equal(again.split('id="progress"').length, 2);
  });
});
