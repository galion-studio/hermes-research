// SPDX 2.3 from the committed lockfiles. No network. The repository LICENSE is not this file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LOCKS = [
  { label: "app", file: "package-lock.json" },
  { label: "e2e", file: "e2e/package-lock.json" },
];

function packageName(key, meta) {
  if (!key) return meta && meta.name ? String(meta.name) : "";
  const parts = String(key).split("node_modules/");
  return parts[parts.length - 1];
}

function spdxId(label, index, name) {
  const safe = String(name).replace(/[^A-Za-z0-9.-]/g, "-").replace(/^-+|-+$/g, "") || "package";
  return `SPDXRef-${label}-${index}-${safe}`;
}

function sha512Hex(integrity) {
  const match = /^sha512-(.+)$/.exec(String(integrity || ""));
  if (!match) return null;
  return Buffer.from(match[1], "base64").toString("hex");
}

function loadLock(root, lock) {
  const parsed = JSON.parse(readFileSync(path.join(root, lock.file), "utf8"));
  const items = [];
  for (const [key, meta] of Object.entries(parsed.packages || {})) {
    const name = packageName(key, meta);
    if (!name || !meta || typeof meta !== "object") continue;
    const dependencies = { ...(meta.dependencies || {}), ...(meta.devDependencies || {}) };
    items.push({
      key,
      name,
      version: typeof meta.version === "string" ? meta.version : null,
      license: typeof meta.license === "string" ? meta.license : null,
      resolved: typeof meta.resolved === "string" && meta.resolved.startsWith("https://") ? meta.resolved : null,
      integrity: typeof meta.integrity === "string" ? meta.integrity : null,
      dependencies,
    });
  }
  return { label: lock.label, items };
}

function findDep(items, name) {
  return (
    items.find((item) => item.name === name && item.key === `node_modules/${name}`) ||
    items.find((item) => item.name === name && item.key !== "")
  );
}

export function buildSbom(root = ROOT, options = {}) {
  const created = options.created || new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(created)) {
    throw new Error("created");
  }
  const namespace =
    options.namespace ||
    `https://github.com/galion-studio/hermes-research/sbom/${process.env.GITHUB_SHA || "workspace"}`;
  const locks = LOCKS.map((lock) => loadLock(root, lock));
  const packages = [];
  const relationships = [];
  for (const lock of locks) {
    lock.items.forEach((item, index) => {
      item.id = spdxId(lock.label, index, item.name);
      const entry = {
        SPDXID: item.id,
        name: item.name,
        downloadLocation: item.resolved || "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: item.license || "NOASSERTION",
        copyrightText: "NOASSERTION",
      };
      if (item.version) entry.versionInfo = item.version;
      const checksum = sha512Hex(item.integrity);
      if (checksum) entry.checksums = [{ algorithm: "SHA512", checksumValue: checksum }];
      packages.push(entry);
    });
    for (const item of lock.items) {
      if (item.key === "") {
        relationships.push({
          spdxElementId: "SPDXRef-DOCUMENT",
          relationshipType: "DESCRIBES",
          relatedSpdxElement: item.id,
        });
      }
      for (const name of Object.keys(item.dependencies)) {
        const dep = findDep(lock.items, name);
        if (!dep) continue;
        relationships.push({
          spdxElementId: item.id,
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: dep.id,
        });
      }
    }
  }
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "galion-research",
    documentNamespace: namespace,
    creationInfo: {
      created,
      creators: ["Tool: scripts/sbom.js"],
    },
    packages,
    relationships,
  };
}

function main() {
  const out = process.argv[2] || path.join(ROOT, "build/sbom/galion-research.spdx.json");
  const doc = buildSbom(ROOT);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
