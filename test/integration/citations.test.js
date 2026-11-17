import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";

import { readGatewayCitations } from "../../src/hermes.js";
import { start } from "../../src/server.js";

const SESSION = "d".repeat(32);

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function withServer(env, fn) {
  const server = await start({ env, port: 0 });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await close(server);
  }
}

describe("gateway citations", () => {
  it("reads title and url from the fields Hermes returns, and drops a script link", () => {
    const payload = JSON.stringify({
      choices: [
        {
          message: {
            content: [{ type: "text", text: "Found\n- The paper is on arXiv." }],
            annotations: [
              {
                type: "url_citation",
                url_citation: { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" },
              },
            ],
            citations: ["javascript:alert(1)"],
          },
          search_results: [{ title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" }],
        },
      ],
    });
    const cites = readGatewayCitations(payload);
    assert.equal(cites.length, 1);
    assert.equal(cites[0].n, 1);
    assert.match(cites[0].text, /Attention Is All You Need/);
    assert.match(cites[0].text, /https:\/\/arxiv.org\/abs\/1706.03762/);
    assert.equal(JSON.stringify(cites).includes("javascript:"), false);
  });

  it("asks Hermes directly when it is up, even if the voice desk would answer first", async () => {
    let voiceHits = 0;
    const voice = await listen((req, res) => {
      voiceHits += 1;
      req.resume();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          schema: "galion-research/1",
          status: "Returned",
          reply: "Voice had no source.",
          citations: [],
          found: [],
          inferred: ["Voice had no source."],
          unknown: [],
        }),
      );
    });
    const gateway = await listen((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const payload = JSON.stringify({
          choices: [
            {
              message: {
                content: "The paper is on arXiv.",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" },
                  },
                ],
              },
            },
          ],
        });
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
        res.end(payload);
      });
    });
    try {
      const voicePort = voice.address().port;
      const hermesPort = gateway.address().port;
      await withServer(
        {
          GALION_VOICE_URL: `http://127.0.0.1:${voicePort}`,
          GALION_LLM: "hermes",
          GALION_LLM_URL: `http://127.0.0.1:${hermesPort}/v1/chat/completions`,
          GALION_LLM_TIMEOUT_MS: "1000",
        },
        async (base) => {
          const response = await fetch(`${base}/research/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-research-session": SESSION },
            body: JSON.stringify({ question: "Where is the paper?" }),
          });
          const asked = await response.json();
          assert.equal(voiceHits, 0);
          assert.equal(asked.status, "Returned");
          assert.match(asked.citations[0].text, /https:\/\/arxiv.org\/abs\/1706.03762/);
          assert.equal(asked.sources[0].title, "Attention Is All You Need");
          assert.equal(asked.sources[0].domain, "arxiv.org");
          assert.equal(asked.sources[0].href, "https://arxiv.org/abs/1706.03762");
          assert.deepEqual(asked.found, ["Attention Is All You Need"]);
        },
      );
    } finally {
      await close(voice);
      await close(gateway);
    }
  });
});
