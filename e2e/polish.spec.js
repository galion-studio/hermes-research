import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

const viewports = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1280, height: 800 },
];

async function openDesk(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
}

test("controls are at least 44px on a phone and on the desktop", async ({ page }) => {
  for (const viewport of viewports) {
    await openDesk(page, viewport);
    const selectors = ["#add-file", "#add-image", "#silence", "#ui-toggle", "#voice", "#to-one", "#allow-experiment"];
    for (const selector of selectors) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).toBeTruthy();
      expect(box.width, `${selector} width at ${viewport.width}`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${selector} height at ${viewport.width}`).toBeGreaterThanOrEqual(44);
    }
    const labels = await page.locator(".themes label").all();
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      const box = await label.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  }
});

test("keyboard focus rings stay Sky, 2px, and inside the phone width", async ({ page }) => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    await openDesk(page, viewport);
    const controls = ["#add-file", "#add-image", "#silence", "#ui-toggle", "#voice", "#to-one", "#allow-experiment", "#prompt"];
    for (const selector of controls) {
      const ring = await page.locator(selector).evaluate((el) => {
        const target = el.id === "prompt" ? el.closest(".field") : el;
        el.focus({ focusVisible: true });
        const style = getComputedStyle(target);
        const box = target.getBoundingClientRect();
        const width = Number.parseFloat(style.outlineWidth);
        const offset = Number.parseFloat(style.outlineOffset);
        return {
          style: style.outlineStyle,
          width,
          offset,
          color: style.outlineColor,
          left: box.left - offset - width,
          right: box.right + offset + width,
          viewport: window.innerWidth,
          field: getComputedStyle(document.querySelector(".field")).backgroundColor,
        };
      });
      expect(ring.style, selector).toBe("solid");
      expect(ring.width, selector).toBeGreaterThanOrEqual(2);
      expect(ring.offset, selector).toBeGreaterThanOrEqual(3);
      expect(ring.left, selector).toBeGreaterThanOrEqual(-1);
      expect(ring.right, selector).toBeLessThanOrEqual(ring.viewport + 1);
      const ink = parseRgb(ring.color);
      const ground = parseRgb(ring.field);
      expect(ink, `${selector} ${ring.color}`).not.toBeNull();
      expect(ground, ring.field).not.toBeNull();
      expect(contrast(ink, ground), selector).toBeGreaterThanOrEqual(3);
    }
    await page.locator("#silence").evaluate((el) => el.focus({ focusVisible: true }));
    await page.locator("#silence").click();
    const pressed = await page.locator("#silence").evaluate((el) => {
      el.focus({ focusVisible: true });
      return getComputedStyle(el).outlineStyle;
    });
    expect(pressed).toBe("solid");
  }
});

test("Ink, Ice, Sky, and Ocean keep control edges readable", async ({ page }) => {
  await openDesk(page, { width: 390, height: 844 });
  for (const name of ["Ink", "Ice", "Sky", "Ocean"]) {
    await page.getByRole("radio", { name }).check();
    await expect(page.locator("body")).toHaveAttribute("data-theme", name.toLowerCase());
    const sample = await page.evaluate(() => {
      const css = getComputedStyle;
      const unchecked = [...document.querySelectorAll(".themes label")].find((label) => !label.querySelector("input").checked);
      return {
        edge: css(unchecked).borderTopColor,
        rail: css(document.getElementById("rail")).backgroundColor,
        tool: css(document.getElementById("add-file")).borderTopColor,
        field: css(document.querySelector(".field")).backgroundColor,
        found: css(document.querySelector("#found h3")).color,
        inferred: css(document.querySelector("#inferred h3")).color,
        unknown: css(document.querySelector("#unknown h3")).color,
        panel: css(document.getElementById("notebook")).backgroundColor,
      };
    });
    const edge = parseRgb(sample.edge);
    const rail = parseRgb(sample.rail);
    const tool = parseRgb(sample.tool);
    const field = parseRgb(sample.field);
    const panel = parseRgb(sample.panel);
    expect(edge, `${name} edge ${sample.edge}`).not.toBeNull();
    expect(contrast(edge, rail), name).toBeGreaterThanOrEqual(3);
    expect(contrast(tool, field), name).toBeGreaterThanOrEqual(3);
    expect(contrast(parseRgb(sample.found), panel), name).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseRgb(sample.inferred), panel), name).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseRgb(sample.unknown), panel), name).toBeGreaterThanOrEqual(4.5);
    const violations = await new AxeBuilder({ page }).analyze();
    const serious = violations.violations.filter((row) => row.impact === "serious" || row.impact === "critical");
    expect(serious).toEqual([]);
  }
});

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("handed files and images stay visible, named, and unlimited", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/research");
  await page.getByRole("button", { name: "Show interface" }).click();
  await expect(page.locator("#files")).not.toHaveAttribute("accept");
  await expect(page.locator("#source-empty")).toHaveAttribute("aria-label", "Local is empty");
  await expect(page.locator("#reading-empty")).toHaveAttribute("aria-label", "Reading is empty");
  await expect(page.locator("#arriving-empty")).toHaveAttribute("aria-label", "Arriving is empty");
  await expect(page.locator("#local-list")).toHaveAttribute("aria-label", "Local");
  await expect(page.locator("#reading-list")).toHaveAttribute("aria-label", "Reading");
  await expect(page.locator("#arriving-list")).toHaveAttribute("aria-label", "Arriving");
  await expect(page.locator("#citation-list")).toHaveAttribute("aria-label", "Citations");
  await expect(page.locator("#citation-empty")).toHaveAttribute("aria-label", "Citations are empty");
  await expect(page.locator("#state-line")).toHaveAttribute("role", "status");
  await expect(page.locator("#prompt")).toHaveAttribute("aria-describedby", /file-note/);

  await page.locator("#files").setInputFiles([
    { name: ".notes", mimeType: "application/octet-stream", buffer: Buffer.from("dotfile-marker\n") },
    { name: "shot.png", mimeType: "image/png", buffer: tinyPng },
    {
      name: "archive.bin",
      mimeType: "application/x-custom",
      buffer: Buffer.alloc(64 * 1024, 7),
    },
  ]);
  await expect(page.locator("#file-names")).toHaveText(".notes, shot.png, archive.bin");
  await expect(page.locator("#file-note")).toHaveText("Handed 3 files.");
  await expect(page.getByRole("button", { name: "Remove files" })).toBeVisible();
  const clearBox = await page.getByRole("button", { name: "Remove files" }).boundingBox();
  expect(clearBox.width).toBeGreaterThanOrEqual(44);
  expect(clearBox.height).toBeGreaterThanOrEqual(44);
  const preview = page.locator("#file-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("alt", "Preview of shot.png");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const withFiles = await new AxeBuilder({ page }).analyze();
  expect(withFiles.violations.filter((row) => row.impact === "serious" || row.impact === "critical")).toEqual([]);

  await page.getByRole("button", { name: "Remove files" }).click();
  await expect(page.locator("#handed")).toBeHidden();
  await expect(page.locator("#file-note")).toBeHidden();

  await page.locator("#files").setInputFiles({
    name: ".env",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not-a-secret\n"),
  });
  await expect(page.locator("#file-names")).toHaveText(".env");
  await expect(page.locator("#file-note")).toHaveText("Handed 1 file.");
  await expect(page.locator("#file-preview")).toBeHidden();
  await page.locator("#prompt").fill("What is in the file?");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#file-note")).toHaveText("Handed 1 file.");
  await expect(page.locator("#file-names")).toHaveText(".env");
  await expect(page.locator("#reading-body")).toContainText(".env");
  await expect(page.locator("#reading-body")).toContainText("not-a-secret");
});

test("a file stays named while the question is in flight", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/research/ask", async (route) => {
    await gate;
    await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/research");
  await page.locator("#files").setInputFiles({
    name: "field-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from the phone\n"),
  });
  await page.locator("#prompt").fill("Read the note");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#file-note")).toHaveText("Sending 1 file.");
  await expect(page.locator("#file-names")).toHaveText("field-note.txt");
  await expect(page.locator("body")).toHaveAttribute("data-state", "loading");
  release();
  await expect(page.locator("#file-note")).toHaveText("Handed 1 file.");
  await expect(page.locator("#reading-body")).toContainText("field-note.txt");
});
