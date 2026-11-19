// End-to-end harness for a local Galion Research instance.
// Every process here listens on 127.0.0.1 only. The LLM is a loopback stub,
// so no paid or remote model is ever called. The real model choice
// (Hermes on DeepSeek V4.1 Flash via River) is not touched by this harness.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SERVER = join(ROOT, "src", "server.js");

function listen(handler) {
  const server = createServer(handler);
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

function closeServer(server) {
  return new Promise((done) => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => done());
  });
}

export async function freePort() {
  const server = await listen(() => {});
  const { port } = server.address();
  await closeServer(server);
  return port;
}

function readAll(req) {
  return new Promise((done) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
  });
}

// OpenAI-compatible chat stub. `reply(userText)` returns the assistant text,
// or { status } to answer with an HTTP error.
export async function stubLlm(reply) {
  const calls = [];
  const server = await listen(async (req, res) => {
    const body = await readAll(req);
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const user = messages.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n");
    calls.push({ url: req.url, model: parsed?.model ?? null, user, authorization: Boolean(req.headers.authorization) });
    const out = reply(user);
    if (out && typeof out === "object" && out.status) {
      res.writeHead(out.status, { "Content-Type": "text/plain" });
      res.end("stub error");
      return;
    }
    const payload = JSON.stringify({ choices: [{ message: { role: "assistant", content: String(out) } }] });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
    res.end(payload);
  });
  const { port } = server.address();
  return { calls, port, url: `http://127.0.0.1:${port}/v1/chat/completions`, close: () => closeServer(server) };
}

// Stand-in for the galion-one-voice /research routes (the live Hermes desk).
export async function stubVoice() {
  const calls = [];
  const server = await listen(async (req, res) => {
    const body = await readAll(req);
    calls.push({ method: req.method, url: req.url, type: String(req.headers["content-type"] || ""), body });
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method === "POST" && req.url === "/research/ask") {
      const payload = JSON.stringify({
        schema: "galion-research/1",
        app: "hermes",
        status: "Returned",
        reply: "VOICE-DESK-REPLY",
        citations: [],
        found: ["voice found"],
        inferred: [],
        unknown: [],
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not here");
  });
  const { port } = server.address();
  return { calls, port, origin: `http://127.0.0.1:${port}`, close: () => closeServer(server) };
}

// Starts `node src/server.js` as its own process, exactly as systemd does,
// and waits until GET /health answers.
export async function startInstance(env = {}) {
  const port = await freePort();
  const scratch = await mkdtemp(join(tmpdir(), "galion-e2e-"));
  const uploads = join(scratch, "uploads");
  const childEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    PORT: String(port),
    GALION_UPLOAD_DIR: uploads,
    ...env,
  };
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`instance exited early (${child.exitCode}): ${output}`);
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`instance did not answer /health in 15 s: ${output}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    port,
    uploads,
    output: () => output,
    async stop() {
      if (child.exitCode == null) {
        const gone = new Promise((r) => child.once("exit", r));
        child.kill();
        await gone;
      }
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

export function sessionFrom(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = /research_session=([a-f0-9]{32})/.exec(raw);
  return m ? m[1] : null;
}

export async function askJson(base, question, headers = {}) {
  const res = await fetch(`${base}/research/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ question }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text, session: sessionFrom(res), headers: res.headers };
}

export async function askWithFiles(base, question, files, headers = {}) {
  const form = new FormData();
  form.append("question", question);
  for (const file of files) form.append("file", new Blob([file.body]), file.name);
  const res = await fetch(`${base}/research/ask`, { method: "POST", body: form, headers });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text, session: sessionFrom(res) };
}
