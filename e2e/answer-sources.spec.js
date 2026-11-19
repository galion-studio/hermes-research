import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ANSWER = {
  schema: "galion-research/1",
  status: "Returned",
  question: "Where is the paper?",
  reply: "Found\n- The paper is on arXiv.",
  citations: [{ n: 1, text: "Attention Is All You Need https://arxiv.org/abs/1706.03762" }],
  found: ["The paper is on arXiv."],
  inferred: [],
  unknown: [],
  sources: [
    {
      label: "Citation",
      n: 1,
      text: "Attention Is All You Need https://arxiv.org/abs/1706.03762",
      title: "Attention Is All You Need",
      domain: "arxiv.org",
      href: "https://arxiv.org/abs/1706.03762",
    },
    {
      label: "Citation",
      n: 2,
      text: "javascript:alert(1)",
      title: "Not a link",
      domain: "",
      href: "javascript:alert(1)",
    },
  ],
  helpers: "Helpers are quiet.",
};

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
}

test("sources are a title, a domain, and a link on a phone", async ({ page }) => {
  let asked = false;
  await page.route("**/research/ask", async (route) => {
    asked = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ANSWER),
    });
  });
  await page.route("**/research/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "galion-research/1",
        items: [],
        sources: asked ? ANSWER.sources : [],
      }),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("#source-links-empty")).toHaveText("No source yet.");
  await page.locator("#prompt").fill("Where is the paper?");
  await page.getByRole("button", { name: "Send" }).click();
  const paper = page.locator("#source-links li").nth(0);
  await expect(paper.locator(".source-title")).toHaveText("Attention Is All You Need");
  await expect(paper.locator(".source-domain")).toHaveText("arxiv.org");
  const link = paper.locator("a");
  await expect(link).toHaveAttribute("href", "https://arxiv.org/abs/1706.03762");
  await expect(link).toHaveText("https://arxiv.org/abs/1706.03762");
  const box = await link.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#source-links a")).toHaveCount(1);
  await expect(page.locator("#source-links li").nth(1).locator("a")).toHaveCount(0);
  await expect(page.locator("#citation-list a")).toHaveAttribute("href", "https://arxiv.org/abs/1706.03762");
  await expect(page.locator("#source-links-empty")).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await link.focus();
  await expect(link).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);
});
