#!/usr/bin/env node
// Pack the Pi 5 seed archive. Copies LICENSE byte-for-byte. Does not deploy.
// --execute is refused.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, packSeed, refuseExecute } from "./lib.js";

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    console.error("refusing: sha");
    process.exit(2);
  }
  return result.stdout.trim();
}

function parse(argv) {
  const out = {
    sha: "",
    from: path.join(ROOT, "build/pi-seed/out"),
    destDir: path.join(ROOT, "build/pi-seed"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sha") out.sha = argv[++i] || "";
    else if (arg === "--from") out.from = argv[++i] || "";
    else if (arg === "--dest-dir") out.destDir = argv[++i] || "";
    else {
      console.error("refusing: argument");
      process.exit(2);
    }
    if (!out.sha && arg === "--sha") {
      console.error("refusing: sha");
      process.exit(2);
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  refuseExecute(argv);
  const args = parse(argv);
  const sha = args.sha || gitSha();
  try {
    const { archive } = await packSeed({ from: args.from, destDir: args.destDir, sha });
    console.log(archive);
  } catch (err) {
    console.error(`refusing: ${err && err.message ? err.message : "pack"}`);
    process.exit(err && err.exit ? err.exit : 1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
