import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { UNREACHABLE, researchTurn } from "../../src/hermes.js";
import {
  BAD_JSON,
  BODY_LIMIT,
  BODY_TOO_LONG,
  ERROR_KEYS,
  EMPTY_QUESTION,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  ORIGIN_REFUSED,
  RATE_LIMITED,
  UPSTREAM_REFUSED,
} from "../../src/limits.js";
import { BIND_HOST, healthReadHeaders, sessionToken, start } from "../../src/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = "c".repeat(32);

function loopbackHex(host) {
  const parts = host.split(".").map((part) => Number(part));
  const value = (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
  const le =
    (((value & 0xff) << 24) | ((value & 0xff00) << 8) | ((value >>> 8) & 0xff00) | ((value >>> 24) & 0xff)) >>> 0;
  return le.toString(16).toUpperCase().padStart(8, "0");
}

function listenHexes(file, port) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const found = [];
  for (const line of text.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [ip, p] = (parts[1] || "").split(":");
    if (!p || p.toUpperCase() !== hexPort || parts[3] !== "0A") continue;
    found.push((ip || "").toUpperCase());
  }
  return found;
}

async function withServer(env, fn) {
  const server = await start({ env, port: 0, host: "example.invalid" });
  try {
    const address = server.address();
    await fn(`http://${address.address}:${address.port}`, address);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function assertError(data, code, reply) {
  assert.deepEqual(Object.keys(data), [...ERROR_KEYS]);
  assert.equal(data.schema, "galion-research/1");
  assert.equal(data.app, "hermes");
  assert.equal(data.status, "Error");
  assert.equal(data.error, code);
  assert.equal(data.reply, reply);
  assert.deepEqual(data.citations, []);
  assert.deepEqual(data.found, []);
  assert.deepEqual(data.inferred, []);
  assert.deepEqual(data.unknown, []);
  assert.deepEqual(data.sources, []);
}

async function post(base, question, headers = {}, raw = false) {
  const response = await fetch(`${base}/research/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ? question : JSON.stringify({ question }),
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

function open(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, BIND_HOST, () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://${BIND_HOST}:${port}/v1/chat/completions`,
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
  });
}

describe("headers, cookies, and the loopback bind", () => {
  it("sends the policy and the cookie flags, and listens only on loopback", async () => {
    await withServer({}, async (base, address) => {
      assert.equal(address.address, BIND_HOST);
      assert.ok(address.family === "IPv4" || address.family === 4);
      const hex = loopbackHex(BIND_HOST);
      assert.deepEqual(listenHexes("/proc/net/tcp", address.port), [hex]);
      assert.deepEqual(listenHexes("/proc/net/tcp6", address.port), []);

      const page = await fetch(`${base}/research`);
      const html = await page.text();
      const csp = page.headers.get("content-security-policy");
      const nonce = /'nonce-([^']+)'/.exec(csp)[1];
      assert.match(html, new RegExp(`<style nonce="${nonce}">`));
      assert.match(html, new RegExp(`<script nonce="${nonce}">`));
      assert.equal(csp.includes("unsafe-inline"), false);
      assert.equal(page.headers.get("x-content-type-options"), "nosniff");
      assert.equal(page.headers.get("x-frame-options"), "DENY");
      assert.equal(page.headers.get("referrer-policy"), "no-referrer");
      assert.equal(page.headers.get("cross-origin-resource-policy"), "same-origin");
      const cookie = page.headers.get("set-cookie");
      assert.match(cookie, /research_session=[a-f0-9]{32}/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Secure/);
      assert.match(cookie, /SameSite=Strict/);
      assert.match(cookie, /Path=\//);
      assert.equal(/Domain=/i.test(cookie), false);
      assert.equal(sessionToken(cookie) != null, true);

      const health = await fetch(`${base}/health`);
      const body = await health.json();
      assert.equal(body.bind, address.address);
      assert.equal(health.headers.get("x-content-type-options"), "nosniff");
      const icon = await fetch(`${base}/favicon.ico`);
      assert.equal(icon.status, 204);
      assert.equal(icon.headers.get("x-frame-options"), "DENY");
    });
  });

  it("uses the default port on loopback when the process starts with no PORT", async () => {
    const env = { ...process.env };
    delete env.PORT;
    delete env.GALION_LLM;
    delete env.GALION_LLM_URL;
    delete env.GALION_LLM_KEY;
    delete env.GALION_LLM_KEY_FILE;
    delete env.GALION_LLM_KEY_NAME;
    delete env.CREDENTIALS_DIRECTORY;
    delete env.GALION_RESEARCH_URL;
    delete env.GALION_ASK_RATE;
    delete env.GALION_RATE_LIMIT;
    const child = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      let health = null;
      const started = Date.now();
      while (Date.now() - started < 4_000) {
        if (child.exitCode != null) break;
        try {
          const response = await fetch(`http://${BIND_HOST}:8787/health`);
          if (response.ok) {
            health = await response.json();
            break;
          }
        } catch {
          // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.ok(health, stderr.slice(0, 400));
      assert.equal(health.ok, true);
      assert.equal(health.bind, BIND_HOST);
      const hex = loopbackHex(BIND_HOST);
      assert.deepEqual(listenHexes("/proc/net/tcp", 8787), [hex]);
      assert.deepEqual(listenHexes("/proc/net/tcp6", 8787), []);
    } finally {
      if (child.exitCode == null) child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });
});

describe("one error shape", () => {
  it("returns the same document for size, method, path, and JSON failures", async () => {
    await withServer({}, async (base) => {
      const missing = await fetch(`${base}/research/missing`);
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get("content-type"), "application/json; charset=utf-8");
      assertError(await missing.json(), "not-found", NOT_FOUND);

      const method = await fetch(`${base}/health`, { method: "POST" });
      assert.equal(method.status, 405);
      assert.equal(method.headers.get("allow"), "GET");
      assertError(await method.json(), "method", METHOD_NOT_ALLOWED);

      const ask = await fetch(`${base}/research/ask`);
      assert.equal(ask.status, 405);
      assert.equal(ask.headers.get("allow"), "POST");
      assertError(await ask.json(), "method", METHOD_NOT_ALLOWED);

      const empty = await post(base, "   ");
      assert.equal(empty.response.status, 400);
      assertError(empty.data, "empty", EMPTY_QUESTION);

      const bad = await post(base, "{", {}, true);
      assert.equal(bad.response.status, 400);
      assertError(bad.data, "bad-json", BAD_JSON);

      const bulky = await fetch(`${base}/health`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "x".repeat(BODY_LIMIT + 1),
      });
      assert.equal(bulky.status, 413);
      assertError(await bulky.json(), "too-large", BODY_TOO_LONG);
    });
  });

  it("lets a loopback status page read GET /health without a session or a rate count", async () => {
    await withServer({ GALION_RATE_LIMIT: "1" }, async (base) => {
      const health = await fetch(`${base}/health`);
      const body = await health.json();
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("set-cookie"), null);
      assert.equal(health.headers.get("allow"), "GET");
      assert.deepEqual(body, { ok: true, service: "galion-research", bind: BIND_HOST });

      const desk = await fetch(`${base}/research`);
      assert.equal(desk.status, 200);
      const blocked = await fetch(`${base}/research`);
      assert.equal(blocked.status, 429);

      const again = await fetch(`${base}/health`);
      assert.equal(again.status, 200);
      assert.equal(again.headers.get("set-cookie"), null);
      assert.deepEqual(await again.json(), body);

      const page = await fetch(`${base}/health`, { headers: { Origin: "http://127.0.0.1:18181" } });
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("access-control-allow-origin"), "http://127.0.0.1:18181");
      assert.equal(page.headers.get("cross-origin-resource-policy"), "cross-origin");
      assert.equal(page.headers.get("set-cookie"), null);
      assert.equal((await page.text()).includes("18181"), false);

      const named = await fetch(`${base}/health`, { headers: { Origin: "http://localhost:18181" } });
      assert.equal(named.headers.get("access-control-allow-origin"), "http://localhost:18181");

      const v6 = await fetch(`${base}/health`, { headers: { Origin: "http://[::1]:18181" } });
      assert.equal(v6.headers.get("access-control-allow-origin"), "http://[::1]:18181");

      for (const origin of ["http://example.invalid", "https://127.0.0.1:18181"]) {
        const foreign = await fetch(`${base}/health`, { headers: { Origin: origin } });
        assert.equal(foreign.status, 200);
        assert.equal(foreign.headers.get("access-control-allow-origin"), null);
        assert.equal(foreign.headers.get("cross-origin-resource-policy"), "same-origin");
        const text = await foreign.text();
        assert.equal(text.includes("example.invalid"), false);
        assert.deepEqual(JSON.parse(text), body);
      }
      assert.deepEqual(healthReadHeaders("http://user:pw@127.0.0.1:18181"), {});
      assert.deepEqual(healthReadHeaders("http://example.invalid"), {});
    });
  });

  it("stops a session that asks too often and does not store the refusal", async () => {
    await withServer({ GALION_ASK_RATE: "2" }, async (base) => {
      const headers = { "x-research-session": SESSION };
      const first = await post(base, "Who are you?", headers);
      const second = await post(base, "Who are you?", headers);
      assert.equal(first.response.status, 200);
      assert.equal(second.response.status, 200);
      const third = await post(base, "Who are you?", headers);
      assert.equal(third.response.status, 429);
      assert.match(third.response.headers.get("retry-after") || "", /^[1-9]\d*$/);
      assertError(third.data, "rate", RATE_LIMITED);
      const other = await post(base, "Who are you?", { "x-research-session": "d".repeat(32) });
      assert.equal(other.response.status, 200);
      assert.equal(other.data.status, "Offline");
      assert.deepEqual(other.data.citations, []);
      const history = await (await fetch(`${base}/research/history`, { headers })).json();
      assert.equal(history.items.length, 2);
      assert.equal(JSON.stringify(history).includes(RATE_LIMITED), false);
    });
  });

  it("refuses a cross-site post before it is stored or counted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "galion-origin-"));
    try {
      await withServer({ GALION_ASK_RATE: "1", GALION_UPLOAD_DIR: dir }, async (base) => {
        const url = new URL(base);
        const blocked = await post(base, "Who are you?", {
          "x-research-session": SESSION,
          origin: "https://evil.example",
        });
        assert.equal(blocked.response.status, 403);
        assertError(blocked.data, "origin", ORIGIN_REFUSED);
        assert.match(blocked.response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
        assert.equal(blocked.response.headers.get("referrer-policy"), "no-referrer");

        const otherPort = await post(base, "Who are you?", { origin: `http://127.0.0.1:${Number(url.port) + 1}` });
        assert.equal(otherPort.response.status, 403);

        const crossSite = await post(base, "Who are you?", { "sec-fetch-site": "cross-site" });
        assert.equal(crossSite.response.status, 403);

        const boundary = "originboundary";
        const form = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="question"',
          "",
          "Who are you?",
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="../../etc/passwd"',
          "",
          "secret",
          `--${boundary}--`,
          "",
        ].join("\r\n");
        const uploaded = await fetch(`${base}/research/ask`, {
          method: "POST",
          headers: {
            "content-type": `multipart/form-data; boundary=${boundary}`,
            origin: "https://evil.example",
          },
          body: form,
        });
        assert.equal(uploaded.status, 403);
        assert.deepEqual(await readdir(dir), []);

        const page = await fetch(`${base}/research`, { headers: { origin: "https://evil.example" } });
        assert.equal(page.status, 200);

        const same = await post(base, "Who are you?", { "x-research-session": SESSION, origin: url.origin });
        assert.equal(same.response.status, 200);
        assert.equal(same.data.status, "Offline");
        const desk = await post(base, "Who are you?", { "x-research-session": SESSION, origin: "https://galion.app" });
        assert.equal(desk.response.status, 429);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("turns a plain refusal from the research origin into the same error document", async () => {
    let refused = false;
    const upstream = await open((req, res) => {
      req.resume();
      req.on("end", () => {
        if (refused) {
          res.destroy();
          return;
        }
        refused = true;
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("nope");
      });
    });
    try {
      await withServer({ GALION_RESEARCH_URL: `http://${BIND_HOST}:${upstream.port}` }, async (base) => {
        const asked = await post(base, "What does Ultra cost?", { "x-research-session": SESSION });
        assert.equal(asked.response.status, 400);
        assertError(asked.data, "upstream", UPSTREAM_REFUSED);
        assert.equal(asked.text.includes("nope"), false);
        const history = await (
          await fetch(`${base}/research/history`, { headers: { "x-research-session": SESSION } })
        ).json();
        assert.deepEqual(history.items, []);
        assert.deepEqual(history.sources, []);
      });
    } finally {
      await upstream.close();
    }
  });
});

describe("hermes timeout and unreachable", () => {
  it("ends a trickling reply on the wall clock and stays offline with no citations", async () => {
    const hermes = await open((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "application/json" });
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(timer);
          return;
        }
        res.write(" ");
      }, 40);
      res.on("error", () => clearInterval(timer));
      res.on("close", () => clearInterval(timer));
    });
    try {
      const started = Date.now();
      const turn = await researchTurn({ url: hermes.url, model: "hermes-agent", timeoutMs: 200 }, "What does Ultra cost?");
      const elapsed = Date.now() - started;
      assert.equal(turn.text, UNREACHABLE);
      assert.equal(turn.cause, "timeout");
      assert.deepEqual(turn.citations, []);
      assert.ok(elapsed >= 150 && elapsed < 1_500, `elapsed ${elapsed}`);
      await withServer(
        { GALION_LLM: "hermes", GALION_LLM_URL: hermes.url, GALION_LLM_TIMEOUT_MS: "200" },
        async (base) => {
          const askedAt = Date.now();
          const asked = await post(base, "What does Ultra cost?");
          const askElapsed = Date.now() - askedAt;
          assert.equal(asked.response.status, 200);
          assert.equal(asked.data.status, "Offline");
          assert.match(asked.data.reply, /Ultra is \$220\/€220 per month/);
          assert.deepEqual(asked.data.citations, []);
          assert.deepEqual(asked.data.found, []);
          assert.equal(asked.data.sources[0].label, "Local");
          assert.ok(askElapsed >= 150 && askElapsed < 1_500, `ask ${askElapsed}`);
        },
      );
    } finally {
      await hermes.close();
    }
  });

  it("treats a dropped connection as offline with no citations and does not wait for the timeout", async () => {
    const hermes = await open((req) => {
      req.socket.destroy();
    });
    try {
      const started = Date.now();
      const turn = await researchTurn({ url: hermes.url, model: "hermes-agent", timeoutMs: 2_000 }, "What does Ultra cost?");
      const elapsed = Date.now() - started;
      assert.equal(turn.text, UNREACHABLE);
      assert.equal(turn.cause, "unreachable");
      assert.deepEqual(turn.citations, []);
      assert.ok(elapsed < 1_000, `elapsed ${elapsed}`);
      await withServer(
        { GALION_LLM: "hermes", GALION_LLM_URL: hermes.url, GALION_LLM_TIMEOUT_MS: "2000" },
        async (base) => {
          const askedAt = Date.now();
          const asked = await post(base, "What does Ultra cost?");
          assert.ok(Date.now() - askedAt < 1_000);
          assert.equal(asked.data.status, "Offline");
          assert.deepEqual(asked.data.citations, []);
          assert.deepEqual(asked.data.found, []);
          assert.deepEqual(asked.data.inferred, []);
          assert.match(asked.data.reply, /^Offline\. Local\./);
        },
      );
    } finally {
      await hermes.close();
    }
  });
});
