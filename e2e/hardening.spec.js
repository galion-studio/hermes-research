import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { ASK_LIMIT, RATE_LIMITED } from "../src/limits.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loopbackHex(host) {
  const parts = host.split(".").map((part) => Number(part));
  const value = (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
  const le =
    (((value & 0xff) << 24) | ((value & 0xff00) << 8) | ((value >>> 8) & 0xff00) | ((value >>> 24) & 0xff)) >>> 0;
  return le.toString(16).toUpperCase().padStart(8, "0");
}

function listenHexes(file, port) {
  const text = readFileSync(file, "utf8");
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const found = [];
  for (const line of text.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [ip, p] = (parts[1] || "").split(":");
    if (!p || p.toUpperCase() !== hexPort || parts[3] !== "0A") continue;
    found.push((ip || "").toUpperCase());
  }
  return found;
}

function audit(cwd) {
  const run = spawnSync("npm", ["audit", "--json", "--audit-level=high"], { cwd, encoding: "utf8" });
  return { status: run.status, report: JSON.parse(run.stdout || "{}") };
}

function setCookie(response) {
  const rows = response.headersArray().filter((row) => row.name.toLowerCase() === "set-cookie");
  return rows.map((row) => row.value).join("; ");
}

test("the desk keeps its policy, its cookie flags, and the research labels", async ({ page }) => {
  const probed = await page.request.get("/research");
  const cookie = setCookie(probed);
  expect(cookie).toContain("research_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain("Path=/");
  expect(cookie).not.toMatch(/Domain=/i);
  const response = await page.goto("/research");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("nonce-");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  await expect(page).toHaveTitle("Galion Research");
  await expect(page.locator("body")).toHaveAttribute("data-standard", "432");
  await page.locator("#silence").click();
  await expect(page.locator("body")).toHaveAttribute("data-silence", "on");
  await expect(page.locator("#silence")).toHaveAttribute("aria-pressed", "true");
  const stored = await page.context().cookies();
  expect(stored.some((row) => row.name === "research_session" && row.httpOnly && row.secure && row.sameSite === "Strict")).toBe(true);
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.getByRole("heading", { name: "Found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inferred" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unknown" })).toBeVisible();
});

test("errors share one shape and a too-large body does not become an answer", async ({ request }) => {
  const missing = await request.get("/research/missing");
  const method = await request.post("/health");
  const empty = await request.post("/research/ask", { data: { question: "   " } });
  const bulky = await request.post("/health", { data: "x".repeat(32_769) });
  expect(missing.status()).toBe(404);
  expect(method.status()).toBe(405);
  expect(method.headers().allow).toBe("GET");
  expect(empty.status()).toBe(400);
  expect(bulky.status()).toBe(413);
  const bodies = [await missing.json(), await method.json(), await empty.json(), await bulky.json()];
  const codes = bodies.map((body) => body.error);
  expect(codes).toEqual(["not-found", "method", "empty", "too-large"]);
  for (const body of bodies) {
    expect(body.schema).toBe("galion-research/1");
    expect(body.status).toBe("Error");
    expect(body.citations).toEqual([]);
    expect(body.found).toEqual([]);
    expect(body.inferred).toEqual([]);
    expect(body.unknown).toEqual([]);
    expect(body.sources).toEqual([]);
  }
});

test("the next question after the cap is an error, not Offline", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  const stored = await page.context().cookies();
  const session = stored.find((row) => row.name === "research_session");
  expect(session).toBeTruthy();
  const headers = { "content-type": "application/json", cookie: `research_session=${session.value}` };
  for (let i = 0; i < ASK_LIMIT; i += 1) {
    const res = await page.request.post("/research/ask", { headers, data: { question: "Who are you?" } });
    expect(res.status()).toBe(200);
  }
  await page.locator("#prompt").fill("Who are you?");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#error")).toHaveText(RATE_LIMITED);
  await expect(page.locator("body")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#hermes-status")).toContainText("Error");
  await expect(page.locator("#hermes-status")).not.toContainText("Offline");
  await expect(page.locator("#citation-list li")).toHaveCount(0);
  await expect(page.locator("#found-list li")).toHaveCount(0);
  await expect(page.locator("#inferred-list li")).toHaveCount(0);
});

test("the running desk is bound to loopback only", async ({ request }) => {
  const health = await request.get("/health");
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe("galion-research");
  const hex = loopbackHex(body.bind);
  for (const port of [4173, 4174, 4175, 8644, 8645]) {
    expect(listenHexes("/proc/net/tcp", port)).toEqual([hex]);
    expect(listenHexes("/proc/net/tcp6", port)).toEqual([]);
  }
  expect(new URL(health.url()).hostname).toBe(body.bind);
});

test("a Hermes timeout stays Offline and cites nothing", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.locator("#prompt").fill("What does Ultra cost?");
  const started = Date.now();
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(450);
  expect(elapsed).toBeLessThan(4_000);
  await expect(page.locator("#reading-body")).toContainText("Offline");
  await expect(page.locator("#reading-body")).toContainText("220");
  await expect(page.locator("#citation-list li")).toHaveCount(0);
  await expect(page.locator("#found-list li")).toHaveCount(0);
  await expect(page.locator("#error")).toBeHidden();
});

test("a dropped Hermes connection stays Offline and cites nothing", async ({ page }) => {
  await page.goto("http://127.0.0.1:4175/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.locator("#prompt").fill("What does Ultra cost?");
  const started = Date.now();
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  expect(Date.now() - started).toBeLessThan(2_500);
  await expect(page.locator("#reading-body")).toContainText("Offline");
  await expect(page.locator("#citation-list li")).toHaveCount(0);
  await expect(page.locator("#found-list li")).toHaveCount(0);
  await expect(page.locator("#unknown-list li")).not.toHaveCount(0);
  await expect(page.locator("#error")).toBeHidden();
});

test("npm audit reports no high or critical advisories", () => {
  for (const dir of [root, path.join(root, "e2e")]) {
    const { status, report } = audit(dir);
    const counts = report.metadata.vulnerabilities;
    console.log(
      `npm audit ${dir === root ? "app" : "e2e"} exit=${status} info=${counts.info} low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical}`,
    );
    expect(counts.high).toBe(0);
    expect(counts.critical).toBe(0);
    expect(status).toBe(0);
  }
});
