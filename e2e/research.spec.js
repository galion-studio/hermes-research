import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function shotDir() {
  const preferred = process.env.GALION_SHOTS || "/opt/cursor/artifacts";
  try {
    mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = join(fileURLToPath(new URL(".", import.meta.url)), "artifacts");
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const shots = shotDir();
const allowed = [108, 216, 288, 432, 540, 648, 864];

function relLum(r, g, b) {
  const channel = (c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const hi = Math.max(relLum(...a), relLum(...b));
  const lo = Math.min(relLum(...a), relLum(...b));
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(value) {
  const text = String(value).trim();
  const rgb = text.match(/rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((n) => Math.round(n));
  const modern = text.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/);
  if (modern) return modern.slice(1).map((n) => Math.round(Number(n) <= 1 ? Number(n) * 255 : Number(n)));
  return null;
}

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((row) => row.impact === "serious" || row.impact === "critical")
    .map((row) => ({
      id: row.id,
      impact: row.impact,
      nodes: row.nodes.slice(0, 6).map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    }));
}

async function paint(page) {
  return page.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo || null);
    const prompt = document.getElementById("prompt");
    const field = document.querySelector(".field");
    const silence = document.getElementById("silence");
    const found = document.querySelector("#found h3");
    const inferred = document.querySelector("#inferred h3");
    const unknown = document.querySelector("#unknown h3");
    const panel = document.querySelector("#notebook");
    const cv = document.getElementById("voice-dot");
    const ctx = cv.getContext("2d");
    const px = ctx.getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
    return {
      prompt: css(prompt).color,
      placeholder: css(prompt, "::placeholder").color,
      field: css(field).backgroundColor,
      silence: css(silence).color,
      silenceBg: css(silence).backgroundColor,
      found: css(found).color,
      inferred: css(inferred).color,
      unknown: css(unknown).color,
      panel: css(panel).backgroundColor,
      body: css(document.body).backgroundColor,
      disc: [px[0], px[1], px[2], px[3]],
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__tones = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      const osc = orig.apply(this, arguments);
      const freq = osc.frequency;
      const proto = Object.getPrototypeOf(freq);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      let current = freq.value;
      Object.defineProperty(freq, "value", {
        configurable: true,
        enumerable: true,
        get() {
          return current;
        },
        set(v) {
          current = v;
          window.__tones.push(v);
          if (desc && desc.set) desc.set.call(freq, v);
        },
      });
      return osc;
    };
  });
});

test("desktop opens on the bare field", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await expect(page).toHaveTitle("Galion Research");
  await expect(page.locator("body")).toHaveAttribute("data-ui", "minimal");
  await expect(page.locator("body")).toHaveAttribute("data-silence", "off");
  await expect(page.locator("#prompt")).toHaveAttribute("placeholder", "Ask anything");
  await expect(page.locator("#rail")).toBeHidden();
  await expect(page.locator("#work")).toBeHidden();
  await expect(page.locator("#add-image")).toBeHidden();
  await expect(page.locator("#commit-hint")).toBeHidden();
  await expect(page.getByRole("button", { name: "Voice" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Silence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show interface" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an image" })).toHaveCount(0);

  const field = await page.locator(".field").boundingBox();
  const voice = await page.locator("#voice").boundingBox();
  expect(voice.x).toBeGreaterThan(field.x + field.width - 8);
  expect(voice.width).toBeGreaterThan(80);

  await page.waitForTimeout(400);
  const sample = await paint(page);
  expect(sample.disc[3]).toBeGreaterThan(200);
  expect(sample.disc[2]).toBeGreaterThan(sample.disc[0]);
  expect(Math.min(...sample.disc.slice(0, 3))).toBeLessThan(210);
  await page.screenshot({ path: join(shots, "research-minimal-desktop.png") });
});

test("desktop desk keeps the research labels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("body")).not.toHaveAttribute("data-ui", "minimal");
  await expect(page.getByRole("button", { name: "Hide interface" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Citations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inferred" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unknown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow this experiment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an image" })).toBeVisible();
  await expect(page.locator("#experiment")).toContainText("Ask first");
  await page.screenshot({ path: join(shots, "research-desk-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Hide interface" }).click();
  await expect(page.locator("#work")).toBeHidden();
  await expect(page.locator("#prompt")).toBeVisible();
  await expect(page.locator("#voice")).toBeVisible();
  await expect(page.locator("#add-file")).toBeVisible();
});

