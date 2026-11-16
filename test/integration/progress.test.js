import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { start } from "../../src/server.js";
import { stubHermes } from "../stub-hermes.js";

const SESSION_A = "a".repeat(32);
const SESSION_B = "b".repeat(32);

async function withServer(env, fn) {
  const server = await start({ env, port: 0 });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe("GET /research/progress", () => {
  it("is idle until a question is in flight, and only that session sees it", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const stub = await stubHermes(() => gate.then(() => ({ content: "Found\n- The wash is Ink.\n[1] Galion brand note" })));
    try {
      await withServer(
        {
          GALION_LLM: "hermes",
          GALION_LLM_URL: stub.url,
          GALION_LLM_MODEL: "hermes-agent",
          GALION_LLM_TIMEOUT_MS: "5000",
        },
        async (base) => {
          const page = await fetch(`${base}/research`);
          const html = await page.text();
          assert.equal(html.includes('id="progress"'), true);
          assert.equal(html.includes('"/research/progress"'), true);
          assert.equal(html.includes('id="send"'), true);

          const idle = await (await fetch(`${base}/research/progress`, { headers: { "x-research-session": SESSION_A } })).json();
          assert.equal(idle.phase, "idle");
          assert.deepEqual(idle.helpers, []);

          const pending = fetch(`${base}/research/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-research-session": SESSION_A },
            body: JSON.stringify({ question: "What colour is the wash?" }),
          });
          let seen = null;
          for (let i = 0; i < 50; i += 1) {
            seen = await (await fetch(`${base}/research/progress`, { headers: { "x-research-session": SESSION_A } })).json();
            if (seen.phase === "reading") break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert.equal(seen.phase, "reading");
          assert.equal(seen.schema, "galion-research/1");
          const other = await (await fetch(`${base}/research/progress`, { headers: { "x-research-session": SESSION_B } })).json();
          assert.equal(other.phase, "idle");

          release();
          const asked = await pending;
          const body = await asked.json();
          assert.equal(asked.status, 200);
          assert.equal(body.status, "Returned");
          const done = await (await fetch(`${base}/research/progress`, { headers: { "x-research-session": SESSION_A } })).json();
          assert.equal(done.phase, "done");
          assert.equal(done.calls, 1);

          const empty = await fetch(`${base}/research/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-research-session": SESSION_B },
            body: JSON.stringify({ question: "   " }),
          });
          assert.equal(empty.status, 400);
          const still = await (await fetch(`${base}/research/progress`, { headers: { "x-research-session": SESSION_B } })).json();
          assert.equal(still.phase, "idle");

          const wrong = await fetch(`${base}/research/progress`, { method: "POST" });
          assert.equal(wrong.status, 405);
        },
      );
    } finally {
      await stub.close();
    }
  });
});
