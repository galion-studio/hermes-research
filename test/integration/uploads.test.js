import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { start } from "../../src/server.js";
import { outsideRepo } from "../../src/uploads.js";

const LARGE = 1024 * 1024;

function postForm(base, { question, files }) {
  const boundary = "galionintegration";
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
        resolve({ status: res.statusCode, data, text });
      },
    );
    req.on("error", reject);
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="question"\r\n\r\n${question}\r\n`);
    for (const file of files) {
      req.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );
      const step = 64 * 1024;
      for (let i = 0; i < file.body.length; i += step) req.write(file.body.subarray(i, i + step));
      req.write("\r\n");
    }
    req.end(`--${boundary}--\r\n`);
  });
}

describe("streamed uploads", () => {
  it("accepts a dotfile and a large file on loopback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "galion-upload-http-"));
    assert.equal(outsideRepo(dir), true);
    const server = await start({ env: { GALION_UPLOAD_DIR: dir }, port: 0 });
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const dot = await postForm(base, {
        question: "What is in the file?",
        files: [{ name: ".notes", body: Buffer.from("dotfile-marker\n") }],
      });
      assert.equal(dot.status, 200);
      assert.equal(dot.data.status, "Offline");
      assert.deepEqual(dot.data.citations, []);
      assert.match(dot.data.reply, /\.notes/);
      assert.match(dot.data.reply, /dotfile-marker/);
      assert.equal(dot.data.sources.some((source) => source.label === "File" && source.text === ".notes"), true);
      assert.equal(dot.data.sources.some((source) => source.label === "Citation"), false);

      const body = Buffer.alloc(LARGE, 0x41);
      body.write("LARGE-START\n");
      const large = await postForm(base, {
        question: "How big is the file?",
        files: [{ name: "large.bin", body }],
      });
      assert.equal(large.status, 200);
      assert.notEqual(large.status, 413);
      assert.deepEqual(large.data.citations, []);
      assert.match(large.data.reply, /large\.bin/);
      assert.match(large.data.reply, /LARGE-START/);
      assert.ok(large.text.length < LARGE / 2);
      const names = await readdir(dir);
      const sizes = await Promise.all(names.map((name) => stat(join(dir, name)).then((row) => row.size)));
      assert.equal(sizes.includes(LARGE), true);
      assert.equal(sizes.includes(Buffer.byteLength("dotfile-marker\n")), true);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
