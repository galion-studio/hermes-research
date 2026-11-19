import { expect, test } from "@playwright/test";

async function fullyInView(locator) {
  const box = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  return box;
}

test.describe("a phone can ask", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("tap Send, see the wait, then a clear line, with the field still in reach", async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/research/ask", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/research");
    await expect(page.locator("body")).toHaveAttribute("data-ui", "minimal");
    await expect(page.locator("#first-run")).toBeVisible();
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).toContain("interactive-widget=resizes-content");
    const css = await page.evaluate(() => {
      const sheets = [...document.styleSheets];
      return sheets
        .map((sheet) => {
          try {
            return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
          } catch {
            return "";
          }
        })
        .join("\n");
    });
    expect(css).toContain("safe-area-inset-top");
    expect(css).toContain("safe-area-inset-bottom");
    expect(css).toContain("safe-area-inset-left");
    expect(css).toContain("safe-area-inset-right");

    await page.setViewportSize({ width: 390, height: 420 });
    await page.locator("#prompt").tap();
    await page.locator("#prompt").fill("Who are you?");
    const field = page.locator(".field");
    const send = page.getByRole("button", { name: "Send" });
    await fullyInView(field);
    const sendBox = await fullyInView(send);
    expect(sendBox.width).toBeGreaterThanOrEqual(44);
    expect(sendBox.height).toBeGreaterThanOrEqual(44);
    await expect(send).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 844 });
    await send.tap();
    await expect(page.locator("body")).toHaveAttribute("data-state", "loading");
    await expect(page.locator("#loading")).toBeVisible();
    await expect(page.locator("#loading")).toHaveText("Reading the question.");
    await expect(page.locator("#first-run")).toBeHidden();
    await expect(send).toBeDisabled();
    await fullyInView(field);
    await fullyInView(send);

    release();
    await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
    await expect(page.locator("#loading")).toBeHidden();
    await expect(page.locator("#reading-body")).toBeVisible();
    await expect(page.locator("#reading-body")).toContainText("Offline");
    await expect(page.locator("#sources")).toBeHidden();
    await expect(page.locator("#notebook")).toBeHidden();
    await expect(page.locator("#experiments")).toBeHidden();
    await fullyInView(field);
    await fullyInView(send);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test("Enter still sends on the desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research");
  await page.locator("#prompt").fill("Who are you?");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#reading-question")).toHaveText("Who are you?");
  await expect(page.locator("#reading-body")).toContainText("Offline");
  await expect(page.locator("#error")).toBeHidden();
});
