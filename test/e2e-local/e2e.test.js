// End-to-end checks against a real local Galion Research process.
// Run: npm run test:e2e-local   (laptop CI: G:\galion\ci\research-e2e.ps1)
// No paid calls: Hermes is a loopback stub. Nothing leaves 127.0.0.1.

import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { askJson, askWithFiles, startInstance, stubLlm, stubVoice } from "./harness.js";

const POSIX = process.platform !== "win32";

const PILES_REPLY = [
  "The desk colours are documented.",
  "Found:",
  "- The desk is Ink #0B0F14.",
  "Inferred:",
  "- The accent is probably Sky.",
  "Unknown:",
  "- When the palette was chosen.",
  "[1] Galion style sheet",
].join("\n");

function stubAnswer(user) {
  if (user.includes("PILES")) return PILES_REPLY;
  if (user.includes("FAIL503")) return { status: 503 };
  return "Found:\n- Stub Hermes answered.\nUnknown:\n- Nothing else.";
}

describe("galion research e2e (local instance, stub Hermes)", () => {
  let llm;
  let app;

  before(async () => {
    llm = await stubLlm(stubAnswer);
    app = await startInstance({ GALION_LLM: "hermes", GALION_LLM_URL: llm.url, GALION_LLM_TIMEOUT_MS: "5000" });
  });

  after(async () => {
    await app?.stop();
    await llm?.close();
  });

  it("health answers on loopback only", async () => {
    const res = await fetch(`${app.base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "galion-research");
    assert.equal(body.bind, "127.0.0.1");
  });

  it("ask round-trip reaches stub Hermes once and returns its answer", async () => {
    const before = llm.calls.length;
    const res = await askJson(app.base, "What does the stub say?");
    assert.equal(res.status, 200);
    assert.equal(res.data.schema, "galion-research/1");
    assert.equal(res.data.status, "Returned");
    assert.match(res.data.reply, /Stub Hermes answered/);
    assert.equal(llm.calls.length, before + 1);
    assert.match(llm.calls.at(-1).user, /What does the stub say\?/);
    assert.equal(llm.calls.at(-1).authorization, false);
  });

  it("splits the answer into Found / Inferred / Unknown and keeps the citation", async () => {
    const res = await askJson(app.base, "PILES what colour is the desk?");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.found, ["The desk is Ink #0B0F14."]);
    assert.deepEqual(res.data.inferred, ["The accent is probably Sky."]);
    assert.deepEqual(res.data.unknown, ["When the palette was chosen."]);
    assert.deepEqual(res.data.citations, [{ n: 1, text: "Galion style sheet" }]);
    assert.equal(res.data.sources.some((s) => s.label === "Citation" && s.text === "Galion style sheet"), true);

    const sources = await (await fetch(`${app.base}/research/sources`, { headers: { Cookie: `research_session=${res.session}` } })).json();
    assert.equal(sources.sources.some((s) => s.label === "Citation" && s.n === 1), true);

    const html = await (await fetch(`${app.base}/research`)).text();
    for (const label of ["Found", "Inferred", "Unknown"]) {
      assert.match(html, new RegExp(`id="${label.toLowerCase()}-label">${label}<`));
    }
  });

  it("refuses cross-site writes with 403", async () => {
    const host = `127.0.0.1:${app.port}`;
    const cases = [
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { Origin: "http://localhost.evil.example" },
      { Origin: "https://galion.app.evil.example" },
      { Origin: "https://galion.app", "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of cases) {
      const res = await askJson(app.base, "cross site?", headers);
      assert.equal(res.status, 403, JSON.stringify(headers));
      assert.equal(res.data.error, "origin");
    }
    const upload = await askWithFiles(app.base, "cross site upload", [{ name: "x.txt", body: "x" }], { Origin: "https://evil.example" });
    assert.equal(upload.status, 403);
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${app.base}/research/ask`, { method, headers: { Origin: "https://evil.example" } });
      assert.equal(res.status, 403, method);
    }
    // Same-origin and the public galion.app origin still work.
    assert.equal((await askJson(app.base, "same origin", { Origin: `http://${host}` })).status, 200);
    assert.equal((await askJson(app.base, "public origin", { Origin: "https://galion.app" })).status, 200);
    // A foreign origin is not echoed by /health.
    const health = await fetch(`${app.base}/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(health.headers.get("access-control-allow-origin"), null);
  });

  it("stores uploads under a random id with dir 700 and files 600", { skip: POSIX ? false : "file modes need Linux (laptop CI runs this in WSL)" }, async () => {
    const res = await askWithFiles(app.base, "What is in the file?", [{ name: "notes.txt", body: "upload-marker-77\n" }]);
    assert.equal(res.status, 200);
    assert.equal(res.data.sources.some((s) => s.label === "File" && s.text === "notes.txt"), true);
    assert.equal((await stat(app.uploads)).mode & 0o777, 0o700);
    const names = await readdir(app.uploads);
    assert.ok(names.length >= 1);
    for (const name of names) {
      assert.match(name, /^[a-f0-9]{32}$/);
      assert.equal((await stat(join(app.uploads, name))).mode & 0o777, 0o600, name);
    }
  });

  it("hands a small uploaded file's text to Hermes", async () => {
    const before = llm.calls.length;
    const res = await askWithFiles(app.base, "Summarise the file", [{ name: "small.txt", body: "SMALL-FILE-MARKER-4410\n" }]);
    assert.equal(res.status, 200);
    assert.equal(llm.calls.length, before + 1);
    assert.match(llm.calls.at(-1).user, /small\.txt/);
    assert.match(llm.calls.at(-1).user, /SMALL-FILE-MARKER-4410/);
  });

  it("Hermes reads the whole uploaded file, not only the first 1 KiB", async () => {
    const filler = "Lorem ipsum galion filler line.\n".repeat(160); // about 5 KiB
    const body = `${filler}DEEP-FILE-MARKER-9921\n${filler}`;
    const before = llm.calls.length;
    const res = await askWithFiles(app.base, "What is the marker deep in this file?", [{ name: "long.txt", body }]);
    assert.equal(res.status, 200);
    assert.equal(llm.calls.length, before + 1);
    assert.match(llm.calls.at(-1).user, /DEEP-FILE-MARKER-9921/);
  });

  it("serves the /research/* routes", async () => {
    for (const path of ["/", "/research", "/research/"]) {
      const res = await fetch(`${app.base}${path}`);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8", path);
      assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/, path);
    }
    for (const path of ["/research/wire", "/research/hermes", "/research/history", "/research/sources", "/research/progress"]) {
      const res = await fetch(`${app.base}${path}`);
      assert.equal(res.status, 200, path);
      const body = await res.json();
      assert.equal(body.schema, "galion-research/1", path);
    }
    const one = await fetch(`${app.base}/one`, { redirect: "manual" });
    assert.equal(one.status, 302);
    assert.equal(one.headers.get("location"), "https://galion.app/one");
    const getAsk = await fetch(`${app.base}/research/ask`);
    assert.equal(getAsk.status, 405);
    assert.equal(getAsk.headers.get("allow"), "POST");
    const postHistory = await fetch(`${app.base}/research/history`, { method: "POST" });
    assert.equal(postHistory.status, 405);
    assert.equal(postHistory.headers.get("allow"), "GET");
    for (const path of ["/research/nope", "/research/../etc/passwd", "/admin"]) {
      const res = await fetch(`${app.base}${path}`);
      assert.equal(res.status, 404, path);
    }
    const favicon = await fetch(`${app.base}/favicon.ico`);
    assert.equal(favicon.status, 204);
  });
});

describe("offline fallback to local knowledge", () => {
  it("answers from local knowledge when Hermes is unreachable", async () => {
    // A port nothing listens on: the turn fails fast and the desk goes local.
    const app = await startInstance({ GALION_LLM: "hermes", GALION_LLM_URL: "http://127.0.0.1:9/v1/chat/completions", GALION_LLM_TIMEOUT_MS: "1000" });
    try {
      const res = await askJson(app.base, "What does Ultra cost per month?");
      assert.equal(res.status, 200);
      assert.equal(res.data.status, "Offline");
      assert.match(res.data.reply, /^Offline\. Local\./);
      assert.match(res.data.reply, /\$220\/€220 per month/);
      assert.deepEqual(res.data.citations, []);
      assert.deepEqual(res.data.found, []);
      assert.ok(res.data.unknown.length >= 1);
      assert.equal(res.data.sources.some((s) => s.label === "Local"), true);
    } finally {
      await app.stop();
    }
  });

  it("goes local when Hermes answers with an HTTP error", async () => {
    const llm = await stubLlm(() => ({ status: 503 }));
    const app = await startInstance({ GALION_LLM: "hermes", GALION_LLM_URL: llm.url });
    try {
      const res = await askJson(app.base, "Who are you?");
      assert.equal(res.status, 200);
      assert.equal(res.data.status, "Offline");
      assert.match(res.data.reply, /Galion Research/);
      assert.equal(llm.calls.length, 1);
    } finally {
      await app.stop();
      await llm.close();
    }
  });

  it("stays local with no Hermes configured at all", async () => {
    const app = await startInstance({});
    try {
      const res = await askJson(app.base, "Something nobody knows");
      assert.equal(res.status, 200);
      assert.equal(res.data.status, "Offline");
      assert.match(res.data.reply, /not reachable from here/);
      const status = await (await fetch(`${app.base}/research/hermes`)).json();
      assert.equal(status.key, "none");
    } finally {
      await app.stop();
    }
  });
});

describe("routing to the voice desk upstream", () => {
  it("forwards a JSON ask to the galion-one-voice /research/ask route when Hermes is not attached", async () => {
    const voice = await stubVoice();
    const app = await startInstance({ GALION_VOICE_URL: voice.origin });
    try {
      const res = await askJson(app.base, "Route me");
      assert.equal(res.status, 200);
      assert.equal(res.data.reply, "VOICE-DESK-REPLY");
      const asked = voice.calls.filter((c) => c.method === "POST" && c.url === "/research/ask");
      assert.equal(asked.length, 1);
      assert.deepEqual(JSON.parse(asked[0].body), { question: "Route me" });
      const wire = await (await fetch(`${app.base}/research/wire`)).json();
      assert.equal(wire.upstreams.voice.state, "up");
    } finally {
      await app.stop();
      await voice.close();
    }
  });

  // Since #31: when Hermes is attached, a JSON ask goes to Hermes, not the voice desk.
  it("asks Hermes, not the voice desk, when Hermes is attached", async () => {
    const voice = await stubVoice();
    const llm = await stubLlm(stubAnswer);
    const app = await startInstance({ GALION_VOICE_URL: voice.origin, GALION_LLM: "hermes", GALION_LLM_URL: llm.url });
    try {
      const res = await askJson(app.base, "Route me");
      assert.equal(res.status, 200);
      assert.notEqual(res.data.reply, "VOICE-DESK-REPLY");
      assert.equal(llm.calls.length, 1);
      assert.match(llm.calls[0].user, /Route me/);
      assert.equal(voice.calls.filter((c) => c.method === "POST" && c.url === "/research/ask").length, 0);
    } finally {
      await app.stop();
      await llm.close();
      await voice.close();
    }
  });

  it("an upload with the voice desk configured reaches Hermes with the file text", async () => {
    const voice = await stubVoice();
    const llm = await stubLlm(stubAnswer);
    const app = await startInstance({ GALION_VOICE_URL: voice.origin, GALION_LLM: "hermes", GALION_LLM_URL: llm.url });
    try {
      const filler = "x".repeat(3000);
      const res = await askWithFiles(app.base, "Read this file", [{ name: "doc.txt", body: `${filler}\nVOICE-UPLOAD-MARKER-3307\n` }]);
      assert.equal(res.status, 200);
      const seen = [...voice.calls.map((c) => c.body), ...llm.calls.map((c) => c.user)].join("\n");
      assert.match(seen, /VOICE-UPLOAD-MARKER-3307/);
    } finally {
      await app.stop();
      await llm.close();
      await voice.close();
    }
  });
});
