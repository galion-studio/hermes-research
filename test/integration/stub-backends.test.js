// Local integration suite. The research server, a stub Hermes, and a stub voice
// desk all listen on 127.0.0.1. No public host is dialed and no model is paid for.

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { HELPERS_OFFLINE } from "../../src/desk.js";
import { BODY_LIMIT } from "../../src/limits.js";
import { localKnowledge } from "../../src/local.js";
import { sessionToken, start } from "../../src/server.js";

const KEY = "test-gateway-key-not-for-git";
const SLOW_MS = 8_000;
const PATIENCE_MS = 4_000;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function shut(server) {
  return new Promise((resolve, reject) => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function readIncoming(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function deferClose() {
  let stopped = false;
  const pending = new Set();
  return {
    get stopped() {
      return stopped;
    },
    pause(ms) {
      if (stopped || ms <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        const entry = {
          resolve,
          timer: setTimeout(() => {
            pending.delete(entry);
            resolve();
          }, ms),
        };
        pending.add(entry);
      });
    },
    stop() {
      stopped = true;
      for (const entry of pending) {
        clearTimeout(entry.timer);
        entry.resolve();
      }
      pending.clear();
    },
  };
}

async function stubChat({ delayMs = 0, content = "Found:\n- Stub Hermes answered." } = {}) {
  const calls = [];
  const gate = deferClose();
  const server = http.createServer(async (req, res) => {
    const body = await readIncoming(req);
    calls.push({ url: req.url || "", authorization: req.headers.authorization || "", body });
    await gate.pause(delayMs);
    if (gate.stopped || res.destroyed || res.writableEnded) return;
    const payload = JSON.stringify({ choices: [{ message: { content } }] });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  });
  await listen(server);
  const { port } = server.address();
  return {
    calls,
    port,
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    async close() {
      gate.stop();
      await shut(server);
    },
  };
}

async function stubVoice({ delayMs = 0, reply = "The voice desk answered." } = {}) {
  const calls = [];
  const gate = deferClose();
  const server = http.createServer(async (req, res) => {
    const body = await readIncoming(req);
    calls.push({
      method: req.method || "",
      url: req.url || "",
      authorization: req.headers.authorization || "",
      body,
    });
    await gate.pause(delayMs);
    if (gate.stopped || res.destroyed || res.writableEnded) return;
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (req.method === "POST" && req.url === "/research/ask") {
      const payload = JSON.stringify({
        schema: "galion-research/1",
        app: "hermes",
        status: "Returned",
        reply,
        citations: [],
        found: [],
        inferred: [],
        unknown: [],
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not here");
  });
  await listen(server);
  const { port } = server.address();
  return {
    calls,
    port,
    origin: `http://127.0.0.1:${port}`,
    async close() {
      gate.stop();
      await shut(server);
    },
  };
}

async function offlineBackend() {
  const sockets = { n: 0 };
  const server = http.createServer();
  server.on("connection", (socket) => {
    sockets.n += 1;
    socket.destroy();
  });
  await listen(server);
  const { port } = server.address();
  return {
    sockets,
    port,
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    close: () => shut(server),
  };
}

async function startDesk(env) {
  const server = await start({ env, port: 0 });
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  return {
    address,
    base: `http://127.0.0.1:${address.port}`,
    close: () => shut(server),
  };
}

async function using(fn) {
  const opened = [];
  try {
    await fn((resource) => {
      opened.push(resource);
      return resource;
    });
  } finally {
    for (const resource of opened.reverse()) await resource.close();
  }
}

function cookieFrom(headers) {
  const raw = headers["set-cookie"] ?? headers.get?.("set-cookie");
  const line = Array.isArray(raw) ? raw.join("; ") : String(raw || "");
  const token = sessionToken(line);
  return token ? `research_session=${token}` : "";
}

async function ask(base, question, headers = {}) {
  const response = await fetch(`${base}/research/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { response, data, text };
}

function assertOffline(data, question) {
  const local = localKnowledge(question);
  assert.equal(data.status, "Offline");
  assert.equal(data.reply, local.reply);
  assert.deepEqual(data.citations, []);
  assert.deepEqual(data.found, []);
  assert.deepEqual(data.inferred, []);
  assert.equal(data.helpers, HELPERS_OFFLINE);
  assert.equal(/https?:\/\//.test(data.reply), false);
  assert.equal(JSON.stringify(data).includes(KEY), false);
}

function postForm(base, { question, files }) {
  const boundary = "galionstubbackends";
  const url = new URL("/research/ask", base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      },
      async (res) => {
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, data, text });
      },
    );
    req.on("error", reject);
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="question"\r\n\r\n${question}\r\n`);
    for (const file of files) {
      const type = file.type || "application/octet-stream";
      req.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${type}\r\n\r\n`,
      );
      req.write(file.body);
      req.write("\r\n");
    }
    req.end(`--${boundary}--\r\n`);
  });
}

describe("research server against stub hermes and stub voice", () => {
  it("answers health on loopback and does not dial either stub", async () => {
    await using(async (open) => {
      const hermes = open(await stubChat());
      const voice = open(await stubVoice());
      const desk = open(
        await startDesk({
          GALION_LLM: "hermes",
          GALION_LLM_URL: hermes.url,
          GALION_LLM_KEY: KEY,
          GALION_VOICE_URL: voice.origin,
          GALION_LLM_TIMEOUT_MS: "1000",
          GALION_UPSTREAM_TIMEOUT_MS: "1000",
        }),
      );
      const health = await fetch(`${desk.base}/health`);
      const body = await health.json();
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("set-cookie"), null);
      assert.equal(health.headers.get("allow"), "GET");
      assert.deepEqual(body, { ok: true, service: "galion-research", bind: "127.0.0.1" });
      assert.equal(JSON.stringify(body).includes(KEY), false);
      assert.equal(hermes.calls.length, 0);
      assert.equal(voice.calls.length, 0);
    });
  });

  it("asks stub hermes for a normal question and leaves the voice desk idle", async () => {
    await using(async (open) => {
      const hermes = open(await stubChat());
      const voice = open(await stubVoice());
      const desk = open(
        await startDesk({
          GALION_LLM: "hermes",
          GALION_LLM_URL: hermes.url,
          GALION_LLM_MODEL: "hermes-agent",
          GALION_LLM_KEY: KEY,
          GALION_VOICE_URL: voice.origin,
          GALION_LLM_TIMEOUT_MS: "1000",
        }),
      );
      const asked = await ask(desk.base, "What does the stub say?");
      assert.equal(asked.response.status, 200);
      assert.equal(asked.data.schema, "galion-research/1");
      assert.equal(asked.data.status, "Returned");
      assert.match(asked.data.reply, /Stub Hermes answered/);
      assert.equal(JSON.stringify(asked.data).includes(KEY), false);
      assert.equal(hermes.calls.length, 1);
      assert.equal(hermes.calls[0].authorization, `Bearer ${KEY}`);
      assert.equal(hermes.calls[0].body.includes(KEY), false);
      assert.match(hermes.calls[0].body, /What does the stub say\?/);
      assert.equal(hermes.calls[0].url.startsWith("/v1/chat/completions"), true);
      assert.equal(
        voice.calls.some((call) => call.method === "POST" && call.url === "/research/ask"),
        false,
      );
    });
  });

  it("asks the voice desk when hermes is not attached", async () => {
    await using(async (open) => {
      const voice = open(await stubVoice());
      const desk = open(
        await startDesk({
          GALION_VOICE_URL: voice.origin,
          GALION_LLM_KEY: KEY,
          GALION_UPSTREAM_TIMEOUT_MS: "1000",
          GALION_ASK_TIMEOUT_MS: "1000",
        }),
      );
      const asked = await ask(desk.base, "Route this question");
      assert.equal(asked.response.status, 200);
      assert.equal(asked.data.status, "Returned");
      assert.equal(asked.data.reply, "The voice desk answered.");
      assert.deepEqual(asked.data.citations, []);
      assert.equal(JSON.stringify(asked.data).includes(KEY), false);
      const posts = voice.calls.filter((call) => call.method === "POST" && call.url === "/research/ask");
      assert.equal(posts.length, 1);
      assert.deepEqual(JSON.parse(posts[0].body), { question: "Route this question" });
      assert.equal(posts[0].authorization, "");
    });
  });

  it("returns offline local knowledge when stub hermes is slow", async () => {
    await using(async (open) => {
      const hermes = open(await stubChat({ delayMs: SLOW_MS, content: "This slow hermes reply should not be read." }));
      const voice = open(await stubVoice({ reply: "This voice reply should not be read." }));
      const desk = open(
        await startDesk({
          GALION_LLM: "hermes",
          GALION_LLM_URL: hermes.url,
          GALION_LLM_KEY: KEY,
          GALION_VOICE_URL: voice.origin,
          GALION_LLM_TIMEOUT_MS: "300",
          GALION_ASK_TIMEOUT_MS: "300",
        }),
      );
      const question = "Who are you?";
      const started = Date.now();
      const asked = await ask(desk.base, question);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < PATIENCE_MS, `slow hermes ask took ${elapsed}ms`);
      assertOffline(asked.data, question);
      assert.match(asked.data.reply, /Galion Research/);
      assert.equal(asked.text.includes("should not be read"), false);
      assert.equal(
        voice.calls.some((call) => call.url === "/research/ask"),
        false,
      );
    });
  });

  it("returns offline local knowledge when the voice desk is slow", async () => {
    await using(async (open) => {
      const voice = open(await stubVoice({ delayMs: SLOW_MS, reply: "This slow voice reply should not be read." }));
      const desk = open(
        await startDesk({
          GALION_VOICE_URL: voice.origin,
          GALION_UPSTREAM_TIMEOUT_MS: "300",
          GALION_ASK_TIMEOUT_MS: "300",
        }),
      );
      const question = "Who are you?";
      const started = Date.now();
      const asked = await ask(desk.base, question);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < PATIENCE_MS, `slow voice ask took ${elapsed}ms`);
      assertOffline(asked.data, question);
      assert.equal(asked.text.includes("should not be read"), false);
    });
  });

  it("returns offline local knowledge when both backends are down", async () => {
    await using(async (open) => {
      const hermes = open(await offlineBackend());
      const voice = open(await offlineBackend());
      const desk = open(
        await startDesk({
          GALION_LLM: "hermes",
          GALION_LLM_URL: hermes.url,
          GALION_LLM_KEY: KEY,
          GALION_LLM_TIMEOUT_MS: "8000",
          GALION_VOICE_URL: voice.origin,
          GALION_UPSTREAM_TIMEOUT_MS: "8000",
          GALION_ASK_TIMEOUT_MS: "8000",
        }),
      );
      const question = "What is the boiling point of the unknown alloy?";
      const started = Date.now();
      const asked = await ask(desk.base, question);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < PATIENCE_MS, `offline backend ask took ${elapsed}ms`);
      assert.equal(asked.response.status, 200);
      assertOffline(asked.data, question);
      assert.equal(/\d/.test(asked.data.reply), false);
      assert.equal(asked.data.sources.some((source) => source.label === "Local"), true);
      assert.equal(voice.sockets.n, 0);
      assert.ok(hermes.sockets.n >= 1);
    });
  });

  it("returns offline local knowledge when the voice desk is down and hermes is unset", async () => {
    await using(async (open) => {
      const voice = open(await offlineBackend());
      const desk = open(
        await startDesk({
          GALION_VOICE_URL: voice.origin,
          GALION_UPSTREAM_TIMEOUT_MS: "8000",
          GALION_ASK_TIMEOUT_MS: "8000",
        }),
      );
      const question = "What is the boiling point of the unknown alloy?";
      const started = Date.now();
      const asked = await ask(desk.base, question);
      assert.ok(Date.now() - started < PATIENCE_MS, "offline voice ask waited on the dead desk");
      assert.equal(asked.response.status, 200);
      assertOffline(asked.data, question);
      assert.equal(/\d/.test(asked.data.reply), false);
      assert.ok(voice.sockets.n >= 1);
    });
  });

  it("round-trips an upload of any name and any size the desk was handed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "galion-stub-upload-"));
        const notes = Buffer.from("dotfile-marker\n");
        const head = Buffer.from("START-MARKER\nEND-WITHIN\n");
        const big = Buffer.concat([head, Buffer.alloc(BODY_LIMIT + 128 - head.length, 0x61)]);
        assert.ok(big.length > BODY_LIMIT);
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    try {
      await using(async (open) => {
        const hermes = open(await stubChat({ content: "Found:\n- The handed files were read." }));
        const voice = open(await stubVoice());
        const desk = open(
          await startDesk({
            GALION_UPLOAD_DIR: dir,
            GALION_LLM: "hermes",
            GALION_LLM_URL: hermes.url,
            GALION_LLM_KEY: KEY,
            GALION_VOICE_URL: voice.origin,
            GALION_LLM_TIMEOUT_MS: "2000",
          }),
        );
        const uploaded = await postForm(desk.base, {
          question: "What is in the files?",
          files: [
            { name: ".notes", type: "application/octet-stream", body: notes },
            { name: "capsule", type: "application/x-custom", body: big },
            { name: "blob.bin", type: "application/octet-stream", body: binary },
          ],
        });
        assert.equal(uploaded.status, 200);
        assert.notEqual(uploaded.status, 413);
        assert.equal(uploaded.data.status, "Returned");
        assert.match(uploaded.data.reply, /handed files were read/);
        assert.deepEqual(
          uploaded.data.sources.filter((source) => source.label === "File").map((source) => source.text),
          [".notes", "capsule", "blob.bin"],
        );
        assert.equal(uploaded.text.includes(KEY), false);
        assert.equal(uploaded.text.includes(dir), false);

        const sent = JSON.parse(hermes.calls[0].body);
        const handed = sent.messages.map((message) => message.content).join("\n");
        assert.match(handed, /dotfile-marker/);
        assert.match(handed, /START-MARKER/);
        assert.match(handed, /END-WITHIN/);
        assert.match(handed, /blob\.bin, 4 bytes\. Binary file/);
        assert.match(sent.messages.at(-1).content, /^What is in the files\?/);
        assert.equal(sent.messages.at(-1).content.includes("dotfile-marker"), false);
        assert.equal(handed.includes(dir), false);
        assert.equal(handed.includes(KEY), false);
        assert.equal(
          voice.calls.some((call) => call.url === "/research/ask"),
          false,
        );

        const cookie = cookieFrom(uploaded.headers);
        assert.ok(cookie);
        const sources = await (
          await fetch(`${desk.base}/research/sources`, { headers: { cookie } })
        ).json();
        assert.deepEqual(
          sources.sources.filter((source) => source.label === "File").map((source) => source.text),
          [".notes", "capsule", "blob.bin"],
        );
        const history = await (
          await fetch(`${desk.base}/research/history`, { headers: { cookie } })
        ).json();
        assert.equal(history.items.length, 1);
        assert.equal(history.items[0].question, "What is in the files?");

        const names = await readdir(dir);
        assert.equal(names.length, 3);
        assert.equal(names.every((name) => /^[a-f0-9]{32}$/.test(name)), true);
        for (const name of names) assert.equal(handed.includes(name), false);
        const stored = await Promise.all(names.map(async (name) => readFile(join(dir, name))));
        assert.equal(
          stored.some((body) => body.equals(notes)),
          true,
        );
        assert.equal(
          stored.some((body) => body.equals(big)),
          true,
        );
        assert.equal(
          stored.some((body) => body.equals(binary)),
          true,
        );
        const modes = await Promise.all(names.map((name) => stat(join(dir, name)).then((row) => row.mode & 0o777)));
        assert.equal(modes.every((mode) => mode === 0o600), true);
        assert.equal((await stat(dir)).mode & 0o777, 0o700);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stays in offline mode when no backend is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "galion-stub-offline-"));
    try {
      await using(async (open) => {
        const desk = open(await startDesk({ GALION_UPLOAD_DIR: dir }));
        const health = await fetch(`${desk.base}/health`);
        assert.equal(health.status, 200);
        assert.equal(health.headers.get("set-cookie"), null);
        assert.deepEqual(await health.json(), { ok: true, service: "galion-research", bind: "127.0.0.1" });

        const unknown = "What is the boiling point of the unknown alloy?";
        const asked = await ask(desk.base, unknown);
        assert.equal(asked.response.status, 200);
        assertOffline(asked.data, unknown);
        assert.equal(/\d/.test(asked.data.reply), false);
        assert.equal(asked.data.sources.some((source) => source.label === "Local"), true);

        const cookie = cookieFrom(asked.response.headers);
        const who = await ask(desk.base, "Who are you?", { cookie });
        assert.equal(who.data.status, "Offline");
        assert.match(who.data.reply, /Galion Research/);
        assert.deepEqual(who.data.citations, []);
        assert.equal(/https?:\/\//.test(who.data.reply), false);

        const status = await (await fetch(`${desk.base}/research/hermes`, { headers: { cookie } })).json();
        assert.equal(status.key, "none");
        assert.equal(status.status, "Offline");
        const wire = await (await fetch(`${desk.base}/research/wire`)).json();
        assert.equal(wire.upstreams.voice.state, "unset");
        assert.equal(wire.hermes.attached, false);
        assert.equal(wire.hermes.state, "offline");
        assert.equal(JSON.stringify(wire).includes(KEY), false);

        const uploaded = await postForm(desk.base, {
          question: "What is in the file?",
          files: [{ name: ".notes", type: "application/x-custom", body: Buffer.from("dotfile-marker\n") }],
        });
        assert.equal(uploaded.status, 200);
        assert.notEqual(uploaded.status, 413);
        assert.equal(uploaded.data.status, "Offline");
        assert.match(uploaded.data.reply, /\.notes/);
        assert.match(uploaded.data.reply, /dotfile-marker/);
        assert.deepEqual(uploaded.data.citations, []);
        assert.equal(uploaded.data.sources.some((source) => source.label === "File" && source.text === ".notes"), true);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
