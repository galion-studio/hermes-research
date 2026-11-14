#!/usr/bin/env node
// Loopback health check for Galion Research.
// Does not start the server. Opens a socket only to 127.0.0.1. --execute is refused.

const args = process.argv.slice(2);

if (args.includes("--execute")) {
  console.error("refusing: this check does not deploy");
  process.exit(2);
}

if (args.length > 1) {
  console.error("refusing: only a port is accepted");
  process.exit(2);
}

const raw = args[0] ?? "8787";
if (!/^[0-9]+$/.test(raw)) {
  console.error("refusing: port");
  process.exit(2);
}

const port = Number(raw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("refusing: port");
  process.exit(2);
}

const url = `http://127.0.0.1:${port}/health`;

try {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(2_000) });
  const text = await response.text();
  if (response.status !== 200) {
    console.error(`health ${response.status}`);
    process.exit(1);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error("health body");
    process.exit(1);
  }
  if (body.ok !== true || body.service !== "galion-research" || body.bind !== "127.0.0.1") {
    console.error("health body");
    process.exit(1);
  }
  console.log(`ok ${url}`);
} catch {
  console.error("health unreachable");
  process.exit(1);
}
