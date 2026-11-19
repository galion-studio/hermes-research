import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const external = [];

function isLocal(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) || url.startsWith("data:") || url.startsWith("blob:");
}

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((row) => row.impact === "serious" || row.impact === "critical")
    .map((row) => ({
      id: row.id,
      impact: row.impact,
      targets: row.nodes.slice(0, 6).map((node) => node.target),
    }));
}

async function focusRing(page, selector) {
  return page.locator(selector).evaluate((el) => {
    const target = el.id === "prompt" ? el.closest(".field") : el;
    el.focus({ focusVisible: true });
    const style = getComputedStyle(target);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      offset: Number.parseFloat(style.outlineOffset),
    };
  });
}

async function tabIds(page, steps) {
  const ids = [];
  for (let i = 0; i < steps; i += 1) {
    ids.push(await page.evaluate(() => document.activeElement && document.activeElement.id));
    await page.keyboard.press("Tab");
  }
  return ids;
}

test.beforeEach(async ({ page }) => {
  external.length = 0;
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (isLocal(url)) return route.continue();
    external.push(url);
    return route.abort();
  });
});

test.afterEach(() => {
  expect(external).toEqual([]);
});

test("tab order reaches the ask field, Send, uploads, the answer, and the sources", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("#files")).not.toHaveAttribute("accept");
  await page.locator("#prompt").fill("Who are you?");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await expect(page.locator("#reading")).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#sources")).toHaveAttribute("tabindex", "0");

  await page.locator("#prompt").focus();
  const ids = await tabIds(page, 14);
  const at = (id) => ids.indexOf(id);
  for (const id of ["prompt", "add-file", "add-image", "send", "sources", "reading"]) {
    expect(at(id), ids.join(" ")).toBeGreaterThanOrEqual(0);
  }
  expect(at("prompt")).toBeLessThan(at("add-file"));
  expect(at("add-file")).toBeLessThan(at("add-image"));
  expect(at("add-image")).toBeLessThan(at("send"));
  expect(at("send")).toBeLessThan(at("sources"));
  expect(at("sources")).toBeLessThan(at("reading"));
  expect(ids).not.toContain("files");

  for (const selector of ["#prompt", "#add-file", "#add-image", "#send", "#sources", "#reading", "#voice"]) {
    const ring = await focusRing(page, selector);
    expect(ring.style, selector).toBe("solid");
    expect(ring.width, selector).toBeGreaterThanOrEqual(2);
    expect(ring.offset, selector).toBeGreaterThanOrEqual(3);
  }
});

test("icon buttons have names and pictures stay hidden from the name", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  const buttons = await page.locator("button").evaluateAll((nodes) =>
    nodes.map((button) => ({
      id: button.id,
      name: (button.getAttribute("aria-label") || button.textContent || "").replace(/\s+/g, " ").trim(),
      icons: [...button.querySelectorAll("svg")].map((svg) => svg.getAttribute("aria-hidden")),
    })),
  );
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button.name, button.id || "button").not.toBe("");
    for (const hidden of button.icons) expect(hidden, button.id).toBe("true");
  }
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voice" })).toBeVisible();
});

test("an error and an answer are announced, and axe stays quiet", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("#error")).toHaveAttribute("role", "alert");
  await expect(page.locator("#error")).toHaveAttribute("aria-live", "assertive");
  await expect(page.locator("#error")).toHaveAttribute("aria-atomic", "true");

  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#error")).toHaveText("The question is empty.");
  await expect(page.locator("#error")).toBeVisible();
  let violations = await seriousViolations(page);
  expect(violations).toEqual([]);

  await page.locator("#prompt").fill("Who are you?");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#reading-body")).toContainText("not reachable");
  await expect.poll(async () => page.locator("[aria-live='polite']").allTextContents()).toEqual(
    expect.arrayContaining([expect.stringContaining("not reachable")]),
  );
  await expect(page.locator("#error")).toBeHidden();
  violations = await seriousViolations(page);
  expect(violations).toEqual([]);

  await page.setViewportSize({ width: 360, height: 740 });
  violations = await seriousViolations(page);
  expect(violations).toEqual([]);
});

test("a source link is in the tab order without nesting another stop", async ({ page }) => {
  const answer = {
    schema: "galion-research/1",
    status: "Returned",
    question: "Where is the note?",
    reply: "See the note.",
    citations: [{ n: 1, text: "Field note https://example.com/note" }],
    sources: [
      {
        label: "Citation",
        n: 1,
        text: "Field note https://example.com/note",
        title: "Field note",
        href: "https://example.com/note",
      },
    ],
    found: [],
    inferred: [],
    unknown: [],
    helpers: "Helpers are quiet.",
  };
  await page.route("**/research/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(answer),
    }),
  );
  await page.route("**/research/history", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schema: "galion-research/1", items: [], sources: answer.sources }),
    }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await page.locator("#prompt").fill("Where is the note?");
  await page.locator("#prompt").press("Enter");
  const link = page.locator("#source-links a");
  await expect(link).toHaveAttribute("href", "https://example.com/note");
  await expect(page.locator("#sources")).not.toHaveAttribute("tabindex");
  await expect(page.locator("#reading")).toHaveAttribute("tabindex", "0");
  await page.locator("#prompt").focus();
  const ids = [];
  let sawLink = false;
  for (let i = 0; i < 16; i += 1) {
    const current = await page.evaluate(() => {
      const el = document.activeElement;
      return { id: el && el.id, href: el && el.getAttribute && el.getAttribute("href") };
    });
    if (current.href && current.href.includes("example.com/note")) sawLink = true;
    ids.push(current.id || current.href || "");
    await page.keyboard.press("Tab");
  }
  expect(sawLink, ids.join(" ")).toBe(true);
  const violations = await seriousViolations(page);
  expect(violations).toEqual([]);
});

test("reduced motion holds the disc and drops the page transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/research");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.waitForTimeout(300);
  const first = await page.locator("#voice-dot").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const px = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return [px[0], px[1], px[2], px[3]];
  });
  await page.waitForTimeout(500);
  const second = await page.locator("#voice-dot").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const px = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return [px[0], px[1], px[2], px[3]];
  });
  expect(second).toEqual(first);
  expect(first[3]).toBeGreaterThan(0);
  const ms = await page.evaluate(() => {
    const value = getComputedStyle(document.body).transitionDuration;
    if (value === "0s") return 0;
    const n = Number.parseFloat(value);
    return value.endsWith("ms") ? n : n * 1000;
  });
  expect(ms).toBeLessThan(1);
  const violations = await seriousViolations(page);
  expect(violations).toEqual([]);
});
