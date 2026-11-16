// Handed files for the research turn.
// Any name, including a dotfile. No type allowlist and no size limit.
// Bytes are streamed to a directory outside this repo. The prefix length is the knob.

import { closeSync, constants as fsConstants, createWriteStream, fchmodSync, openSync } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const EXCERPT_BYTES = 1024;
export const QUESTION_PART_CAP = 8_192;
export const PART_HEADER_CAP = 16 * 1024;
export const UPLOAD_FORM = "The upload was not a form.";
export const UPLOAD_NAME = "The file name was not kept.";

const FILE_FLAGS =
  fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0);
const DIR_FLAGS = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0);

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
  dir = await prepareUploadDir(dir);
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
    const stored = await lstat(current.disk);
    if (stored.isSymbolicLink()) throw formError();
    await chmod(current.disk, 0o600);
    const excerpt = await readPrefix(current.disk);
    files.push({ name: current.name, bytes: current.bytes, id: current.id, excerpt });
  }

  async function openFile(name) {
    const id = randomBytes(16).toString("hex");
    const disk = diskPath(dir, id);
    if (!disk) throw formError();
    const fd = openSync(disk, FILE_FLAGS, 0o600);
    const stream = createWriteStream("", { fd, autoClose: true });
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
        if (sep < 0 || sep > PART_HEADER_CAP) {
          notePeak();
          if (pending.length > PART_HEADER_CAP || sep > PART_HEADER_CAP) failed = formError();
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
  const root = resolve(dir);
  await Promise.all(
    (files || []).map((file) => {
      const disk = diskPath(root, file && file.id);
      return disk ? rm(disk, { force: true }) : Promise.resolve();
    }),
  );
}

export function repoRoot() {
  return REPO_ROOT;
}

export function outsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  return rel.startsWith(`..${sep}`) || rel === "..";
}

function formError() {
  return Object.assign(new Error("form"), { code: 400, reason: "form" });
}

function sharedRoot(dir) {
  const path = resolve(dir);
  const banned = [resolve("/"), resolve("/tmp"), resolve("/var/tmp"), resolve("/dev/shm"), resolve(tmpdir())];
  return banned.includes(path);
}

function diskPath(dir, id) {
  if (!/^[a-f0-9]{32}$/.test(String(id || ""))) return null;
  const root = resolve(dir);
  const disk = join(root, id);
  if (disk !== `${root}${sep}${id}`) return null;
  return disk;
}

async function ancestor(path) {
  let cursor = resolve(path);
  for (;;) {
    try {
      await lstat(cursor);
      return cursor;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      const parent = dirname(cursor);
      if (parent === cursor) return null;
      cursor = parent;
    }
  }
}

export async function prepareUploadDir(dir) {
  const root = resolve(dir);
  if (!root || sharedRoot(root) || !outsideRepo(root)) throw formError();
  const found = await ancestor(root);
  if (!found) throw formError();
  const foundStat = await lstat(found);
  if (foundStat.isSymbolicLink() || !foundStat.isDirectory()) throw formError();
  if ((await realpath(found)) !== resolve(found)) throw formError();
  if (found !== root) await mkdir(root, { recursive: true, mode: 0o700 });
  const st = await lstat(root);
  if (st.isSymbolicLink() || !st.isDirectory()) throw formError();
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw formError();
  if ((await realpath(root)) !== root) throw formError();
  if (basename(root) === "" || basename(root) === ".." || sharedRoot(root)) throw formError();
  const fd = openSync(root, DIR_FLAGS);
  try {
    fchmodSync(fd, 0o700);
  } finally {
    closeSync(fd);
  }
  return root;
}
