import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptAnswer,
  acceptCitations,
  forwardConfig,
  loopbackOrigin,
  voiceTarget,
} from "../../src/forward.js";

describe("loopback forward config", () => {
  it("accepts a loopback origin and refuses anything else", () => {
    const openmind = loopbackOrigin("http://127.0.0.1:18181");
    assert.equal(openmind.state, "ok");
    assert.equal(openmind.origin, "http://127.0.0.1:18181");
    assert.equal(loopbackOrigin("").state, "unset");
    assert.equal(loopbackOrigin("https://galion.app").state, "refused");
    assert.equal(loopbackOrigin("http://example.invalid:18181").state, "refused");
    assert.equal(loopbackOrigin("http://user:pass@127.0.0.1:18181").state, "refused");
  });

  it("keeps an explicit voice URL on loopback and does not inherit a public origin", () => {
    const voice = voiceTarget({ GALION_VOICE_URL: "http://127.0.0.1:9" });
    assert.equal(voice.state, "ok");
    assert.equal(voice.forward, "http://127.0.0.1:9");
    const refused = voiceTarget({
      GALION_VOICE_URL: "https://galion.app",
      GALION_RESEARCH_URL: "http://127.0.0.1:9",
    });
    assert.equal(refused.state, "refused");
    assert.equal(refused.forward, null);
    const legacy = voiceTarget({ GALION_RESEARCH_URL: "https://galion.app" });
    assert.equal(legacy.state, "refused");
    assert.equal(legacy.forward, null);
    assert.equal(legacy.origin, null);
    const cfg = forwardConfig({});
    assert.equal(cfg.openmind.state, "unset");
    assert.equal(cfg.voice.state, "unset");
    assert.equal(cfg.timeoutMs, 4_000);
  });
});

describe("citation acceptance", () => {
  it("keeps a handed citation and does not add one from the reply", () => {
    const accepted = acceptAnswer(
      JSON.stringify({
        schema: "galion-research/1",
        status: "Returned",
        reply: "The wash is Ink and Sky.\n[2] Not handed",
        citations: [{ n: 1, text: "Handed source" }],
      }),
    );
    assert.deepEqual(accepted.citations, [{ n: 1, text: "Handed source" }]);
    const empty = acceptAnswer(
      JSON.stringify({
        schema: "galion-research/1",
        status: "NotFound",
        reply: "I don't have a source for that.\n[1] Invented Journal",
        citations: [],
      }),
    );
    assert.deepEqual(empty.citations, []);
  });

  it("rejects a citation that was not a handed { n, text } pair", () => {
    assert.equal(
      acceptAnswer(
        JSON.stringify({
          schema: "galion-research/1",
          status: "Returned",
          reply: "See INVENTED-PAPER-ZX91",
          citations: "INVENTED-PAPER-ZX91",
        }),
      ),
      null,
    );
    assert.equal(acceptCitations([{ n: "1", text: "Invented Journal 1999" }]), null);
    assert.equal(acceptCitations([{ n: 1, text: "" }]), null);
    assert.equal(
      acceptAnswer(JSON.stringify({ status: "Returned", reply: "no schema", citations: [] })),
      null,
    );
  });
});
