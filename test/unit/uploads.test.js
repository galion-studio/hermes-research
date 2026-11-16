import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PART_HEADER_CAP, keepName, outsideRepo, parseMultipart, prepareUploadDir, repoRoot, uploadDir } from "../../src/uploads.js";

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
    assert.equal(keepName("../../etc/passwd"), "passwd");
    assert.equal(keepName("..\\..\\etc\\passwd"), "passwd");
    assert.equal(keepName("<img src=x onerror=alert(1)>.html"), "<img src=x onerror=alert(1)>.html");
    assert.equal(keepName(".."), null);
    assert.equal(keepName("."), null);
    assert.equal(keepName("foo\u0000bar"), "foobar");
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
      const stored = await stat(join(dir, parsed.files[0].id));
      assert.equal(stored.mode & 0o777, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores a traversal name only as the base name, under a random id", async () => {
    const parent = await mkdtemp(join(tmpdir(), "galion-upload-trav-"));
    const dir = join(parent, "store");
    await mkdir(dir);
    try {
      const packed = form("What path is this?", "../../etc/passwd", Buffer.from("not-a-password"));
      const parsed = await parseMultipart(bytes(packed.body, 64), packed.type, dir);
      assert.equal(parsed.files[0].name, "passwd");
      const names = await readdir(dir);
      assert.deepEqual(names, [parsed.files[0].id]);
      assert.match(parsed.files[0].id, /^[a-f0-9]{32}$/);
      assert.deepEqual(await readdir(parent), ["store"]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked store and a header that will not end", async () => {
    const parent = await mkdtemp(join(tmpdir(), "galion-upload-link-"));
    const real = join(parent, "real");
    const link = join(parent, "link");
    const via = join(parent, "via");
    const outside = join(parent, "outside");
    await mkdir(real);
    await mkdir(outside);
    await symlink(real, link);
    await symlink(outside, via);
    try {
      const packed = form("What is in the file?", ".notes", Buffer.from("dotfile-marker"));
      await assert.rejects(parseMultipart(bytes(packed.body, 32), packed.type, link), (err) => err.reason === "form");
      await assert.rejects(parseMultipart(bytes(packed.body, 32), packed.type, join(via, "child")), (err) => err.reason === "form");
      assert.deepEqual(await readdir(real), []);
      assert.deepEqual(await readdir(outside), []);
      await assert.rejects(prepareUploadDir(tmpdir()));

      const boundary = "galionform";
      const flood = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.alloc(PART_HEADER_CAP + 2048, 0x41),
      ]);
      const floodDir = join(parent, "flood");
      await mkdir(floodDir);
      await assert.rejects(
        parseMultipart(bytes(flood, 1024), `multipart/form-data; boundary=${boundary}`, floodDir),
        (err) => err.reason === "form",
      );
      assert.deepEqual(await readdir(floodDir), []);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
