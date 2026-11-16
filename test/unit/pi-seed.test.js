import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHIVE_FILES,
  MAIN_TRAILER,
  NODE_VERSION,
  PAGE_READ,
  REPO_ROOT_LINE,
  ROOT,
  packSeed,
  scrub,
} from "../../scripts/pi-seed/lib.js";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function run(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts/pi-seed", script), ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

describe("pi seed", () => {
  it("refuses --execute", () => {
    for (const script of ["build.js", "pack.js", "smoke.js"]) {
      const refused = run(script, ["--execute"]);
      assert.equal(refused.status, 2, script);
      assert.match(refused.stderr, /refusing/);
    }
  });

  it("keeps the bundle anchors in the desk sources", () => {
    const server = readFileSync(path.join(ROOT, "src/server.js"), "utf8");
    const uploads = readFileSync(path.join(ROOT, "src/uploads.js"), "utf8");
    assert.ok(server.includes(PAGE_READ));
    assert.ok(server.includes(MAIN_TRAILER.trim()));
    assert.ok(uploads.includes(REPO_ROOT_LINE));
    assert.match(uploads, /No type allowlist and no size limit/);
  });

  it("pins the pi unit to loopback and the single executable", () => {
    const unit = readFileSync(path.join(ROOT, "deploy/systemd/galion-research-pi5.service"), "utf8");
    for (const line of [
      "127.0.0.1:8787",
      "Environment=PORT=8787",
      "ExecStart=/opt/galion/research/current/galion-research",
      "User=galion",
      "NoNewPrivileges=yes",
      "ProtectSystem=strict",
      "PrivateTmp=yes",
      "ProtectHome=yes",
      "IPAddressDeny=any",
      "IPAddressAllow=localhost",
      "MemoryMax=256M",
      "Restart=on-failure",
    ]) {
      assert.ok(unit.includes(line), line);
    }
    assert.equal(unit.includes("GALION_LLM_KEY="), false);
    assert.equal(unit.includes("/usr/bin/node"), false);
  });

  it("builds both architectures under qemu-user and uploads the named archive", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/pi-seed.yml"), "utf8");
    assert.match(workflow, /qemu-user-static/);
    assert.match(workflow, /qemu-aarch64-static/);
    assert.match(workflow, /gcc-aarch64-linux-gnu/);
    assert.match(workflow, /scripts\/pi-seed\/smoke\.js/);
    assert.match(workflow, /scripts\/pi-seed\/build\.js/);
    assert.match(workflow, /upload-artifact@v4/);
    assert.match(workflow, /research-pi5-seed-/);
    assert.match(workflow, new RegExp(NODE_VERSION));
    assert.match(workflow, /if-no-files-found: error/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /actions: write/);
    assert.equal(workflow.includes("pull_request_target"), false);
    assert.equal(workflow.includes("GALION_LLM_KEY"), false);
    assert.equal(workflow.includes("--execute"), false);
    const doc = readFileSync(path.join(ROOT, "docs/PI5-SEED.md"), "utf8");
    assert.match(doc, /qemu-user/);
    assert.match(doc, /Raspberry Pi 5/);
    assert.match(doc, /was not confirmed by booting Bookworm on a Pi/);
    assert.match(doc, new RegExp(NODE_VERSION));
    assert.match(doc, /No type list and no size cap/);
    assert.match(doc, /127\.0\.0\.1:8787/);
  });

  it("packs LICENSE byte-for-byte and a checksum file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pi-seed-"));
    try {
      const from = path.join(dir, "from");
      const dest = path.join(dir, "dest");
      spawnSync("mkdir", ["-p", from, dest]);
      writeFileSync(path.join(from, "galion-research-linux-arm64"), "arm64-binary");
      writeFileSync(path.join(from, "galion-research-linux-x64"), "x64-binary");
      const { archive } = await packSeed({ from, destDir: dest, sha: SHA });
      assert.equal(path.basename(archive), `research-pi5-seed-${SHA}.tar.gz`);
      const extracted = path.join(dir, "out");
      spawnSync("mkdir", ["-p", extracted]);
      const unpacked = spawnSync("tar", ["-xf", archive, "-C", extracted], { encoding: "utf8" });
      assert.equal(unpacked.status, 0, unpacked.stderr);
      const names = spawnSync("tar", ["-tf", archive], { encoding: "utf8" });
      assert.deepEqual(names.stdout.trim().split("\n").sort(), [...ARCHIVE_FILES].sort());
      const packed = readFileSync(path.join(extracted, "LICENSE"));
      const canonical = readFileSync(path.join(ROOT, "LICENSE"));
      assert.ok(packed.equals(canonical));
      const unit = readFileSync(path.join(extracted, "galion-research-pi5.service"));
      assert.ok(unit.equals(readFileSync(path.join(ROOT, "deploy/systemd/galion-research-pi5.service"))));
      const checked = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: extracted, encoding: "utf8" });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scrubs a bearer token before a smoke log", () => {
    const cleaned = scrub("GALION_LLM_KEY=secret-value Authorization: Bearer abc.def");
    assert.equal(cleaned.includes("secret-value"), false);
    assert.equal(cleaned.includes("abc.def"), false);
  });
});
