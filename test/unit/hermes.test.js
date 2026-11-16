import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { RESEARCH_CUES, cueHz } from "../../src/cues.js";
import {
  DEFAULT_URL,
  UNREACHABLE,
  citeLines,
  configFromEnv,
  keyState,
  parseLoopbackChatUrl,
  readKeyFile,
  researchTurn,
} from "../../src/hermes.js";
import { start } from "../../src/server.js";
import { stubHermes } from "../stub-hermes.js";

const SECRET = "test-key-not-for-git";
const ENV_KEY = "env-key-not-for-git";
const FILE = `# c\nOTHER=1\nexport API_SERVER_KEY="${SECRET}"\n`;

describe("hermes unit", () => {
  it("keeps cues on 432 Hz just intonation", () => {
    for (const cue of RESEARCH_CUES) assert.equal(cueHz(cue.ratio), cue.hz);
    assert.equal(cueHz("2:1"), 864);
    assert.equal(cueHz("3:2"), 648);
    assert.equal(cueHz("5:4"), 540);
    assert.equal(cueHz("1:2"), 216);
    assert.equal(cueHz("1:4"), 108);
  });

  it("does not call a host that is not loopback", async () => {
    assert.ok(parseLoopbackChatUrl(DEFAULT_URL));
    assert.equal(parseLoopbackChatUrl("http://example.invalid:8642/v1/chat/completions"), null);
    assert.equal(configFromEnv({ GALION_LLM: "mock" }).attached, false);
    assert.equal(configFromEnv({ GALION_LLM: "echo" }).attached, false);
    assert.equal(configFromEnv({ GALION_LLM_TIMEOUT_MS: "85000" }).timeoutMs, 85_000);
    assert.equal(configFromEnv({ GALION_LLM_TIMEOUT_MS: "600000" }).timeoutMs, 95_000);
    const started = Date.now();
    const turn = await researchTurn(
      { url: "http://example.invalid:9/v1/chat/completions", model: "hermes-agent", timeoutMs: 50 },
      "What does Ultra cost?",
    );
    assert.equal(turn.text, UNREACHABLE);
    assert.deepEqual(turn.citations, []);
    assert.ok(Date.now() - started < 500);
    assert.equal(citeLines("No marker on this line.").length, 0);
  });
});

