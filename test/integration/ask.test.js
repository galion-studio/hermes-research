import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BAD_JSON,
  BODY_LIMIT,
  BODY_TOO_LONG,
  EMPTY_QUESTION,
  QUESTION_TOO_LONG,
} from "../../src/limits.js";
import { sessionToken, start } from "../../src/server.js";
import { stubHermes } from "../stub-hermes.js";

const KEY = "test-gateway-key-not-for-git";
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

function cookieFrom(response, previous = "") {
  const token = sessionToken(response.headers.get("set-cookie") || "");
  return token ? `research_session=${token}` : previous;
}

async function post(base, question, headers = {}, raw = false) {
  const response = await fetch(`${base}/research/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ? question : JSON.stringify({ question }),
  });
  let data = null;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { response, data, text };
}

describe("integration with a stub Hermes", () => {
  it("uses the stub reply and keeps each session's sources apart", async () => {
    const stub = await stubHermes(({ body }) => {
      const question = JSON.parse(body).messages.at(-1).content;
      if (question.includes("wash")) {
        return { content: "Found\n- The wash is Ink and Sky.\n[1] Galion brand note" };
      }
      return { content: "Found\n- Galion One is the product.\n[2] Galion product note" };
    });
    try {
      const env = {
        GALION_LLM: "hermes",
        GALION_LLM_URL: stub.url,
        GALION_LLM_MODEL: "hermes-agent",
        GALION_LLM_KEY: KEY,
        GALION_LLM_TIMEOUT_MS: "1000",
      };
      await withServer(env, async (base) => {
        const wash = await post(base, "What colour is the wash?", { "x-research-session": SESSION_A });
        assert.equal(wash.response.status, 200);
        assert.equal(wash.data.status, "Returned");
        assert.equal(wash.data.citations.length, 1);
        assert.equal(wash.data.citations[0].text, "Galion brand note");
        assert.equal(wash.data.sources[0].label, "Citation");
        assert.equal(JSON.stringify(wash.data).includes(KEY), false);

        const product = await post(base, "What is Galion One?", { "x-research-session": SESSION_B });
        assert.equal(product.data.citations[0].text, "Galion product note");
        assert.equal(JSON.stringify(product.data).includes("Galion brand note"), false);

        const sourcesA = await (
          await fetch(`${base}/research/sources`, { headers: { "x-research-session": SESSION_A } })
        ).json();
        const sourcesB = await (
          await fetch(`${base}/research/sources`, { headers: { "x-research-session": SESSION_B } })
        ).json();
        assert.deepEqual(
          sourcesA.sources.map((source) => source.text),
          ["Galion brand note"],
        );
        assert.deepEqual(
          sourcesB.sources.map((source) => source.text),
          ["Galion product note"],
        );
        const historyA = await (
          await fetch(`${base}/research/history`, { headers: { "x-research-session": SESSION_A } })
        ).json();
        assert.equal(historyA.items.length, 1);
        assert.match(historyA.items[0].question, /wash/);
      });
      assert.equal(stub.calls.length, 2);
      assert.equal(stub.calls[0].host.startsWith("127.0.0.1"), true);
      assert.equal(stub.calls[0].authorization, `Bearer ${KEY}`);
      assert.equal(stub.calls[0].body.includes(KEY), false);
    } finally {
      await stub.close();
    }
  });

  it("carries local knowledge when the stub cannot be reached", async () => {
    const stub = await stubHermes({ content: "This should not be read." });
    const url = stub.url;
    await stub.close();
    const env = {
      GALION_LLM: "hermes",
      GALION_LLM_URL: url,
      GALION_LLM_TIMEOUT_MS: "300",
    };
    await withServer(env, async (base) => {
      const started = Date.now();
      const asked = await post(base, "What does Ultra cost?");
      assert.ok(Date.now() - started < 2_000);
      assert.equal(asked.data.status, "Offline");
      assert.match(asked.data.reply, /Ultra is \$220\/€220 per month/);
      assert.match(asked.data.reply, /^Offline\. Local\./);
      assert.deepEqual(asked.data.citations, []);
      assert.deepEqual(asked.data.found, []);
      assert.equal(asked.data.sources.length, 1);
      assert.equal(asked.data.sources[0].label, "Local");
      assert.equal(/https?:\/\//.test(asked.data.reply), false);
      const unknown = await post(base, "What is the boiling point of the unknown alloy?", {
        cookie: cookieFrom(asked.response),
      });
      assert.equal(unknown.data.status, "Offline");
      assert.match(unknown.data.reply, /marked local/);
      assert.deepEqual(unknown.data.citations, []);
      assert.equal(unknown.data.sources.every((source) => source.label === "Local"), true);
      assert.equal(/\d/.test(unknown.data.reply), false);
    });
  });

  it("refuses an oversized or empty question without inventing an answer", async () => {
    await withServer({}, async (base) => {
      const empty = await post(base, "   ");
      assert.equal(empty.response.status, 400);
      assert.equal(empty.data.status, "Error");
      assert.equal(empty.data.error, "empty");
      assert.equal(empty.data.reply, EMPTY_QUESTION);
      assert.deepEqual(empty.data.citations, []);

      const bad = await post(base, "{", {}, true);
      assert.equal(bad.response.status, 400);
      assert.equal(bad.data.error, "bad-json");
      assert.equal(bad.data.reply, BAD_JSON);

      const marker = "Q".repeat(2001);
      const tooLong = await post(base, marker);
      assert.equal(tooLong.response.status, 413);
      assert.equal(tooLong.data.status, "Error");
      assert.equal(tooLong.data.error, "too-large");
      assert.equal(tooLong.data.reply, QUESTION_TOO_LONG);
      assert.deepEqual(tooLong.data.citations, []);
      assert.equal(tooLong.text.includes(marker), false);

      const bulky = await post(base, "x".repeat(BODY_LIMIT + 1), {}, true);
      assert.equal(bulky.response.status, 413);
      assert.equal(bulky.data.reply, BODY_TOO_LONG);
      assert.equal(bulky.text.includes("xxxx"), false);

      const cookie = cookieFrom(tooLong.response);
      const history = await (await fetch(`${base}/research/history`, { headers: { cookie } })).json();
      assert.deepEqual(history.items, []);
      assert.deepEqual(history.sources, []);

      const still = await post(base, "Who are you?", { cookie });
      assert.equal(still.response.status, 200);
      assert.equal(still.data.status, "Offline");
      assert.match(still.data.reply, /Galion Research/);
    });
  });

  it("does not attach to a public chat url", async () => {
    const started = Date.now();
    await withServer(
      { GALION_LLM: "hermes", GALION_LLM_URL: "http://example.invalid:8642/v1/chat/completions", GALION_LLM_TIMEOUT_MS: "50" },
      async (base) => {
        const asked = await post(base, "What does Ultra cost?");
        assert.equal(asked.data.status, "Offline");
        assert.deepEqual(asked.data.citations, []);
        assert.match(asked.data.reply, /\$220\/€220 per month/);
      },
    );
    assert.ok(Date.now() - started < 1_000);
  });
});