test("phone keeps the field, the disc, and the file plus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/research");
  await expect(page.locator("#rail")).toBeHidden();
  await expect(page.locator("#voice")).toBeVisible();
  await expect(page.locator("#add-file")).toBeVisible();
  const field = await page.locator(".field").boundingBox();
  const voice = await page.locator("#voice").boundingBox();
  expect(field.width).toBeGreaterThan(280);
  expect(voice.y).toBeGreaterThan(field.y + field.height - 4);
  await page.screenshot({ path: join(shots, "research-minimal-phone.png") });

  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.getByRole("heading", { name: "Found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inferred" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unknown" })).toBeVisible();
  await page.screenshot({ path: join(shots, "research-desk-phone.png"), fullPage: true });
  const phoneOpen = await seriousViolations(page);
  expect(phoneOpen).toEqual([]);
  await page.getByRole("button", { name: "Hide interface" }).click();
  await expect(page.locator("#work")).toBeHidden();
  const phoneBare = await seriousViolations(page);
  expect(phoneBare).toEqual([]);
});

test("Silence keeps the 432 Hz cues quiet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.locator("#voice").click();
  await expect.poll(() => page.locator("body").getAttribute("data-cues")).toContain("listen");
  const tones = await page.evaluate(() => window.__tones.slice());
  expect(tones).toContain(432);
  for (const hz of tones) expect(allowed).toContain(hz);

  await page.locator("#silence").click();
  await expect(page.locator("body")).toHaveAttribute("data-silence", "on");
  await expect(page.locator("#silence")).toHaveAttribute("aria-pressed", "true");
  const frozen = await page.locator("body").getAttribute("data-cues");
  const count = await page.evaluate(() => window.__tones.length);
  await page.screenshot({ path: join(shots, "research-silence-desktop.png") });
  await page.locator("#voice").click();
  await page.locator("#ui-toggle").click();
  await page.waitForTimeout(250);
  expect(await page.locator("body").getAttribute("data-cues")).toBe(frozen);
  expect(await page.evaluate(() => window.__tones.length)).toBe(count);

  await page.locator("#prompt").press("s");
  await expect(page.locator("#prompt")).toHaveValue("s");
  await expect(page.locator("body")).toHaveAttribute("data-silence", "on");

  await page.locator("#voice").focus();
  await page.keyboard.press("s");
  await expect(page.locator("body")).toHaveAttribute("data-silence", "off");
});

test("a silence link starts quiet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research?silence=1");
  await expect(page.locator("body")).toHaveAttribute("data-silence", "on");
  await expect(page.locator("#silence")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#voice").click();
  await page.locator("#ui-toggle").click();
  await page.waitForTimeout(200);
  expect(await page.locator("body").getAttribute("data-cues")).toBe("");
  expect(await page.evaluate(() => window.__tones.length)).toBe(0);
});

test("reduced motion holds the disc still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.waitForTimeout(300);
  const first = (await paint(page)).disc;
  await page.waitForTimeout(500);
  const second = (await paint(page)).disc;
  expect(second).toEqual(first);
});

