import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RESEARCH_CUES, cueHz } from "../../src/cues.js";
import {
  DEFAULT_URL,
  UNREACHABLE,
  citeLines,
  configFromEnv,
  parseLoopbackChatUrl,
  researchTurn,
} from "../../src/hermes.js";

describe("hermes unit", () => {
  it("keeps cues on 432 Hz just intonation", () => {
    for (const cue of RESEARCH_CUES) assert.equal(cueHz(cue.ratio), cue.hz);
    assert.equal(cueHz("2:1"), 864);
    assert.equal(cueHz("3:2"), 648);
    assert.equal(cueHz("5:4"), 540);
    assert.equal(cueHz("1:2"), 216);
    assert.equal(cueHz("1:4"), 108);
  });

  it("does not call a host that is not loopback", async () => {
    assert.ok(parseLoopbackChatUrl(DEFAULT_URL));
    assert.equal(parseLoopbackChatUrl("http://example.invalid:8642/v1/chat/completions"), null);
    assert.equal(configFromEnv({ GALION_LLM: "mock" }).attached, false);
    assert.equal(configFromEnv({ GALION_LLM: "echo" }).attached, false);
    assert.equal(configFromEnv({ GALION_LLM_TIMEOUT_MS: "85000" }).timeoutMs, 85_000);
    assert.equal(configFromEnv({ GALION_LLM_TIMEOUT_MS: "600000" }).timeoutMs, 95_000);
    const started = Date.now();
    const turn = await researchTurn(
      { url: "http://example.invalid:9/v1/chat/completions", model: "hermes-agent", timeoutMs: 50 },
      "What does Ultra cost?",
    );
    assert.equal(turn.text, UNREACHABLE);
    assert.deepEqual(turn.citations, []);
    assert.ok(Date.now() - started < 500);
    assert.equal(citeLines("No marker on this line.").length, 0);
  });
});
