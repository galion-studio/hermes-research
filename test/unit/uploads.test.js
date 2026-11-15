import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { keepName, outsideRepo, parseMultipart, repoRoot, uploadDir } from "../../src/uploads.js";

function form(question, name, body) {
  const boundary = "galionform";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="question"\r\n\r\n${question}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([head, body, tail]),
  };
}

async function* bytes(body, size) {
  for (let i = 0; i < body.length; i += size) yield body.subarray(i, Math.min(body.length, i + size));
}

describe("upload names", () => {
  it("keeps a dotfile and drops a path", () => {
    assert.equal(keepName(".notes"), ".notes");
    assert.equal(keepName("../.secret"), ".secret");
    assert.equal(keepName(".."), null);
    assert.equal(keepName("."), null);
  });

  it("does not point the store at this repo", () => {
    const inside = uploadDir({ GALION_UPLOAD_DIR: join(repoRoot(), "uploads") });
    assert.equal(outsideRepo(inside), true);
    const outside = uploadDir({ GALION_UPLOAD_DIR: join(tmpdir(), "galion-upload-outside") });
    assert.equal(outsideRepo(outside), true);
    assert.equal(outside.endsWith("galion-upload-outside"), true);
  });
});

describe("multipart stream", () => {
  it("reads a dotfile in one-byte chunks without holding the body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "galion-upload-unit-"));
    try {
      const payload = Buffer.from("dotfile-marker");
      const packed = form("What is in the file?", ".notes", payload);
      const parsed = await parseMultipart(bytes(packed.body, 1), packed.type, dir);
      assert.equal(parsed.question, "What is in the file?");
      assert.equal(parsed.files.length, 1);
      assert.equal(parsed.files[0].name, ".notes");
      assert.equal(parsed.files[0].bytes, payload.length);
      assert.equal(parsed.files[0].excerpt, "dotfile-marker");
      assert.ok(parsed.peak < 8 * 1024, `peak ${parsed.peak}`);
      assert.equal(outsideRepo(dir), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
