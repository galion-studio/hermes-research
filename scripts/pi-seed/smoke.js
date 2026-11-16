#!/usr/bin/env node
// Start a seed binary on 127.0.0.1 and check /health, the first-run screen, and an offline answer.
// qemu-user is optional (--qemu and --sysroot). That run is an emulator. It is not a Raspberry Pi 5 result.
// Does not deploy. --execute is refused.

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, refuseExecute, scrub } from "./lib.js";

function fail(message, logs = "") {
  const text = scrub(logs).slice(-4000);
  if (text) console.error(text);
  console.error(scrub(message));
  process.exit(1);
}

function take(argv, index) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    console.error("refusing: argument");
    process.exit(2);
  }
  return value;
}

function parse(argv) {
  const out = { binary: "", qemu: "", sysroot: "", timeout: 60 };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--qemu") {
      out.qemu = take(argv, i);
      i += 1;
    } else if (arg === "--sysroot") {
      out.sysroot = take(argv, i);
      i += 1;
    } else if (arg === "--timeout") {
      out.timeout = Number(take(argv, i));
      i += 1;
    } else if (arg.startsWith("-")) {
      console.error("refusing: argument");
      process.exit(2);
    } else positionals.push(arg);
  }
  if (positionals.length !== 1 || Boolean(out.qemu) !== Boolean(out.sysroot)) {
    console.error("refusing: argument");
    process.exit(2);
  }
  if (!Number.isInteger(out.timeout) || out.timeout < 1 || out.timeout > 180) {
    console.error("refusing: timeout");
    process.exit(2);
  }
  out.binary = positionals[0];
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    child.once("close", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  refuseExecute(argv);
  const args = parse(argv);
  const port = await freePort();
  const command = args.qemu ? [args.qemu, "-L", args.sysroot, args.binary] : [args.binary];
  const env = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "/tmp",
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: "C.UTF-8",
    PORT: String(port),
  };
  let stdout = "";
  let stderr = "";
  const child = spawn(command[0], command.slice(1), {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk.toString("utf8")).slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-8000);
  });

  const logs = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
  const deadline = Date.now() + args.timeout * 1000;
  try {
    let healthy = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) fail("seed exited before health", logs());
      healthy = await runNode([path.join(ROOT, "scripts/check-health.js"), String(port)]);
      if (healthy.status === 0) break;
      healthy = null;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!healthy) fail("health unreachable", logs());
    process.stdout.write(healthy.stdout);

    const page = await fetch(`http://127.0.0.1:${port}/research`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const html = await page.text();
    if (page.status !== 200 || !html.includes("<title>Galion Research</title>")) fail("desk page", logs());
    if (!html.includes('id="first-run"') || !html.includes("<h1>What are we looking into?</h1>") || !html.includes("A question starts here.")) {
      fail("first-run", logs());
    }
    console.log("desk 200");
    console.log("first-run present");

    const asked = await fetch(`http://127.0.0.1:${port}/research/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What does Ultra cost?" }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const body = await asked.json();
    const serialized = JSON.stringify(body);
    if (asked.status !== 200 || body.status !== "Offline" || !Array.isArray(body.citations) || body.citations.length !== 0) {
      fail("offline ask", logs());
    }
    if (serialized.includes("GALION_LLM_KEY") || /Bearer\s+\S+/.test(serialized)) fail("offline ask", logs());
    console.log("ask Offline");
  } finally {
    await stop(child);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => fail(err && err.message ? err.message : "smoke failed"));
}
