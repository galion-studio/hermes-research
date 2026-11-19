import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDesk } from "../../src/desk.js";
import { withAnswerSurface } from "../../src/answer.js";
import { safeSourceHref, sourceView } from "../../src/source-list.js";

const SESSION = "c".repeat(32);

describe("source view", () => {
  it("keeps a title, a domain, and an http link that the text already had", () => {
    const view = sourceView("Attention Is All You Need — https://arxiv.org/abs/1706.03762");
    assert.equal(view.title, "Attention Is All You Need");
    assert.equal(view.domain, "arxiv.org");
    assert.equal(view.href, "https://arxiv.org/abs/1706.03762");
    assert.equal(sourceView("Notes https://www.example.com/a.").domain, "example.com");
    assert.equal(sourceView("Galion brand note").href, "");
    assert.equal(sourceView("Galion brand note").title, "Galion brand note");
    assert.equal(safeSourceHref("javascript:alert(1)"), "");
    assert.equal(safeSourceHref("http://user:pass@example.com/a"), "");
    assert.equal(safeSourceHref("data:text/html,hi"), "");
  });

  it("stores the link on the session source and does not invent one", async () => {
    const desk = createDesk(
      { attached: true, model: "hermes-agent", key: "", timeoutMs: 50 },
      {
        researchTurn() {
          return Promise.resolve({
            text: "Found\n- The paper is on arXiv.",
            raw: "Found\n- The paper is on arXiv.\n[1] Attention Is All You Need https://arxiv.org/abs/1706.03762",
            citations: [{ n: 1, text: "Attention Is All You Need https://arxiv.org/abs/1706.03762" }],
          });
        },
      },
    );
    const body = await desk.ask("Where is the paper?", SESSION);
    assert.equal(body.sources[0].label, "Citation");
    assert.equal(body.sources[0].title, "Attention Is All You Need");
    assert.equal(body.sources[0].domain, "arxiv.org");
    assert.equal(body.sources[0].href, "https://arxiv.org/abs/1706.03762");
    const quiet = createDesk(
      { attached: false, model: "hermes-agent", key: "", timeoutMs: 50 },
      { researchTurn() { return Promise.resolve({ text: "no", citations: [] }); } },
    );
    const local = await quiet.ask("Who are you?", SESSION);
    assert.equal(local.sources[0].label, "Local");
    assert.equal(local.sources[0].href, "");
  });
});

describe("sources on the page", () => {
  it("adds one list of title, domain, and link", () => {
    const html = withAnswerSurface(
      '<style></style><h2 id="sources-label">Sources</h2><p id="loading" hidden>Reading the question.</p><script>fetch("/research/hermes")</script>',
    );
    assert.equal(html.includes('id="source-links"'), true);
    assert.equal(html.includes("No source yet."), true);
    assert.equal(html.includes("#sources .piles{display:none}"), true);
    assert.equal(html.includes("function paintSourceList"), true);
    assert.equal(html.includes("innerHTML"), false);
    const again = withAnswerSurface(html);
    assert.equal(again.split('id="source-links"').length, 2);
    assert.equal(again.split('id="progress"').length, 2);
  });
});
