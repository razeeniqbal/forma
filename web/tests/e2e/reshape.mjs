// Browser walkthrough: lookup against a second file, group by, run, export.
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/reshape.mjs [dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
const step = (m) => console.log(`• ${m}`);
const pick = async (q) => {
  await page.getByRole("button", { name: "Add transformation" }).last().click();
  await page.getByPlaceholder(/Search transformations|Add transformation/).fill(q);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
};
const apply = async () => {
  await page.getByRole("button", { name: /Apply transformation/ }).click();
  await page.waitForTimeout(400);
};

step("open invoice demo");
await page.goto(`${BASE}/pipelines`);
await page.getByRole("button", { name: /Invoice demo/ }).first().click();
await page.waitForURL(/\/pipelines\/p_/);
await page.waitForSelector(".grid-row");

step("lookup region/tier from customers.csv");
await pick("lookup");
await page.locator('section[aria-label="New transformation"] input[type=file]').setInputFiles(resolve("public/samples/customers.csv"));
await page.waitForSelector("text=Columns to bring in");
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "r1-lookup.png") });
const insp = await page.locator('section[aria-label="New transformation"]').innerText();
if (!/rows · 4 columns/.test(insp)) throw new Error("customers.csv not loaded:\n" + insp);
await apply();

step("group by region");
await pick("group");
const panel = page.locator('section[aria-label="New transformation"]');
await panel.locator("label", { hasText: /^customer$/ }).first().locator("input").uncheck();
await panel.locator("label", { hasText: /^region$/ }).first().locator("input").check();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "r2-group.png") });
await apply();
const preview = await page.locator('section[aria-label="Data preview"]').innerText();
if (!/region/.test(preview) || !/row_count/.test(preview)) throw new Error("group output missing:\n" + preview.slice(0, 400));

step("run");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.waitForURL(/\/runs\/run_/);
await page.waitForSelector("text=Execution timeline");
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "r3-run.png") });
const runText = await page.locator("body").innerText();
if (/Failed/.test(runText.split("Step details")[1]?.split("Run log")[0] ?? "")) throw new Error("a step failed");

step("export project");
const pid = (await page.locator('.crumbs a[href^="/pipelines/"]').first().getAttribute("href")).split("/")[2];
await page.goto(`${BASE}/pipelines/${pid}/export`);
await page.waitForSelector("text=Generated Python code");
await page.waitForTimeout(1200);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download project/ }).first().click()]);
const zip = join(OUT, dl.suggestedFilename());
await dl.saveAs(zip);
console.log(`project zip: ${zip}`);
await browser.close();
if (errors.length) {
  console.log("console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("✓ reshape walkthrough passed with no console errors");
