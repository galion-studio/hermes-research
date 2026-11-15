import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { start } from "../../src/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = "test-gateway-key-not-for-git";
const SENTINEL = "INVENTED-PAPER-ZX91";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closed(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function withServer(env, fn) {
  const server = await start({ env, port: 0 });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await closed(server);
  }
}

function entryPage(id, title) {
  return `<!doctype html><main data-entry="${id}"><h1>${title}</h1></main>`;
}

describe("forward contract against local stubs", () => {
  it("serves the wire indicator without editing the desk file", async () => {
    const file = await readFile(path.join(ROOT, "public/research.html"), "utf8");
    assert.equal(file.includes('id="wire-status"'), false);
    await withServer({}, async (base) => {
      const html = await (await fetch(`${base}/research`)).text();
      assert.equal(html.includes('id="wire-status"'), true);
      assert.equal(html.includes('data-wire="openmind voice"'), true);
      assert.equal(html.includes('fetch("/research/wire"'), true);
      const wire = await (await fetch(`${base}/research/wire`)).json();
      assert.equal(wire.schema, "galion-research/1");
      assert.equal(wire.upstreams.openmind.state, "unset");
      assert.equal(wire.upstreams.voice.state, "unset");
      assert.equal(wire.hermes.attached, false);
      assert.equal(wire.hermes.state, "offline");
      assert.equal(JSON.stringify(wire).includes(KEY), false);
      const health = await (await fetch(`${base}/health`)).json();
      assert.equal(health.ok, true);
      assert.equal(health.service, "galion-research");
    });
  });

  it("keeps a handed citation on success and does not add one from the reply", async () => {
    let sawAuth = false;
    const openmind = await listen((req, res) => {
      const id = req.url.startsWith("/research") ? "research" : "one";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(entryPage(id, id === "one" ? "Galion One" : "Galion Research"));
    });
    const voice = await listen((req, res) => {
      sawAuth = sawAuth || Boolean(req.headers.authorization);
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          schema: "galion-research/1",
          app: "hermes",
          status: "Returned",
          reply: "The wash is Ink and Sky.\n[2] Not handed",
          citations: [{ n: 1, text: "Handed source" }],
          found: ["The wash is Ink and Sky."],
          inferred: [],
          unknown: [],
        }),
      );
    });
    try {
      const openPort = openmind.address().port;
      const voicePort = voice.address().port;
      await withServer(
        {
          GALION_OPENMIND_URL: `http://127.0.0.1:${openPort}`,
          GALION_VOICE_URL: `http://127.0.0.1:${voicePort}`,
          GALION_LLM_KEY: KEY,
          GALION_UPSTREAM_TIMEOUT_MS: "500",
        },
        async (base) => {
          const wire = await (await fetch(`${base}/research/wire`)).json();
          assert.equal(wire.upstreams.openmind.state, "up");
          assert.equal(wire.upstreams.openmind.port, openPort);
          assert.equal(wire.upstreams.voice.state, "up");
          assert.equal(wire.upstreams.voice.port, voicePort);
          assert.equal(wire.hermes.state, "offline");
          const one = await fetch(`${base}/one`, { redirect: "manual" });
          assert.equal(one.status, 302);
          assert.equal(one.headers.get("location"), `http://127.0.0.1:${openPort}/one`);
          const asked = await (
            await fetch(`${base}/research/ask`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: "What colour is the wash?" }),
            })
          ).json();
          assert.equal(asked.status, "Returned");
          assert.deepEqual(asked.citations, [{ n: 1, text: "Handed source" }]);
          assert.equal(JSON.stringify(asked.citations).includes("Not handed"), false);
          assert.equal(JSON.stringify(asked).includes(KEY), false);
          assert.equal(JSON.stringify(asked).includes("Bearer"), false);
        },
      );
      assert.equal(sawAuth, false);
    } finally {
      await closed(openmind);
      await closed(voice);
    }
  });

  it("stops at the timeout and does not invent a citation", async () => {
    const hung = await listen(() => {});
    try {
      const port = hung.address().port;
      await withServer(
        {
          GALION_OPENMIND_URL: `http://127.0.0.1:${port}`,
          GALION_VOICE_URL: `http://127.0.0.1:${port}`,
          GALION_UPSTREAM_TIMEOUT_MS: "200",
        },
        async (base) => {
          const started = Date.now();
          const asked = await (
            await fetch(`${base}/research/ask`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: "Who are you?" }),
            })
          ).json();
          const elapsed = Date.now() - started;
          assert.ok(elapsed < 1_500, `ask took ${elapsed}ms`);
          assert.equal(asked.status, "Offline");
          assert.deepEqual(asked.citations, []);
          assert.equal(JSON.stringify(asked).includes(SENTINEL), false);
          const wireStarted = Date.now();
          const wire = await (await fetch(`${base}/research/wire`)).json();
          const wireElapsed = Date.now() - wireStarted;
          assert.ok(wireElapsed < 1_500, `wire took ${wireElapsed}ms`);
          assert.equal(wire.upstreams.voice.state, "timeout");
          assert.equal(wire.upstreams.openmind.state, "timeout");
          assert.equal(wire.hermes.state, "offline");
        },
      );
    } finally {
      await closed(hung);
    }
  });

  it("marks Hermes down and keeps citations empty", async () => {
    const hermesDown = createServer();
    hermesDown.on("connection", (socket) => socket.destroy());
    await new Promise((resolve) => hermesDown.listen(0, "127.0.0.1", resolve));
    const voice = await listen((req, res) => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("down");
    });
    try {
      const hermesPort = hermesDown.address().port;
      const voicePort = voice.address().port;
      await withServer(
        {
          GALION_LLM: "hermes",
          GALION_LLM_URL: `http://127.0.0.1:${hermesPort}/v1/chat/completions`,
          GALION_LLM_KEY: KEY,
          GALION_LLM_TIMEOUT_MS: "300",
          GALION_VOICE_URL: `http://127.0.0.1:${voicePort}`,
          GALION_UPSTREAM_TIMEOUT_MS: "300",
        },
        async (base) => {
          const wire = await (await fetch(`${base}/research/wire`)).json();
          assert.equal(wire.upstreams.voice.state, "down");
          assert.equal(wire.hermes.attached, true);
          assert.equal(wire.hermes.state, "down");
          const asked = await (
            await fetch(`${base}/research/ask`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: "Cite the paper." }),
            })
          ).json();
          assert.equal(asked.status, "Offline");
          assert.deepEqual(asked.citations, []);
          assert.equal(asked.sources.some((source) => source.label === "Citation"), false);
          assert.equal(JSON.stringify(asked).includes(KEY), false);
          assert.equal(JSON.stringify(asked).includes(SENTINEL), false);
        },
      );
    } finally {
      await closed(hermesDown);
      await closed(voice);
    }
  });

  it("drops a malformed upstream body instead of keeping an invented citation", async () => {
    const openmind = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html>no entry</html>");
    });
    const voice = await listen((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("not-ok");
        return;
      }
      req.resume();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "Returned",
          reply: `See ${SENTINEL}`,
          citations: SENTINEL,
        }),
      );
    });
    try {
      const openPort = openmind.address().port;
      const voicePort = voice.address().port;
      await withServer(
        {
          GALION_OPENMIND_URL: `http://127.0.0.1:${openPort}`,
          GALION_VOICE_URL: `http://127.0.0.1:${voicePort}`,
          GALION_UPSTREAM_TIMEOUT_MS: "500",
        },
        async (base) => {
          const wire = await (await fetch(`${base}/research/wire`)).json();
          assert.equal(wire.upstreams.openmind.state, "malformed");
          assert.equal(wire.upstreams.voice.state, "malformed");
          const asked = await (
            await fetch(`${base}/research/ask`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: "Cite the paper." }),
            })
          ).json();
          assert.equal(asked.status, "Offline");
          assert.deepEqual(asked.citations, []);
          assert.equal(JSON.stringify(asked).includes(SENTINEL), false);
        },
      );
    } finally {
      await closed(openmind);
      await closed(voice);
    }
  });

  it("does not dial a refused upstream", async () => {
    await withServer(
      {
        GALION_OPENMIND_URL: "https://galion.app",
        GALION_VOICE_URL: "http://example.invalid:9",
        GALION_LLM_KEY: KEY,
      },
      async (base) => {
        const started = Date.now();
        const wire = await (await fetch(`${base}/research/wire`)).json();
        const asked = await (
          await fetch(`${base}/research/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: "Who are you?" }),
          })
        ).json();
        assert.ok(Date.now() - started < 1_000);
        assert.equal(wire.upstreams.openmind.state, "refused");
        assert.equal(wire.upstreams.voice.state, "refused");
        assert.equal(asked.status, "Offline");
        assert.deepEqual(asked.citations, []);
        assert.equal(JSON.stringify(wire).includes(KEY), false);
        assert.equal(JSON.stringify(asked).includes(KEY), false);
        const one = await fetch(`${base}/one`, { redirect: "manual" });
        assert.equal(one.headers.get("location"), "https://galion.app/one");
      },
    );
  });
});
