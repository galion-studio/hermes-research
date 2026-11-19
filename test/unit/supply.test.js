import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildSbom } from "../../scripts/sbom.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function text(name) {
  return readFileSync(path.join(ROOT, name), "utf8");
}

function usesLines(workflow) {
  return [...workflow.matchAll(/^\s*-?\s*uses:\s+(\S+)(?:\s+#\s*(\S+))?/gm)].map((match) => ({
    action: match[1],
    comment: match[2] || "",
  }));
}

describe("supply chain", () => {
  it("pins third-party actions to a commit and installs from the lockfile", () => {
    const dependabot = text(".github/dependabot.yml");
    for (const block of dependabot.split(/\n(?=  - package-ecosystem:)/)) {
      if (!block.includes("package-ecosystem:")) continue;
      assert.match(block, /groups:/);
      assert.match(block, /patterns:\n\s+- /);
    }
    assert.match(dependabot, /package-ecosystem: npm/);
    assert.match(dependabot, /package-ecosystem: github-actions/);
    assert.match(dependabot, /directory: "\/"/);
    assert.match(dependabot, /directory: "\/e2e"/);

    for (const file of [".github/workflows/ci.yml", ".github/workflows/pi-seed.yml"]) {
      const workflow = text(file);
      assert.equal(workflow.includes("npm install"), false, file);
      assert.match(workflow, /npm ci/);
      const uses = usesLines(workflow);
      assert.ok(uses.length > 0, file);
      for (const row of uses) {
        assert.match(row.action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/, row.action);
        assert.match(row.comment, /^v\d+\.\d+\.\d+$/, `${file} ${row.action}`);
      }
    }

    const ci = text(".github/workflows/ci.yml");
    assert.match(ci, /galion-research-sbom/);
    assert.match(ci, /build\/sbom\/galion-research\.spdx\.json/);
    assert.match(ci, /if-no-files-found: error/);
    assert.match(ci, /compression-level: 0/);
    assert.match(ci, /no file-type filter and no size cap/);
    assert.equal(ci.includes("pull_request_target"), false);
  });

  it("records every locked package in the sbom", () => {
    const doc = buildSbom(ROOT, {
      created: "2026-11-19T00:00:00Z",
      namespace: "https://github.com/galion-studio/hermes-research/sbom/test",
    });
    assert.equal(doc.spdxVersion, "SPDX-2.3");
    assert.equal(doc.dataLicense, "CC0-1.0");
    assert.equal(doc.packages.some((pkg) => pkg.name === "galion-research" && pkg.versionInfo == null), true);
    for (const file of ["package-lock.json", "e2e/package-lock.json"]) {
      const lock = JSON.parse(text(file));
      for (const [key, meta] of Object.entries(lock.packages || {})) {
        if (!meta || typeof meta.version !== "string") continue;
        const name = key ? key.split("node_modules/").pop() : meta.name;
        const found = doc.packages.find((pkg) => pkg.name === name && pkg.versionInfo === meta.version);
        assert.ok(found, `${name}@${meta.version}`);
        if (typeof meta.integrity === "string" && meta.integrity.startsWith("sha512-")) {
          const hex = Buffer.from(meta.integrity.slice("sha512-".length), "base64").toString("hex");
          assert.equal(found.checksums[0].checksumValue, hex);
        }
      }
    }
    const described = doc.relationships.filter((row) => row.relationshipType === "DESCRIBES");
    assert.equal(described.length >= 2, true);
    assert.equal(doc.relationships.some((row) => row.relationshipType === "DEPENDS_ON"), true);
  });
});