test("text and the disc meet WCAG AA", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.waitForTimeout(300);
  const sample = await paint(page);
  for (const key of ["prompt", "placeholder", "field", "found", "inferred", "unknown", "panel", "body"]) {
    expect(parseRgb(sample[key]), `${key} ${sample[key]}`).not.toBeNull();
  }
  const prompt = parseRgb(sample.prompt);
  const placeholder = parseRgb(sample.placeholder);
  const field = parseRgb(sample.field);
  const found = parseRgb(sample.found);
  const inferred = parseRgb(sample.inferred);
  const unknown = parseRgb(sample.unknown);
  const panel = parseRgb(sample.panel);
  const body = parseRgb(sample.body);
  const disc = sample.disc.slice(0, 3);
  const promptOnField = contrast(prompt, field);
  const placeholderOnField = contrast(placeholder, field);
  const foundOnPanel = contrast(found, panel);
  const inferredOnPanel = contrast(inferred, panel);
  const unknownOnPanel = contrast(unknown, panel);
  const discOnGround = contrast(disc, body);
  writeFileSync(
    join(shots, "research-contrast.json"),
    JSON.stringify(
      {
        viewport: "1440x900",
        prompt,
        placeholder,
        field,
        found,
        inferred,
        unknown,
        panel,
        body,
        disc,
        promptOnField,
        placeholderOnField,
        foundOnPanel,
        inferredOnPanel,
        unknownOnPanel,
        discOnGround,
        aaNormalText: 4.5,
        aaNonText: 3,
      },
      null,
      2,
    ),
  );
  expect(promptOnField).toBeGreaterThanOrEqual(4.5);
  expect(placeholderOnField).toBeGreaterThanOrEqual(4.5);
  expect(foundOnPanel).toBeGreaterThanOrEqual(4.5);
  expect(inferredOnPanel).toBeGreaterThanOrEqual(4.5);
  expect(unknownOnPanel).toBeGreaterThanOrEqual(4.5);
  expect(discOnGround).toBeGreaterThanOrEqual(3);
  expect(found).toEqual([184, 232, 255]);
  expect(inferred).toEqual([88, 196, 255]);
  expect(unknown).toEqual([230, 237, 243]);

  await page.locator("#silence").click();
  const pressed = await paint(page);
  const silenceOnSky = contrast(parseRgb(pressed.silence), parseRgb(pressed.silenceBg));
  expect(silenceOnSky).toBeGreaterThanOrEqual(4.5);

  const open = await seriousViolations(page);
  expect(open).toEqual([]);
  await page.getByRole("button", { name: "Hide interface" }).click();
  const bare = await seriousViolations(page);
  expect(bare).toEqual([]);
  await page.screenshot({ path: join(shots, "research-contrast-desktop.png") });
});

test("a local question leaves the citation list empty", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.locator("#prompt").fill("Who are you?");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#reading-body")).toContainText("Galion Research. What are we looking into?");
  await expect(page.locator("#reading-body")).toContainText("Offline");
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#hermes-status")).toContainText("Offline");
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#unknown-list li")).toHaveCount(1);
  await expect(page.locator("#found-list li")).toHaveCount(0);
  await expect(page.locator("#local-list li")).toHaveCount(1);
  await expect(page.locator("#citation-empty")).toBeVisible();
  await expect(page.locator("#citation-list li")).toHaveCount(0);
  await expect(page.locator("#helpers")).toContainText("Local knowledge carries the question.");
  await page.screenshot({ path: join(shots, "research-answer-desktop.png"), fullPage: true });
});

test("an empty question stays an error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("#hermes-status")).toContainText("Offline");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#error")).toHaveText("The question is empty.");
  await expect(page.locator("body")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#hermes-status")).toContainText("Error");
  await expect(page.locator("#hermes-status")).not.toContainText("Offline");
  await expect(page.locator("#citation-list li")).toHaveCount(0);
  await expect(page.locator("#found-list li")).toHaveCount(0);
});

test("a late status read does not relabel an empty question", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/research/hermes", async (route) => {
    await gate;
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#hermes-status")).toContainText("Error");
  release();
  await page.waitForResponse("**/research/hermes");
  await expect(page.locator("body")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#hermes-status")).toHaveText("Hermes · Error");
});

test("a late history read does not wipe an offline answer", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/research/history", async (route) => {
    if (!held && route.request().method() === "GET") {
      held = true;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schema: "galion-research/1", items: [], sources: [] }),
      });
      return;
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.locator("#prompt").fill("Who are you?");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#local-list li")).toHaveCount(1);
  const stale = page.waitForResponse(
    (res) => res.url().includes("/research/history") && res.request().method() === "GET",
  );
  release();
  await stale;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#reading-body")).toContainText("Offline");
  await expect(page.locator("#local-list li")).toHaveCount(1);
  await expect(page.locator("#citation-list li")).toHaveCount(0);
});
