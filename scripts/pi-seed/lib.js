// Shared pieces for the Pi 5 seed. No network. No deploy.

import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const NODE_VERSION = "22.23.4";
export const ESBUILD_VERSION = "0.25.5";
export const POSTJECT_VERSION = "1.0.0-alpha.6";
export const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

// Official nodejs.org SHASUMS256.txt for v22.23.4. The build checks the bytes it downloaded.
export const NODE_TARBALL_SHA256 = Object.freeze({
  arm64: "6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b",
  x64: "1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce",
});

export const PAGE_READ =
  'readFileSync(fileURLToPath(new URL("../public/research.html", import.meta.url)))';

export const REPO_ROOT_LINE =
  'const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));';

// SEA's injected script sets __filename to the executable. Uploads stay outside that directory.
export const REPO_ROOT_BUNDLE =
  'const REPO_ROOT = resolve(typeof __filename === "string" ? __filename : process.execPath, "..");';

export const MAIN_TRAILER = `const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  start().then((server) => {
    const address = server.address();
    console.log(\`Galion Research http://\${address.address}:\${address.port}/research\`);
  });
}
`;

export const BIN_ARM64 = "galion-research-linux-arm64";
export const BIN_X64 = "galion-research-linux-x64";
export const UNIT_NAME = "galion-research-pi5.service";
export const SUMS_NAME = "SHA256SUMS";

export const ARCHIVE_FILES = Object.freeze([BIN_ARM64, BIN_X64, UNIT_NAME, "LICENSE", SUMS_NAME]);

export function artifactName(sha) {
  return `research-pi5-seed-${sha}.tar.gz`;
}

export function refuseExecute(argv) {
  if (argv.includes("--execute")) {
    console.error("refusing: this does not deploy");
    process.exit(2);
  }
}

export function scrub(text) {
  return String(text)
    .replace(/GALION_LLM_KEY=\S+/g, "GALION_LLM_KEY=redacted")
    .replace(/Bearer\s+\S+/gi, "Bearer redacted")
    .replace(/Authorization:\s*\S+/gi, "Authorization: redacted");
}

export function assertSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha || ""))) {
    const error = new Error("sha");
    error.exit = 2;
    throw error;
  }
  return sha;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(file) {
  return sha256(await readFile(file));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.stdio || "inherit", env: options.env });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) resolve();
      else {
        const error = new Error(`${command} exited ${status}`);
        error.exit = status || 1;
        reject(error);
      }
    });
  });
}

export async function packSeed({ from, destDir, sha, root = ROOT }) {
  const id = assertSha(sha);
  const stage = path.join(destDir, `stage-${id}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const sources = [
    [path.join(from, BIN_ARM64), BIN_ARM64, 0o755],
    [path.join(from, BIN_X64), BIN_X64, 0o755],
    [path.join(root, "deploy/systemd", UNIT_NAME), UNIT_NAME, 0o644],
    [path.join(root, "LICENSE"), "LICENSE", 0o644],
  ];

  const canonical = await readFile(path.join(root, "LICENSE"));
  for (const [src, name, mode] of sources) {
    const info = await stat(src);
    if (!info.isFile() || info.size === 0) {
      throw Object.assign(new Error(`missing ${name}`), { exit: 1 });
    }
    const dest = path.join(stage, name);
    await copyFile(src, dest);
    if (name === "LICENSE" && !(await readFile(dest)).equals(canonical)) {
      throw Object.assign(new Error("LICENSE bytes differ"), { exit: 1 });
    }
    await chmod(dest, mode);
  }

  const lines = [];
  for (const name of [BIN_ARM64, BIN_X64, UNIT_NAME, "LICENSE"]) {
    const digest = await sha256File(path.join(stage, name));
    lines.push(`${digest}  ${name}`);
  }
  const sums = `${lines.join("\n")}\n`;
  await writeFile(path.join(stage, SUMS_NAME), sums, { mode: 0o644 });

  const archive = path.join(destDir, artifactName(id));
  await mkdir(destDir, { recursive: true });
  await run("tar", [
    "--sort=name",
    "--mtime=2026-01-01T00:00:00Z",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--use-compress-program=gzip -n -c",
    "-cf",
    archive,
    "-C",
    stage,
    ...ARCHIVE_FILES,
  ]);
  await rm(stage, { recursive: true, force: true });
  return { archive, sums };
}
