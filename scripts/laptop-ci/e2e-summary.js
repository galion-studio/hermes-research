// Reads the TAP file from the e2e harness and prints one honest summary line.
// A todo test is an expected failure (xfail). If it starts passing it is an
// xpass: the fix it waits for has landed and the todo mark can come off.
// Usage: node scripts/laptop-ci/e2e-summary.js <file.tap> [summary.json]

import { readFileSync, writeFileSync } from "node:fs";

const [tapFile, jsonFile] = process.argv.slice(2);
if (!tapFile) {
  console.error("usage: e2e-summary.js <file.tap> [summary.json]");
  process.exit(2);
}

let tap = "";
try {
  tap = readFileSync(tapFile, "utf8");
} catch {
  console.log("e2e summary: no TAP output (the run did not start)");
  process.exit(1);
}

const out = { pass: 0, fail: 0, skip: 0, xfail: [], xpass: [], failed: [] };
for (const line of tap.split(/\r?\n/)) {
  const m = /^\s*(not ok|ok) \d+ - (.*?)(?: # (TODO|SKIP)\b.*)?$/.exec(line);
  if (!m) continue;
  const [, verdict, name, directive] = m;
  // Suites show up as top-level lines too; only count leaf tests (indented).
  if (!/^\s+/.test(line)) continue;
  if (directive === "TODO") (verdict === "ok" ? out.xpass : out.xfail).push(name);
  else if (directive === "SKIP") out.skip += 1;
  else if (verdict === "ok") out.pass += 1;
  else {
    out.fail += 1;
    out.failed.push(name);
  }
}

console.log(
  `e2e summary: pass ${out.pass}, fail ${out.fail}, xfail ${out.xfail.length}, xpass ${out.xpass.length}, skip ${out.skip}`,
);
for (const name of out.failed) console.log(`  FAIL  ${name}`);
for (const name of out.xfail) console.log(`  XFAIL ${name}`);
for (const name of out.xpass) console.log(`  XPASS ${name} (the todo mark can come off)`);
if (jsonFile) writeFileSync(jsonFile, `${JSON.stringify(out, null, 2)}\n`);
process.exit(out.fail ? 1 : 0);
