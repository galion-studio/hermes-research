import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RESEARCH_CUES, audible, cueHz } from "../src/cues.js";
import { HELPERS_LOCAL, HELPERS_RUNNING, notebookPiles, researchState } from "../src/desk.js";
import {
  DEFAULT_URL,
  REFUSED,
  RESEARCH_PROMPT,
  citeLines,
  configFromEnv,
  containsForbidden,
  guardText,
  isLoopback,
  parseLoopbackChatUrl,
  researchTurn,
} from "../src/hermes.js";
import { localKnowledge } from "../src/local.js";
import { oneTarget, researchOrigin, sessionToken, start } from "../src/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "test-gateway-key-not-for-git";

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

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("page", () => {
  it("reuses the research desk", async () => {
    const html = await readFile(path.join(ROOT, "public/research.html"), "utf8");
    for (const needle of [
      "<title>Galion Research</title>",
      'data-product="research"',
      'data-voice="galion-research"',
      'data-voice-to-voice="on"',
      'data-handoff="voice"',
      'placeholder="Ask anything…"',
      "Galion Research. What are we looking into?",
      'id="first-run"',
      "<h1>What are we looking into?</h1>",
      'id="first-run-line"',
      "A question starts here.",
      'id="prompt"',
      'id="voice"',
      'id="voice-dot"',
      'aria-label="Voice"',
      "function markInner",
      'edge:"#0B5FA5"',
      'ice:"#B8E8FF"',
      'core:"#58C4FF"',
      'data-silence="off"',
      'id="silence"',
      ">Silence<",
      'getAttribute("data-silence")==="on"',
      'aria-expanded="false"',
      'id="work"',
      "Galion Research is a PhD-level research workspace, separate from Galion One, with its own memory",
      'id="add-file"',
      'id="add-image"',
      'id="file-names"',
      'fd.append("file"',
      "new FormData()",
      'id="ui-toggle"',
      "Show interface",
      'id="sources"',
      'id="citations"',
      'id="notebook"',
      'id="found"',
      'id="inferred"',
      'id="unknown"',
      'id="experiment"',
      "Ask first",
      'id="helpers"',
      "Helpers: reading, sources, notebook.",
      "None in hand.",
      "No source yet.",
      'id="error"',
      'id="state-line"',
      'role="alert"',
      "Research · Offline",
      "The question is empty.",
      "The question is longer than 2000 characters.",
      "What is already known stays marked local.",
      "research.galion.app",
      "Galion Research for live users is coming very soon.",
      "Download alpha on GitHub",
      "https://github.com/galion-studio/obsidian-open-mind/actions/workflows/openmind-desktop.yml",
      "No GitHub Release is published yet.",
      "Developed by Galion Labs.",
      "MIT License",
      "Ultra $220/€220 per month",
      'href="/one"',
      "#0B0F14",
      "#58C4FF",
      "#B8E8FF",
      "#0B5FA5",
      "G.A.L.I.O.N. — General Autonomous Local Intelligence Open Network",
      "Developed and distributed by Galion Labs",
      "Perpetual Open MIT License",
      "Copyright © 2026 Galion Labs. All rights reserved.",
      "Permission is hereby granted, free of charge",
      'data-theme="ink"',
      'name="theme"',
      'aria-label="Found"',
      'aria-label="Inferred"',
      'aria-label="Unknown"',
      'aria-label="Found is empty"',
      'aria-label="Inferred is empty"',
      'aria-label="Unknown is empty"',
      "In a source.",
      "Reasoned from what is in hand.",
      "Not established.",
      'id="loading"',
      "Reading the question.",
      "prefers-reduced-motion",
      "--om-ink:#0B0F14",
      "--om-ice:#B8E8FF",
      "--om-sky:#58C4FF",
      "--om-ocean:#0B5FA5",
      "Skip to ask",
    ]) {
      assert.ok(html.includes(needle), `missing ${needle}`);
    }
    assert.equal(html.includes("fillText"), false);
    assert.equal(html.includes('id="s"'), false);
    assert.equal(html.includes('data-mark="orb"'), false);
    assert.equal(html.includes(".wav"), false);
    assert.equal(html.includes("<audio"), false);
    for (const cue of RESEARCH_CUES) {
      assert.ok(html.includes(`id:"${cue.id}"`), cue.id);
      assert.ok(html.includes(`ratio:"${cue.ratio}"`), cue.ratio);
      assert.ok(html.includes(`hz:${cue.hz}`), String(cue.hz));
      assert.equal(cueHz(cue.ratio), cue.hz);
    }
    assert.equal(audible("off"), true);
    assert.equal(audible(false), true);
    assert.equal(audible("on"), false);
    assert.equal(audible(true), false);
    assert.equal(audible("1"), false);
    assert.equal(html.includes('if(silenceOn()) return;'), true);
    assert.ok(html.includes('id="send"'));
    assert.ok(html.includes('type="submit"'));
    assert.ok(html.includes('aria-label="Send"'));
    assert.ok(html.includes('enterkeyhint="send"'));
    assert.ok(html.includes("askForm.requestSubmit()"));
    assert.ok(html.includes('addEventListener("submit"'));
  });
});

