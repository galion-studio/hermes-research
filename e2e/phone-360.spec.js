import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 360, height: 740 } });

async function fullyInView(locator) {
  const box = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  expect(box, locator.toString()).toBeTruthy();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  return box;
}

test("a 360px phone keeps Send in the thumb zone with 44px targets", async ({ page }) => {
  await page.goto("/research");
  await expect(page.locator("body")).toHaveAttribute("data-ui", "minimal");
  await expect(page.locator("#files")).not.toHaveAttribute("accept");

  const askRule = await page.evaluate(() => {
    const rules = [];
    for (const sheet of document.styleSheets) {
      let cssRules;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of cssRules) {
        if (rule.cssText && rule.cssText.includes("max-width: 360px") && rule.cssText.includes(".ask")) rules.push(rule.cssText);
      }
    }
    return rules.join("\n");
  });
  expect(askRule).toContain("safe-area-inset-bottom");
  expect(askRule).toContain("safe-area-inset-left");
  expect(askRule).toContain("safe-area-inset-right");
  expect(askRule).toContain("--kb-inset");

  const targets = ["#add-file", "#silence", "#ui-toggle", "#send", "#voice"];
  for (const selector of targets) {
    const box = await fullyInView(page.locator(selector));
    expect(box.width, selector).toBeGreaterThanOrEqual(44);
    expect(box.height, selector).toBeGreaterThanOrEqual(44);
  }

  const field = await fullyInView(page.locator(".field"));
  const send = await fullyInView(page.getByRole("button", { name: "Send" }));
  const voice = await page.locator("#voice").boundingBox();
  const viewport = page.viewportSize();
  expect(send.x).toBeGreaterThan(field.x + field.width / 2);
  expect(send.x + send.width).toBeLessThanOrEqual(field.x + field.width + 1);
  expect(voice.y).toBeGreaterThan(field.y + field.height - 4);
  expect(send.y + send.height / 2).toBeGreaterThan(viewport.height * 0.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the ask field and Send stay above a short phone viewport", async ({ page }) => {
  await page.goto("/research");
  await page.setViewportSize({ width: 360, height: 420 });
  await page.locator("#prompt").tap();
  await page.locator("#prompt").fill("Who are you?");
  const field = await fullyInView(page.locator(".field"));
  const send = await fullyInView(page.getByRole("button", { name: "Send" }));
  expect(send.width).toBeGreaterThanOrEqual(44);
  expect(send.height).toBeGreaterThanOrEqual(44);
  expect(send.y).toBeGreaterThanOrEqual(field.y);
  expect(send.y + send.height).toBeLessThanOrEqual(420);
  const voice = await page.locator("#voice").boundingBox();
  expect(voice.width).toBeGreaterThanOrEqual(44);
  expect(voice.height).toBeGreaterThanOrEqual(44);
  expect(voice.y).toBeGreaterThan(field.y + field.height - 4);

  await page.getByRole("button", { name: "Send" }).tap();
  await expect(page.locator("body")).toHaveAttribute("data-state", "offline");
  await fullyInView(page.locator(".field"));
  await fullyInView(page.getByRole("button", { name: "Send" }));
  await expect(page.locator("#reading-body")).toContainText("Offline");
});

test("showing the desk at 360px keeps Send at 44px inside the field", async ({ page }) => {
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("body")).not.toHaveAttribute("data-ui", "minimal");
  const position = await page.locator(".ask").evaluate((el) => getComputedStyle(el).position);
  expect(position).not.toBe("fixed");
  await page.locator("#prompt").fill("Who are you?");
  const field = await fullyInView(page.locator(".field"));
  const send = await fullyInView(page.getByRole("button", { name: "Send" }));
  expect(send.width).toBeGreaterThanOrEqual(44);
  expect(send.height).toBeGreaterThanOrEqual(44);
  expect(send.x).toBeGreaterThan(field.x + field.width / 2);
  const addImage = await page.locator("#add-image").boundingBox();
  expect(addImage.width).toBeGreaterThanOrEqual(44);
  expect(addImage.height).toBeGreaterThanOrEqual(44);
});
