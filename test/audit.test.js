import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function audit(cwd) {
  const run = spawnSync("npm", ["audit", "--json", "--audit-level=high"], { cwd, encoding: "utf8" });
  let report = null;
  try {
    report = JSON.parse(run.stdout || "");
  } catch {
    report = null;
  }
  return { status: run.status, report, stderr: run.stderr || "" };
}

describe("npm audit", () => {
  for (const dir of [ROOT, path.join(ROOT, "e2e")]) {
    it(`reports no high or critical advisories in ${path.basename(dir) === "e2e" ? "e2e" : "the app"}`, () => {
      const { status, report, stderr } = audit(dir);
      assert.ok(report && report.metadata && report.metadata.vulnerabilities, stderr.slice(0, 500));
      const counts = report.metadata.vulnerabilities;
      console.log(
        `npm audit ${dir === ROOT ? "app" : "e2e"} exit=${status} info=${counts.info} low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical} total=${counts.total}`,
      );
      assert.equal(counts.critical, 0);
      assert.equal(counts.high, 0);
      assert.equal(status, 0);
    });
  }
});