describe("licence and archive", () => {
  it("keeps the october notes and the four licence lines", async () => {
    const licence = await readFile(path.join(ROOT, "LICENSE"), "utf8");
    const plan = await readFile(path.join(ROOT, "docs/archive/PLAN.md"), "utf8");
    assert.match(plan, /7 October 2026/);
    assert.match(licence, /Permission is hereby granted, free of charge/);
    for (const line of [
      "G.A.L.I.O.N. — General Autonomous Local Intelligence Open Network",
      "Developed and distributed by Galion Labs",
      "Perpetual Open MIT License",
      "Copyright © 2026 Galion Labs. All rights reserved.",
    ]) {
      assert.ok(licence.includes(line), line);
    }
    const names = await readdir(ROOT, { recursive: true });
    const audio = names.filter((name) => /\.(wav|mp3|ogg|flac|m4a)$/i.test(name));
    assert.deepEqual(audio, []);
  });

  it("does not commit a key or a public address", async () => {
    const files = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        // build/ is the Pi seed output, including the downloaded Node tree. It is not committed.
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "build") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.(js|md|html|yml|json|example|service|sh)$/.test(entry.name) || entry.name === "LICENSE") files.push(full);
      }
    }
    await walk(ROOT);
    const ip = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const privateKey = ["BEGIN", "PRIVATE", "KEY"].join(" ");
      const minted = new RegExp(`sk-${"[A-Za-z0-9]{16,}"}`);
      assert.equal(text.includes(privateKey) || minted.test(text), false, file);
      if (!file.includes(`${path.sep}test${path.sep}`)) assert.equal(text.includes(KEY), false, file);
      for (const found of text.match(ip) || []) {
        assert.equal(isLoopback(found), true, `${file} has ${found}`);
      }
    }
  });
});

describe("hermes client", () => {
  it("accepts only a loopback chat url", () => {
    assert.ok(parseLoopbackChatUrl(DEFAULT_URL));
    assert.equal(parseLoopbackChatUrl("https://127.0.0.1:8642/v1/chat/completions"), null);
    assert.equal(parseLoopbackChatUrl("http://example.invalid:8642/v1/chat/completions"), null);
    assert.equal(parseLoopbackChatUrl("http://user@127.0.0.1:8642/v1/chat/completions"), null);
    assert.equal(configFromEnv({}).attached, false);
    assert.equal(configFromEnv({ GALION_LLM: "canned", GALION_LLM_URL: DEFAULT_URL }).attached, false);
    assert.equal(configFromEnv({ GALION_LLM: "hermes" }).attached, true);
  });

  it("reads citation lines and does not invent one", () => {
    const raw = 'The wash is Ink.\n[1] Galion brand note\nno marker here';
    assert.deepEqual(citeLines(raw), [{ n: 1, text: "Galion brand note" }]);
    assert.equal(citeLines("I don't have a source for that.").length, 0);
    assert.equal(guardText("[1] Galion brand note\nThe wash is Ink."), "Galion brand note The wash is Ink.");
    assert.equal(guardText("I'm sorry to hear that."), REFUSED);
    assert.equal(containsForbidden("Your mother died this morning."), false);
  });

  it("keeps the key off the research turn", async () => {
    let seen = "";
    const mock = await listen((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        seen = Buffer.concat(chunks).toString("utf8");
        const content = "The wash is Ink and Sky.\n[1] Galion brand note";
        const payload = JSON.stringify({ choices: [{ message: { content } }] });
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
        res.end(payload);
      });
    });
    try {
      const { port } = mock.address();
      const turn = await researchTurn(
        { url: `http://127.0.0.1:${port}/v1/chat/completions`, model: "hermes-agent", key: KEY, timeoutMs: 1000 },
        "What colour is the wash?",
      );
      assert.match(turn.text, /Ink and Sky/);
      assert.equal(turn.citations[0].n, 1);
      assert.match(turn.citations[0].text, /Galion brand note/);
      assert.equal(turn.text.includes(KEY), false);
      assert.match(seen, /Galion Research/);
      assert.equal(seen.includes(KEY), false);
    } finally {
      await closed(mock);
    }
  });
});

