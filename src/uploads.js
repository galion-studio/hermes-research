// Handed files for the research turn.
// Any name, including a dotfile. No type allowlist and no size limit.
// Bytes are streamed to a directory outside this repo. The prefix length is the knob.

import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const EXCERPT_BYTES = 1024;
export const QUESTION_PART_CAP = 8_192;
export const UPLOAD_FORM = "The upload was not a form.";
export const UPLOAD_NAME = "The file name was not kept.";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function uploadDir(env = process.env) {
  const fallback = join(tmpdir(), "galion-research-uploads");
  const raw = String(env.GALION_UPLOAD_DIR || "").trim();
  if (!raw) return fallback;
  const dir = resolve(raw);
  const rel = relative(REPO_ROOT, dir);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return fallback;
  return dir;
}

export function keepName(raw) {
  const base = String(raw ?? "").replace(/\\/g, "/").split("/").pop();
  if (base == null) return null;
  let clean = "";
  for (const ch of base) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) clean += ch;
  }
  if (!clean || clean === "." || clean === "..") return null;
  return clean;
}

function boundaryOf(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ""));
  if (!match) return null;
  const boundary = (match[1] || match[2] || "").trim();
  if (!boundary || boundary.length > 200) return null;
  return boundary;
}

function indexOf(buf, needle) {
  return buf.indexOf(needle);
}

function fileNameFrom(header) {
  const star = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^\r\n;]+)/i.exec(header);
  if (star) {
    try {
      return keepName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")));
    } catch {
      return null;
    }
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted) return keepName(quoted[1]);
  const plain = /filename\s*=\s*([^;\r\n]+)/i.exec(header);
  if (plain) return keepName(plain[1].trim().replace(/^"|"$/g, ""));
  return null;
}

function fieldName(header) {
  const match = /name\s*=\s*"([^"]*)"/i.exec(header) || /name\s*=\s*([^;\r\n]+)/i.exec(header);
  return match ? match[1].trim().replace(/^"|"$/g, "") : "";
}

async function readPrefix(disk) {
  const fh = await open(disk, "r");
  try {
    const buf = Buffer.alloc(EXCERPT_BYTES);
    const { bytesRead } = await fh.read(buf, 0, EXCERPT_BYTES, 0);
    const slice = buf.subarray(0, bytesRead);
    if (slice.includes(0)) return "";
    return slice.toString("utf8");
  } finally {
    await fh.close();
  }
}

export async function parseMultipart(source, contentType, dir) {
  const boundary = boundaryOf(contentType);
  if (!boundary) {
    const error = new Error("form");
    error.code = 400;
    error.reason = "form";
    throw error;
  }
  await mkdir(dir, { recursive: true });
  const delim = Buffer.from(`\r\n--${boundary}`);
  const first = Buffer.from(`--${boundary}`);
  let pending = Buffer.alloc(0);
  let peak = 0;
  let mode = "first";
  let file = null;
  let question = "";
  let questionOverflow = false;
  let failed = null;
  const files = [];
  const written = [];

  function notePeak() {
    if (pending.length > peak) peak = pending.length;
  }

  async function discardAll() {
    if (file) {
      await new Promise((resolve) => file.stream.end(resolve));
      file = null;
    }
    await Promise.all(written.map((disk) => rm(disk, { force: true })));
  }

  async function closeFile() {
    if (!file) return;
    const current = file;
    file = null;
    await new Promise((resolve, reject) => {
      current.stream.once("error", reject);
      current.stream.end(resolve);
    });
    const excerpt = await readPrefix(current.disk);
    files.push({ name: current.name, bytes: current.bytes, id: current.id, excerpt });
  }

  async function openFile(name) {
    const id = randomBytes(16).toString("hex");
    const disk = join(dir, id);
    const stream = createWriteStream(disk, { flags: "wx" });
    stream.on("error", () => {});
    written.push(disk);
    file = { name, id, disk, stream, bytes: 0 };
  }

  async function writeBody(buf) {
    if (!buf.length) return;
    if (file) {
      file.bytes += buf.length;
      if (!file.stream.write(buf)) {
        await new Promise((resolve, reject) => {
          file.stream.once("drain", resolve);
          file.stream.once("error", reject);
        });
      }
      return;
    }
    if (questionOverflow) return;
    if (Buffer.byteLength(question) + buf.length > QUESTION_PART_CAP) {
      questionOverflow = true;
      question = "";
      return;
    }
    question += buf.toString("utf8");
  }

  async function openPart(raw) {
    const header = raw.replace(/^\r\n/, "");
    const name = fileNameFrom(header);
    if (/filename\s*=/i.test(header)) {
      if (!name) {
        failed = Object.assign(new Error("name"), { code: 400, reason: "name" });
        return;
      }
      await openFile(name);
      mode = "body";
      return;
    }
    if (fieldName(header) !== "question") {
      failed = Object.assign(new Error("form"), { code: 400, reason: "form" });
      return;
    }
    mode = "body";
  }

  async function drain() {
    for (;;) {
      if (failed) return;
      if (mode === "done") return;
      if (mode === "first") {
        const at = indexOf(pending, first);
        if (at < 0) {
          if (pending.length > first.length) pending = pending.subarray(pending.length - first.length);
          notePeak();
          return;
        }
        pending = pending.subarray(at + first.length);
        mode = "headers";
        notePeak();
        continue;
      }
      if (mode === "headers") {
        const sep = indexOf(pending, Buffer.from("\r\n\r\n"));
        if (sep < 0) {
          notePeak();
          return;
        }
        const raw = pending.subarray(0, sep).toString("utf8");
        pending = pending.subarray(sep + 4);
        await openPart(raw);
        notePeak();
        continue;
      }
      if (mode === "body") {
        const at = indexOf(pending, delim);
        if (at < 0) {
          const hold = delim.length - 1;
          if (pending.length > hold) {
            const take = pending.subarray(0, pending.length - hold);
            pending = pending.subarray(pending.length - hold);
            await writeBody(take);
          }
          notePeak();
          return;
        }
        await writeBody(pending.subarray(0, at));
        await closeFile();
        pending = pending.subarray(at + delim.length);
        mode = "after";
        notePeak();
        continue;
      }
      if (mode === "after") {
        if (pending.length < 2) {
          notePeak();
          return;
        }
        if (pending[0] === 45 && pending[1] === 45) {
          mode = "done";
          pending = Buffer.alloc(0);
          notePeak();
          return;
        }
        if (pending[0] === 13 && pending[1] === 10) pending = pending.subarray(2);
        mode = "headers";
        notePeak();
      }
    }
  }

  try {
    for await (const chunk of source) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
      notePeak();
      await drain();
      if (failed) break;
    }
    if (!failed) await drain();
    if (failed) {
      await discardAll();
      throw failed;
    }
    if (mode === "after" && pending.length >= 2 && pending[0] === 45 && pending[1] === 45) mode = "done";
    if (mode !== "done") {
      await discardAll();
      throw Object.assign(new Error("form"), { code: 400, reason: "form" });
    }
    if (questionOverflow) {
      await discardAll();
      throw Object.assign(new Error("question"), { code: 413, reason: "question" });
    }
    return { question, files, peak };
  } catch (err) {
    if (!failed) await discardAll();
    throw err;
  }
}

export async function removeUploads(files, dir) {
  await Promise.all((files || []).map((file) => rm(join(dir, file.id), { force: true })));
}

export function repoRoot() {
  return REPO_ROOT;
}

export function outsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  return rel.startsWith(`..${sep}`) || rel === "..";
}
