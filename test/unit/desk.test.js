import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDesk } from "../../src/desk.js";
import { UNREACHABLE } from "../../src/hermes.js";

const SESSION_A = "a".repeat(32);
const SESSION_B = "b".repeat(32);

function hermes() {
  return {
    attached: true,
    url: "http://127.0.0.1:9/v1/chat/completions",
    model: "hermes-agent",
    key: "",
    timeoutMs: 50,
  };
}

describe("desk sessions", () => {
  it("keeps sources on the session that asked, and drops an invented citation", async () => {
    const calls = [];
    const desk = createDesk(hermes(), {
      researchTurn(_config, question) {
        calls.push(question);
        if (String(question).includes("wash")) {
          const raw = "Found\n- The wash is Ink.\n[1] Galion brand note";
          return Promise.resolve({
            text: "Found The wash is Ink.",
            raw,
            citations: [{ n: 1, text: "Galion brand note" }],
          });
        }
        return Promise.resolve({
          text: UNREACHABLE,
          citations: [{ n: 1, text: "Invented paper 1999" }],
        });
      },
    });

    const returned = await desk.ask("What colour is the wash?", SESSION_A);
    assert.equal(calls.length, 1);
    assert.equal(returned.status, "Returned");
    assert.equal(returned.citations.length, 1);
    assert.equal(returned.sources[0].label, "Citation");
    assert.equal(returned.sources[0].text, "Galion brand note");

    const offline = await desk.ask("What does Ultra cost?", SESSION_B);
    assert.equal(offline.status, "Offline");
    assert.match(offline.reply, /Ultra is \$220\/€220 per month/);
    assert.deepEqual(offline.citations, []);
    assert.deepEqual(offline.found, []);
    assert.equal(offline.sources.length, 1);
    assert.equal(offline.sources[0].label, "Local");
    assert.equal(JSON.stringify(offline).includes("Invented paper"), false);
    assert.equal(JSON.stringify(offline).includes("Galion brand note"), false);

    const sourcesA = desk.sourcesBody(SESSION_A).sources;
    const sourcesB = desk.sourcesBody(SESSION_B).sources;
    assert.equal(sourcesA.some((source) => source.label === "Citation"), true);
    assert.equal(sourcesB.some((source) => source.label === "Citation"), false);
    assert.equal(desk.historyBody(SESSION_A).items[0].question.includes("wash"), true);
    assert.equal(desk.historyBody(SESSION_B).items.some((item) => item.question.includes("wash")), false);
  });

  it("does not call Hermes when the desk is not attached", async () => {
    let calls = 0;
    const desk = createDesk(
      { ...hermes(), attached: false },
      {
        researchTurn() {
          calls += 1;
          return Promise.resolve({ text: "should not run", citations: [{ n: 1, text: "no" }] });
        },
      },
    );
    const body = await desk.ask("Who are you?", SESSION_A);
    assert.equal(calls, 0);
    assert.equal(body.status, "Offline");
    assert.deepEqual(body.citations, []);
    assert.equal(desk.statusBody(SESSION_A).status, "Offline");
  });
});