describe("desk", () => {
  it("sorts the notebook and refuses a source it was not given", () => {
    const piles = notebookPiles("Answer first.\nFound\n- The wash is Ink.\nInferred\n- The night is deliberate.\nUnknown\n- The next measurement.");
    assert.deepEqual(piles.found, ["The wash is Ink."]);
    assert.deepEqual(piles.inferred, ["The night is deliberate."]);
    assert.deepEqual(piles.unknown, ["The next measurement."]);
    assert.equal(researchState("I don't have a source for that."), "NotFound");
    const local = localKnowledge("What is the boiling point of the unknown alloy?");
    assert.equal(local.citations.length, 0);
    assert.match(local.reply, /^Local\.|marked local/);
    assert.match(localKnowledge("What does Ultra cost?").reply, /\$220\/€220 per month/);
    assert.match(HELPERS_RUNNING, /reading, sources, notebook/);
    assert.match(HELPERS_LOCAL, /Local knowledge/);
  });
});

describe("server", () => {
  it("serves the desk and answers from local knowledge", async () => {
    await withServer({}, async (base) => {
      const page = await fetch(`${base}/research`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /Ask anything/);
      const root = await fetch(`${base}/`);
      assert.equal(root.status, 200);
      const icon = await fetch(`${base}/favicon.ico`);
      assert.equal(icon.status, 204);
      const status = await (await fetch(`${base}/research/hermes`)).json();
      assert.equal(status.app, "hermes");
      assert.equal(status.key, "none");
      assert.equal(status.status, "Offline");
      assert.equal(JSON.stringify(status).includes(KEY), false);
      const asked = await fetch(`${base}/research/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Who are you?" }),
      });
      const cookie = cookieFrom(asked);
      const body = await asked.json();
      assert.equal(body.status, "Offline");
      assert.match(body.reply, /Galion Research\. What are we looking into\?/);
      assert.match(body.reply, /^Offline\. Local\./);
      assert.deepEqual(body.citations, []);
      assert.equal(body.found.length, 0);
      assert.equal(body.sources.length, 1);
      assert.equal(body.sources[0].label, "Local");
      assert.equal(body.sources.some((source) => source.label === "Citation"), false);
      assert.equal(body.helpers, HELPERS_LOCAL);
      const history = await (await fetch(`${base}/research/history`, { headers: { cookie } })).json();
      assert.match(history.items[0].question, /Who are you/);
      assert.equal(history.items[0].citations.length, 0);
      assert.equal(history.sources[0].label, "Local");
      const empty = await fetch(`${base}/research/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "   " }),
      });
      assert.equal(empty.status, 400);
      const one = await fetch(`${base}/one`, { redirect: "manual" });
      assert.equal(one.status, 302);
      assert.equal(one.headers.get("location"), "https://galion.app/one");
      const health = await fetch(`${base}/health`);
      const healthBody = await health.json();
      assert.equal(health.status, 200);
      assert.equal(healthBody.ok, true);
      assert.equal(healthBody.service, "galion-research");
      assert.equal(healthBody.bind, "127.0.0.1");
      assert.equal(JSON.stringify(healthBody).includes(KEY), false);
      const healthPost = await fetch(`${base}/health`, { method: "POST" });
      assert.equal(healthPost.status, 405);
      const healthPostBody = await healthPost.json();
      assert.equal(healthPostBody.status, "Error");
      assert.equal(healthPostBody.error, "method");
      assert.deepEqual(healthPostBody.citations, []);
    });
  });

  it("reaches hermes without leaking the key", async () => {
    let authorization = "";
    let body = "";
    const mock = await listen((req, res) => {
      authorization = req.headers.authorization || "";
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8");
        const content = "Found\n- The wash is Ink and Sky.\n[1] Galion brand note";
        const payload = JSON.stringify({ choices: [{ message: { content } }] });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
      });
    });
    try {
      const { port } = mock.address();
      const env = {
        GALION_LLM: "hermes",
        GALION_LLM_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
        GALION_LLM_MODEL: "hermes-agent",
        GALION_LLM_KEY: KEY,
        GALION_LLM_TIMEOUT_MS: "1000",
      };
      await withServer(env, async (base) => {
        const ready = await (await fetch(`${base}/research/hermes`)).json();
        assert.equal(ready.key, "set");
        assert.equal(ready.status, "Idle");
        assert.equal(JSON.stringify(ready).includes(KEY), false);
        const health = await (await fetch(`${base}/health`)).json();
        assert.equal(health.ok, true);
        assert.equal(JSON.stringify(health).includes(KEY), false);
        const askedResponse = await fetch(`${base}/research/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: "What colour is the wash?" }),
        });
        const asked = await askedResponse.json();
        assert.equal(asked.status, "Returned");
        assert.equal(asked.citations.length, 1);
        assert.equal(asked.citations[0].n, 1);
        assert.match(asked.citations[0].text, /Galion brand note/);
        assert.deepEqual(asked.found, ["The wash is Ink and Sky."]);
        assert.equal(asked.sources[0].label, "Citation");
        assert.match(asked.sources[0].text, /Galion brand note/);
        const packed = JSON.stringify(asked);
        assert.equal(packed.includes(KEY), false);
        assert.equal(packed.includes("Bearer"), false);
        const historyResponse = await fetch(`${base}/research/history`, { headers: { cookie: cookieFrom(askedResponse) } });
        const history = await historyResponse.text();
        assert.equal(history.includes(KEY), false);
        assert.match(history, /What colour is the wash/);
      });
      assert.equal(authorization, `Bearer ${KEY}`);
      assert.equal(body.includes(KEY), false);
      assert.match(body, /Galion Research/);
      assert.match(RESEARCH_PROMPT, /Do not invent a paper/);
    } finally {
      await closed(mock);
    }
  });

  it("does not invent a citation when hermes has no source", async () => {
    const mock = await listen((req, res) => {
      req.resume();
      const content = "I don't have a source for that.";
      const payload = JSON.stringify({ choices: [{ message: { content } }] });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
    });
    try {
      const { port } = mock.address();
      await withServer(
        { GALION_LLM: "hermes", GALION_LLM_URL: `http://127.0.0.1:${port}/v1/chat/completions`, GALION_LLM_TIMEOUT_MS: "1000" },
        async (base) => {
          const asked = await (
            await fetch(`${base}/research/ask`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: "Cite the paper." }),
            })
          ).json();
          assert.equal(asked.status, "NotFound");
          assert.deepEqual(asked.citations, []);
          assert.match(asked.reply, /don't have a source/);
        },
      );
    } finally {
      await closed(mock);
    }
  });

  it("forwards to the galion-one-voice research origin and falls back when it is down", async () => {
    let forwarded = 0;
    let sawAuth = false;
    const upstream = await listen((req, res) => {
      forwarded += 1;
      sawAuth = sawAuth || Boolean(req.headers.authorization);
      if (req.url.startsWith("/research/hermes")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ schema: "galion-research/1", app: "hermes", key: "set", status: "Idle" }));
        return;
      }
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            schema: "galion-research/1",
            app: "hermes",
            status: "Returned",
            question: "From the origin",
            reply: "Returned from galion-one-voice.",
            citations: [{ n: 1, text: "Handed source" }],
            found: [],
            inferred: [],
            unknown: [],
          }),
        );
      });
    });
    try {
      const { port } = upstream.address();
      await withServer({ GALION_RESEARCH_URL: `http://127.0.0.1:${port}`, GALION_LLM_KEY: KEY }, async (base) => {
        const ready = await (await fetch(`${base}/research/hermes`)).json();
        assert.equal(ready.status, "Idle");
        assert.equal(ready.key, "set");
        const asked = await (
          await fetch(`${base}/research/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: "From the origin" }),
          })
        ).json();
        assert.equal(asked.reply, "Returned from galion-one-voice.");
        assert.equal(asked.citations[0].text, "Handed source");
        assert.equal(sawAuth, false);
      });
      assert.equal(forwarded >= 2, true);
    } finally {
      await closed(upstream);
    }

    const down = await listen((req, res) => {
      res.writeHead(503);
      res.end("down");
    });
    try {
      const { port: downPort } = down.address();
      await withServer({ GALION_RESEARCH_URL: `http://127.0.0.1:${downPort}`, GALION_LLM_KEY: KEY }, async (base) => {
        const asked = await (
          await fetch(`${base}/research/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: "What does Ultra cost?" }),
          })
        ).json();
        assert.equal(asked.status, "Offline");
        assert.match(asked.reply, /Ultra is \$220\/€220 per month/);
        assert.deepEqual(asked.citations, []);
        assert.equal(JSON.stringify(asked).includes(KEY), false);
      });
    } finally {
      await closed(down);
    }
  });

  it("refuses a public research origin", () => {
    assert.equal(researchOrigin("https://galion.app"), "https://galion.app");
    assert.equal(researchOrigin("http://example.invalid"), null);
    assert.equal(oneTarget(""), "https://galion.app/one");
    assert.equal(oneTarget("https://galion.app/one"), "https://galion.app/one");
  });
});

describe("deploy kit", () => {
  it("keeps secrets out of the env examples and pins the unit to loopback", async () => {
    for (const name of [".env.example", "deploy/research.env.example"]) {
      const text = await readFile(path.join(ROOT, name), "utf8");
      assert.match(text, /^# GALION_LLM_KEY_FILE=\s*$/m, name);
      assert.match(text, /^# GALION_LLM_KEY_NAME=\s*$/m, name);
      assert.match(text, /^# GALION_LLM_KEY=\s*$/m, name);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        for (const key of ["GALION_LLM_KEY", "GALION_LLM_KEY_FILE", "GALION_LLM_KEY_NAME"]) {
          assert.equal(new RegExp(`^${key}=.+$`).test(trimmed), false, `${name}: ${trimmed}`);
        }
      }
    }
    const unit = await readFile(path.join(ROOT, "deploy/systemd/galion-research.service"), "utf8");
    for (const line of [
      "127.0.0.1:8787",
      "Environment=PORT=8787",
      "User=galion",
      "NoNewPrivileges=yes",
      "ProtectSystem=strict",
      "PrivateTmp=yes",
      "ProtectHome=yes",
      "IPAddressDeny=any",
      "IPAddressAllow=localhost",
      "MemoryMax=256M",
      "Restart=on-failure",
      "Type=notify",
    ]) {
      assert.ok(unit.includes(line), line);
    }
    assert.equal(unit.includes("GALION_LLM_KEY="), false);
    assert.equal(unit.includes("GALION_LLM_KEY_FILE="), false);
    assert.equal(unit.includes("GALION_LLM_KEY_NAME="), false);
    assert.equal(unit.includes("LoadCredential="), false);
    assert.equal(unit.includes("/opt/galion/hermes/.env"), false);
    const piUnit = await readFile(path.join(ROOT, "deploy/systemd/galion-research-pi5.service"), "utf8");
    assert.equal(piUnit.includes("LoadCredential="), false);
    assert.equal(piUnit.includes("/opt/galion/hermes/.env"), false);
    assert.equal(piUnit.includes("GALION_LLM_KEY="), false);
    const doc = await readFile(path.join(ROOT, "docs/DEPLOY.md"), "utf8");
    assert.match(doc, /release\/<sha>/);
    assert.match(doc, /\/opt\/galion\/research\/current/);
    assert.match(doc, /rollback/i);
    assert.match(doc, /127\.0\.0\.1:8787/);
    assert.match(doc, /GALION_LLM_KEY_FILE/);
    assert.match(doc, /GALION_LLM_KEY_NAME/);
    assert.match(doc, /LoadCredential=hermes-env:\/opt\/galion\/hermes\/\.env/);
    assert.match(doc, /Environment=GALION_LLM_KEY_FILE=hermes-env/);
    assert.match(doc, /Environment=GALION_LLM_KEY_NAME=API_SERVER_KEY/);
    const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
    assert.match(readme, /GALION_LLM_KEY_FILE/);
    assert.match(readme, /GALION_LLM_KEY_NAME/);
    assert.match(readme, /LoadCredential=hermes-env:\/opt\/galion\/hermes\/\.env/);
    assert.match(readme, /Environment=GALION_LLM_KEY_FILE=hermes-env/);
    assert.match(readme, /Environment=GALION_LLM_KEY_NAME=API_SERVER_KEY/);
  });

  it("refuses to execute the health check or the release dry-run", async () => {
    const health = path.join(ROOT, "scripts/check-health.js");
    const refused = spawnSync(process.execPath, [health, "--execute"], { encoding: "utf8" });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /refusing/);
    const badPort = spawnSync(process.execPath, [health, "http://127.0.0.1:8787/health"], { encoding: "utf8" });
    assert.equal(badPort.status, 2);
    const release = path.join(ROOT, "scripts/deploy/release-dryrun.sh");
    const blocked = spawnSync("bash", [release, "--execute"], { encoding: "utf8" });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /refusing/);
    const printed = spawnSync("bash", [release, "466b784b80b40a2efe1798fdfbb377c6d5c80144"], { encoding: "utf8" });
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /release\/466b784b80b40a2efe1798fdfbb377c6d5c80144/);
    assert.match(printed.stdout, /\/opt\/galion\/research\/current -> /);
    assert.match(printed.stdout, /rollback:/);
    assert.match(printed.stdout, /no connection will be made/);
    await withServer({}, async (base) => {
      const port = new URL(base).port;
      const ok = await run(process.execPath, [health, port]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, new RegExp(`ok http://127\\.0\\.0\\.1:${port}/health`));
    });
  });
});

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function closed(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
