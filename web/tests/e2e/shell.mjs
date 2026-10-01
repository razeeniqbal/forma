// Collapsible sidebar: toggle button, keyboard shortcut, remembered choice, narrow windows.
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/shell.mjs [screenshotDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
const step = (m) => console.log(`• ${m}`);
const width = () => page.locator("nav.sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
const settle = () => page.waitForTimeout(350);

step("wide window starts expanded");
await page.goto(`${BASE}/pipelines`);
if ((await width()) < 150) throw new Error("sidebar should start expanded on a wide window");

step("collapse with the button");
await page.getByRole("button", { name: "Collapse sidebar" }).click();
await settle();
if ((await width()) > 70) throw new Error(`collapsed sidebar is ${await width()}px`);
await page.getByRole("link", { name: "Sources" }).click();
await page.waitForURL(/\/sources$/);
await page.screenshot({ path: join(OUT, "shell1-collapsed.png") });

step("choice survives a reload");
await page.reload();
await settle();
if ((await width()) > 70) throw new Error("collapsed choice not remembered");

step("expand with the keyboard shortcut");
await page.keyboard.press("Control+b");
await settle();
if ((await width()) < 150) throw new Error("Ctrl+B did not expand the sidebar");

step("narrow window without a saved choice starts collapsed");
const narrow = await (await browser.newContext({ viewport: { width: 900, height: 800 } })).newPage();
await narrow.goto(`${BASE}/pipelines`);
await narrow.waitForTimeout(350);
const w = await narrow.locator("nav.sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
if (w > 70) throw new Error(`narrow window sidebar is ${w}px`);
await narrow.screenshot({ path: join(OUT, "shell2-narrow.png") });

await browser.close();
if (errors.length) {
  console.log("console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("✓ shell walkthrough passed with no console errors");