describe("gateway key file", () => {
  it("reads one dotenv line and lets that value win", () => {
    const reads = [];
    const env = {
      GALION_LLM_KEY_FILE: "/x/.env",
      GALION_LLM_KEY_NAME: " API_SERVER_KEY ",
      GALION_LLM_KEY: `  ${ENV_KEY}  `,
    };
    const keysBefore = Object.keys(env).sort();
    const otherBefore = process.env.OTHER;
    const nameBefore = process.env.API_SERVER_KEY;
    const cfg = configFromEnv(env, (filePath) => {
      reads.push(filePath);
      return FILE;
    });
    assert.equal(typeof cfg.then, "undefined");
    assert.deepEqual(reads, ["/x/.env"]);
    assert.equal(cfg.key, SECRET);
    assert.equal(keyState(cfg.key), "set");
    assert.deepEqual(Object.keys(env).sort(), keysBefore);
    assert.equal(cfg.OTHER, undefined);
    assert.equal(process.env.OTHER, otherBefore);
    assert.equal(process.env.API_SERVER_KEY, nameBefore);
    assert.equal(inspect(cfg).includes(SECRET), false);
    assert.match(inspect(cfg), /set/);
    assert.equal(JSON.stringify({ key: keyState(cfg.key) }).includes(SECRET), false);
  });

  it("falls back when the path, the name, the read, or the line misses", () => {
    const reads = [];
    const unread = (filePath) => {
      reads.push(filePath);
      throw new Error("file was read");
    };
    assert.equal(configFromEnv({ GALION_LLM_KEY: `  ${ENV_KEY}  ` }, unread).key, ENV_KEY);
    assert.equal(
      configFromEnv({ GALION_LLM_KEY_FILE: "/x/.env", GALION_LLM_KEY: ENV_KEY }, unread).key,
      ENV_KEY,
    );
    assert.equal(
      configFromEnv({ GALION_LLM_KEY_FILE: "  ", GALION_LLM_KEY_NAME: "API_SERVER_KEY", GALION_LLM_KEY: ENV_KEY }, unread).key,
      ENV_KEY,
    );
    assert.equal(
      configFromEnv({ GALION_LLM_KEY_FILE: "/x/.env", GALION_LLM_KEY_NAME: "  ", GALION_LLM_KEY: ENV_KEY }, unread).key,
      ENV_KEY,
    );
    assert.deepEqual(reads, []);

    const emptyRead = configFromEnv(
      { GALION_LLM_KEY_FILE: "/x/.env", GALION_LLM_KEY_NAME: "API_SERVER_KEY", GALION_LLM_KEY: ENV_KEY },
      () => "",
    );
    assert.equal(emptyRead.key, ENV_KEY);

    for (const text of [
      "# c\nOTHER=1\n",
      "API_SERVER_KEY=\nOTHER=1\n",
      'API_SERVER_KEY=""\nAPI_SERVER_KEY=' + SECRET + "\n",
      "API_SERVER_KEY=''\n",
      "API_SERVER_KEY=   \n",
    ]) {
      const cfg = configFromEnv(
        { GALION_LLM_KEY_FILE: "/x/.env", GALION_LLM_KEY_NAME: "API_SERVER_KEY", GALION_LLM_KEY: ENV_KEY },
        () => text,
      );
      assert.equal(cfg.key, ENV_KEY, text);
    }

    const quoted = configFromEnv(
      { GALION_LLM_KEY_FILE: "/x/.env", GALION_LLM_KEY_NAME: "API_SERVER_KEY" },
      () => "API_SERVER_KEY = '" + SECRET + "'\n",
    );
    assert.equal(quoted.key, SECRET);
    assert.equal(keyState(configFromEnv({}, unread).key), "none");
  });

  it("reads a credential name and refuses a relative path", () => {
    const reads = [];
    const read = (filePath) => {
      reads.push(filePath);
      return FILE;
    };
    const fromCredential = configFromEnv(
      {
        GALION_LLM_KEY_FILE: "hermes-env",
        GALION_LLM_KEY_NAME: "API_SERVER_KEY",
        CREDENTIALS_DIRECTORY: "/tmp/creds",
        GALION_LLM_KEY: ENV_KEY,
      },
      read,
    );
    assert.deepEqual(reads, ["/tmp/creds/hermes-env"]);
    assert.equal(fromCredential.key, SECRET);

    reads.length = 0;
    const absolute = configFromEnv(
      {
        GALION_LLM_KEY_FILE: "/x/.env",
        GALION_LLM_KEY_NAME: "API_SERVER_KEY",
        CREDENTIALS_DIRECTORY: "/tmp/creds",
      },
      read,
    );
    assert.deepEqual(reads, ["/x/.env"]);
    assert.equal(absolute.key, SECRET);

    for (const file of ["../secret", "keys/hermes.env", "..", "foo/../x", "hermes\\env", "hermes-env"]) {
      reads.length = 0;
      const cfg = configFromEnv(
        {
          GALION_LLM_KEY_FILE: file,
          GALION_LLM_KEY_NAME: "API_SERVER_KEY",
          CREDENTIALS_DIRECTORY: file === "hermes-env" ? "tmp/creds" : "/tmp/creds",
          GALION_LLM_KEY: ENV_KEY,
        },
        read,
      );
      assert.deepEqual(reads, [], file);
      assert.equal(cfg.key, ENV_KEY, file);
    }
  });

  it("falls back when the file is unreadable, missing, not a file, or oversize", () => {
    let escaped = "";
    try {
      const cfg = configFromEnv(
        { GALION_LLM_KEY_FILE: "/x/.env", GALION_LLM_KEY_NAME: "API_SERVER_KEY", GALION_LLM_KEY: ENV_KEY },
        () => {
          throw new Error(`EACCES ${SECRET}`);
        },
      );
      assert.equal(cfg.key, ENV_KEY);
      assert.equal(inspect(cfg).includes(SECRET), false);
    } catch (err) {
      escaped = err instanceof Error ? err.message : String(err);
    }
    assert.equal(escaped.includes(SECRET), false);

    const dir = mkdtempSync(path.join(tmpdir(), "hermes-key-"));
    try {
      assert.equal(readKeyFile(""), "");
      assert.equal(readKeyFile(path.join(dir, "missing.env")), "");
      assert.equal(readKeyFile(dir), "");
      const big = path.join(dir, "big.env");
      writeFileSync(big, Buffer.alloc(64 * 1024 + 1, 0x61));
      assert.equal(readKeyFile(big), "");
      const oversize = configFromEnv({
        GALION_LLM_KEY_FILE: big,
        GALION_LLM_KEY_NAME: "API_SERVER_KEY",
        GALION_LLM_KEY: `  ${ENV_KEY}  `,
      });
      assert.equal(oversize.key, ENV_KEY);
      assert.equal(inspect(oversize).includes(SECRET), false);

      const exact = path.join(dir, "exact.env");
      const body = Buffer.alloc(64 * 1024);
      Buffer.from(`API_SERVER_KEY=${SECRET}\n`).copy(body);
      writeFileSync(exact, body, { mode: 0o600 });
      assert.equal(readKeyFile(exact).includes(SECRET), true);
      assert.equal(
        configFromEnv({
          GALION_LLM_KEY_FILE: exact,
          GALION_LLM_KEY_NAME: "API_SERVER_KEY",
          GALION_LLM_KEY: ENV_KEY,
        }).key,
        SECRET,
      );

      if (typeof process.getuid === "function" && process.getuid() !== 0) {
        chmodSync(exact, 0);
        assert.equal(readKeyFile(exact), "");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends the file key as bearer and keeps it out of status and ask bodies", async () => {
    const stub = await stubHermes({ content: "The wash is amber." });
    const dir = mkdtempSync(path.join(tmpdir(), "hermes-key-"));
    const file = path.join(dir, "hermes.env");
    writeFileSync(file, FILE, { mode: 0o600 });
    const server = await start({
      env: {
        GALION_LLM: "hermes",
        GALION_LLM_URL: stub.url,
        GALION_LLM_KEY_FILE: file,
        GALION_LLM_KEY_NAME: "API_SERVER_KEY",
        GALION_LLM_KEY: ENV_KEY,
        GALION_LLM_TIMEOUT_MS: "1000",
      },
      port: 0,
    });
    try {
      const cfg = configFromEnv(
        {
          GALION_LLM_URL: stub.url,
          GALION_LLM_KEY_FILE: "/x/.env",
          GALION_LLM_KEY_NAME: "API_SERVER_KEY",
        },
        (filePath) => (filePath === "/x/.env" ? FILE : ""),
      );
      const turn = await researchTurn(cfg, "What colour is the wash?");
      assert.equal(turn.text, "The wash is amber.");
      assert.equal(turn.text.includes(SECRET), false);
      assert.equal(stub.calls[0].authorization, `Bearer ${SECRET}`);
      assert.equal(stub.calls[0].body.includes(SECRET), false);
      assert.equal(inspect(cfg).includes(SECRET), false);

      const base = `http://127.0.0.1:${server.address().port}`;
      const health = await (await fetch(`${base}/health`)).json();
      assert.equal(health.ok, true);
      assert.equal(JSON.stringify(health).includes(SECRET), false);
      const status = await (await fetch(`${base}/research/hermes`)).json();
      assert.equal(status.key, "set");
      assert.equal(JSON.stringify(status).includes(SECRET), false);
      assert.equal(JSON.stringify(status).includes(ENV_KEY), false);
      const asked = await (
        await fetch(`${base}/research/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: "What colour is the wash?" }),
        })
      ).json();
      assert.equal(JSON.stringify(asked).includes(SECRET), false);
      assert.equal(JSON.stringify(asked).includes(ENV_KEY), false);
      assert.equal(asked.reply.includes(SECRET), false);
      assert.equal(stub.calls.at(-1).authorization, `Bearer ${SECRET}`);
      assert.equal(stub.calls.at(-1).body.includes(SECRET), false);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await stub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
