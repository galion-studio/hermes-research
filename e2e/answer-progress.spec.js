import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
}

function holdAsk(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    release,
    ready: page.route("**/research/ask", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema: "galion-research/1",
          status: "Returned",
          question: "What is the wash?",
          reply: "Ink.",
          citations: [],
          found: [],
          inferred: [],
          unknown: [],
          sources: [],
          helpers: "Helpers are quiet.",
        }),
      });
    }),
  };
}

test("a phone shows a calm progress line while a question runs", async ({ page }) => {
  const ask = holdAsk(page);
  await ask.ready;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/research");
  await page.locator("#prompt").fill("   ");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#progress")).toBeHidden();

  await page.locator("#prompt").fill("What is the wash?");
  await page.locator("#prompt").press("Enter");
  const progress = page.locator("#progress");
  await expect(progress).toBeVisible();
  await expect(page.locator("#progress-line")).toHaveText("Reading.");
  await expect(progress).toHaveAttribute("aria-busy", "true");
  await expect(progress).toHaveAttribute("aria-live", "polite");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await seriousViolations(page)).toEqual([]);

  ask.release();
  await expect(progress).toBeHidden();
  await expect(page.locator("#reading-body")).toHaveText("Ink.");
});

test("the progress line follows /research/progress, including reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/research/progress", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "galion-research/1",
        app: "hermes",
        phase: "planning",
        calls: 0,
        call_budget: 1,
        helpers: [],
      }),
    });
  });
  await page.route("**/research/ask", async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "galion-research/1",
        status: "Offline",
        question: "What is the wash?",
        reply: "Offline.",
        citations: [],
        found: [],
        inferred: [],
        unknown: ["Offline."],
        sources: [],
        helpers: "Helpers are quiet. Local knowledge carries the question.",
      }),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.locator("#prompt").fill("What is the wash?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#progress-line")).toHaveText("Planning.");
  const animation = await page.locator("#progress-mark").evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
  expect(await seriousViolations(page)).toEqual([]);
  release();
  await expect(page.locator("#progress")).toBeHidden();
});
