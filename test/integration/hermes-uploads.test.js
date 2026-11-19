// Bug: since #20 a handed file lived only in the desk's private store and Hermes
// saw at most a 1 KiB excerpt squeezed into a 2000-character question.
// Fix: the desk reads its own file back and hands Hermes the text, never a path.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { start } from "../../src/server.js";
import { stubHermes } from "../stub-hermes.js";

function postForm(base, { question, files }) {
  const boundary = "galionhermesupload";
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
        resolve({ status: res.statusCode, data: JSON.parse(text), text });
      },
    );
    req.on("error", reject);
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="question"\r\n\r\n${question}\r\n`);
    for (const file of files) {
      req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n\r\n`);
      req.write(file.body);
      req.write("\r\n");
    }
    req.end(`--${boundary}--\r\n`);
  });
}

describe("Hermes reads handed files", () => {
  it("hands Hermes the file text past the excerpt, with no path or id, and keeps the store private", async () => {
    const root = await mkdtemp(join(tmpdir(), "galion-hermes-upload-"));
    const dir = join(root, "uploads");
    const stub = await stubHermes({ content: "Found:\n- The file names the marker." });
    const server = await start({
      env: {
        GALION_UPLOAD_DIR: dir,
        GALION_LLM: "hermes",
        GALION_LLM_URL: stub.url,
        GALION_LLM_MODEL: "hermes-agent",
        GALION_LLM_TIMEOUT_MS: "2000",
      },
      port: 0,
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const body = Buffer.from(`${"filler line\n".repeat(600)}DEEP-MARKER-7f3\n${"tail\n".repeat(50)}END-MARKER\n`);
      const res = await postForm(base, {
        question: "Which marker is in the file?",
        files: [
          { name: "report.txt", body },
          { name: "blob.bin", body: Buffer.from([0x00, 0x01, 0x02, 0x53, 0x45, 0x43]) },
        ],
      });
      assert.equal(res.status, 200);
      assert.equal(stub.calls.length, 1);
      const sent = JSON.parse(stub.calls[0].body);
      const all = sent.messages.map((m) => m.content).join("\n");
      assert.match(all, /DEEP-MARKER-7f3/);
      assert.match(all, /END-MARKER/);
      assert.match(all, /report\.txt, \d+ bytes\./);
      assert.match(all, /blob\.bin, 6 bytes\. Binary file\./);
      assert.equal(sent.messages.at(-1).role, "user");
      assert.match(sent.messages.at(-1).content, /^Which marker is in the file\?/);
      assert.equal(sent.messages.at(-1).content.includes("filler line"), false);
      const names = await readdir(dir);
      assert.equal(names.length, 2);
      for (const id of names) {
        assert.match(id, /^[a-f0-9]{32}$/);
        assert.equal(stub.calls[0].body.includes(id), false);
        if (process.platform !== "win32") assert.equal((await stat(join(dir, id))).mode & 0o777, 0o600);
      }
      assert.equal(stub.calls[0].body.includes(dir), false);
      assert.equal(stub.calls[0].body.includes(root), false);
      if (process.platform !== "win32") assert.equal((await stat(dir)).mode & 0o777, 0o700);
      assert.equal(res.data.status, "Returned");
      assert.equal(res.text.includes("DEEP-MARKER-7f3"), false);
      assert.equal(res.data.sources.some((s) => s.label === "File" && s.text === "report.txt"), true);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await stub.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("asks a question with no file exactly as before", async () => {
    const root = await mkdtemp(join(tmpdir(), "galion-hermes-upload-"));
    const stub = await stubHermes({ content: "Found:\n- ok" });
    const server = await start({
      env: { GALION_UPLOAD_DIR: join(root, "u"), GALION_LLM: "hermes", GALION_LLM_URL: stub.url, GALION_LLM_TIMEOUT_MS: "2000" },
      port: 0,
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const res = await postForm(base, { question: "Plain question?", files: [] });
      assert.equal(res.status, 200);
      const sent = JSON.parse(stub.calls[0].body);
      assert.equal(sent.messages.length, 2);
      assert.equal(sent.messages[1].content, "Plain question?");
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await stub.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
