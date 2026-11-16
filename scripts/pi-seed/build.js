#!/usr/bin/env node
// Build the Galion Research single executable for linux-arm64 and linux-x64.
// Downloads the official Node tarballs, bundles this repo, injects a SEA blob.
// Does not deploy. --execute is refused.

import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile, copyFile, chmod } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BIN_ARM64,
  BIN_X64,
  ESBUILD_VERSION,
  MAIN_TRAILER,
  NODE_TARBALL_SHA256,
  NODE_VERSION,
  PAGE_READ,
  POSTJECT_VERSION,
  REPO_ROOT_BUNDLE,
  REPO_ROOT_LINE,
  ROOT,
  SEA_FUSE,
  scrub,
  sha256File,
} from "./lib.js";

const OUT = path.join(ROOT, "build/pi-seed/out");
const CACHE = path.join(ROOT, "build/pi-seed/cache");
const WORK = path.join(ROOT, "build/pi-seed/work");
const TOOLS = path.join(ROOT, "build/pi-seed/tools");

function die(message, code = 1) {
  console.error(scrub(message));
  process.exit(code);
}

function mustReplace(text, from, to, label) {
  if (!text.includes(from)) die(`refusing: ${label} moved; the seed bundle was not updated`);
  return text.replace(from, to);
}

async function downloadVerified(url, dest, expected) {
  await mkdir(path.dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) die(`download failed (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const digest = await sha256File(partial);
  if (digest !== expected) {
    await rm(partial, { force: true });
    die("refusing: node tarball checksum");
  }
  await rm(dest, { force: true });
  const fs = await import("node:fs/promises");
  await fs.rename(partial, dest);
}

function tarExtract(archive, dest) {
  const result = spawnSync("tar", ["-xJf", archive, "-C", dest, "--strip-components=1"], { stdio: "inherit" });
  if (result.status !== 0) die("refusing: tar extract");
}

function npmExec(pkg, args) {
  const result = spawnSync(
    "npm",
    ["--prefix", TOOLS, "exec", "--yes", "--loglevel=error", "--package", pkg, "--", ...args],
    { cwd: TOOLS, stdio: "inherit", env: { ...process.env, NO_COLOR: "1" } },
  );
  if (result.status !== 0) die(`refusing: ${pkg.split("@")[0]}`);
}

async function nodeTree(arch) {
  const name = `node-v${NODE_VERSION}-linux-${arch}.tar.xz`;
  const archive = path.join(CACHE, name);
  const tree = path.join(CACHE, `node-v${NODE_VERSION}-linux-${arch}`);
  const bin = path.join(tree, "bin/node");
  let digest = "";
  try {
    digest = await sha256File(archive);
  } catch {
    digest = "";
  }
  if (digest !== NODE_TARBALL_SHA256[arch]) {
    console.log(`fetch node v${NODE_VERSION} linux-${arch}`);
    await downloadVerified(`https://nodejs.org/dist/v${NODE_VERSION}/${name}`, archive, NODE_TARBALL_SHA256[arch]);
  } else {
    console.log(`node v${NODE_VERSION} linux-${arch} checksum ok`);
  }
  try {
    await access(bin);
  } catch {
    await rm(tree, { recursive: true, force: true });
    await mkdir(tree, { recursive: true });
    tarExtract(archive, tree);
  }
  return bin;
}

async function bundle() {
  await rm(WORK, { recursive: true, force: true });
  const src = path.join(WORK, "src");
  await mkdir(src, { recursive: true });
  const names = (await import("node:fs/promises")).readdir(path.join(ROOT, "src"));
  for (const name of (await names).filter((entry) => entry.endsWith(".js"))) {
    await copyFile(path.join(ROOT, "src", name), path.join(src, name));
  }

  const serverPath = path.join(src, "server.js");
  const html = await readFile(path.join(ROOT, "public/research.html"));
  const inlined = `Buffer.from(${JSON.stringify(html.toString("base64"))}, "base64")`;
  let server = await readFile(serverPath, "utf8");
  server = mustReplace(server, PAGE_READ, inlined, "page read");
  server = mustReplace(server, MAIN_TRAILER, "", "startup trailer");
  await writeFile(serverPath, server);

  const uploadsPath = path.join(src, "uploads.js");
  let uploads = await readFile(uploadsPath, "utf8");
  uploads = mustReplace(uploads, REPO_ROOT_LINE, REPO_ROOT_BUNDLE, "upload root");
  await writeFile(uploadsPath, uploads);

  const entry = `import { start } from "./server.js";

start()
  .then((server) => {
    const address = server.address();
    console.log(\`Galion Research http://\${address.address}:\${address.port}/research\`);
  })
  .catch(() => {
    console.error("Galion Research failed to listen");
    process.exit(1);
  });
`;
  await writeFile(path.join(src, "pi-main.js"), entry);

  await mkdir(TOOLS, { recursive: true });
  const outfile = path.join(WORK, "server.cjs");
  npmExec(`esbuild@${ESBUILD_VERSION}`, [
    "esbuild",
    path.join(src, "pi-main.js"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${outfile}`,
    "--log-level=warning",
  ]);
  const bundled = await readFile(outfile, "utf8");
  if (bundled.includes("import.meta")) die("refusing: bundle still references import.meta");
  console.log(`bundle ${bundled.length} bytes`);
  return outfile;
}

function assertElf(binary, needle) {
  const result = spawnSync("file", ["-b", binary], { encoding: "utf8" });
  if (result.status !== 0 || !String(result.stdout).includes(needle)) die("refusing: binary arch");
}

async function inject(nodeBin, blob, dest, needle) {
  await copyFile(nodeBin, dest);
  await chmod(dest, 0o755);
  npmExec(`postject@${POSTJECT_VERSION}`, [
    "postject",
    dest,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    SEA_FUSE,
  ]);
  await chmod(dest, 0o755);
  assertElf(dest, needle);
  const fused = await readFile(dest);
  if (!fused.includes(Buffer.from(`${SEA_FUSE}:1`))) die("refusing: sea fuse was not set");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--execute")) die("refusing: this does not deploy", 2);
  if (argv.some((arg) => arg !== "--bundle-only")) die("refusing: argument", 2);

  const outfile = await bundle();
  if (argv.includes("--bundle-only")) {
    console.log(outfile);
    return;
  }

  const x64 = await nodeTree("x64");
  const arm64 = await nodeTree("arm64");
  const config = path.join(WORK, "sea-config.json");
  const blob = path.join(WORK, "sea-prep.blob");
  await writeFile(
    config,
    JSON.stringify(
      {
        main: outfile,
        output: blob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  );
  const generated = spawnSync(x64, ["--experimental-sea-config", config], { stdio: "inherit" });
  if (generated.status !== 0) die("refusing: sea blob");

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await inject(arm64, blob, path.join(OUT, BIN_ARM64), "ARM aarch64");
  await inject(x64, blob, path.join(OUT, BIN_X64), "x86-64");
  console.log(`wrote ${BIN_ARM64}`);
  console.log(`wrote ${BIN_X64}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => die(err && err.message ? err.message : "seed build failed", err && err.exit ? err.exit : 1));
}
