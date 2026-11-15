import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { localKnowledge } from "../../src/local.js";

const QUESTIONS = [
  "Who are you?",
  "What does Ultra cost?",
  "Cite a paper about the wash.",
  "What is the boiling point of the unknown alloy?",
];

describe("local knowledge", () => {
  it("stays offline, labelled, and without a citation", () => {
    for (const question of QUESTIONS) {
      const local = localKnowledge(question);
      assert.match(local.reply, /^Offline\. /);
      assert.match(local.reply, /Local/);
      assert.deepEqual(local.citations, []);
      assert.deepEqual(local.found, []);
      assert.equal(/https?:\/\//.test(local.reply), false);
      assert.equal(/\bdoi\b/i.test(local.reply), false);
    }
    assert.match(localKnowledge("What does Ultra cost?").reply, /Ultra is \$220\/€220 per month/);
    assert.match(localKnowledge("What is the boiling point of the unknown alloy?").reply, /marked local/);
    assert.match(localKnowledge("Who are you?").reply, /Galion Research\. What are we looking into\?/);
  });
});
