#!/usr/bin/env node
// Cold start and resident memory for one Galion Research process.
// Prints only values this run measured. A GitHub-hosted runner is not a Pi 5.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "src", "server.js");
const RUNS = 5;

if (process.platform !== "linux") {
  console.error("measure-start reads VmRSS from /proc");
  process.exit(2);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function vmRssKb(pid) {
  const text = readFileSync(`/proc/${pid}/status`, "utf8");
  const line = text.split("\n").find((row) => row.startsWith("VmRSS:"));
  if (!line) throw new Error("VmRSS");
  const kb = Number(line.trim().split(/\s+/)[1]);
  if (!Number.isInteger(kb)) throw new Error("VmRSS");
  return kb;
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function once() {
  const port = await freePort();
  const started = process.hrtime.bigint();
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { PATH: process.env.PATH || "", PORT: String(port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 10_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(stderr.slice(0, 240) || "server exited");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!healthy) {
    child.kill("SIGKILL");
    throw new Error(stderr.slice(0, 240) || "health");
  }
  const coldNs = process.hrtime.bigint() - started;
  const rss = vmRssKb(child.pid);
  await stop(child);
  return { cold_start_ms: Number(coldNs) / 1e6, rss_kb: rss };
}

const rows = [];
for (let i = 1; i <= RUNS; i += 1) {
  const row = await once();
  rows.push(row);
  console.log(`run ${i} cold_start_ms ${row.cold_start_ms.toFixed(1)} rss_vmrss_kb ${row.rss_kb}`);
}
const cold = rows.map((row) => row.cold_start_ms);
const rss = rows.map((row) => row.rss_kb);
console.log(`min_cold_start_ms ${Math.min(...cold).toFixed(1)}`);
console.log(`min_rss_vmrss_kb ${Math.min(...rss)}`);
