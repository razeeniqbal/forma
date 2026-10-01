// Multi-sheet workbooks: every sheet is its own source.
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/sheets.mjs [screenshotDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 940 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
const step = (m) => console.log(`• ${m}`);
const preview = page.locator('section[aria-label="Data preview"]');
const sheetSelect = preview.getByLabel("Source sheet");

step("upload a three-sheet workbook and pick the Archive sheet");
await page.goto(`${BASE}/pipelines/new`);
await page.locator('input[type="file"]').setInputFiles(join(import.meta.dirname, "..", "..", "public", "samples", "invoices.xlsx"));
const chooser = page.getByRole("dialog");
await chooser.getByText("Choose a sheet").waitFor();
for (const s of ["Invoices", "Summary", "Archive"]) await chooser.getByRole("radio", { name: new RegExp(s) }).waitFor();
await chooser.getByRole("radio", { name: /Archive/ }).click();
await page.screenshot({ path: join(OUT, "sh1-chooser.png") });
await chooser.getByRole("button", { name: "Use “Archive”" }).click();
await page.waitForURL(/\/pipelines\/p_/);
await page.waitForSelector(".grid-row");
if ((await sheetSelect.inputValue()) !== "Archive") throw new Error("pipeline does not read the Archive sheet");
if (!/25 rows/.test(await preview.innerText())) throw new Error("Archive preview should show 25 rows");
const pageText = () => page.evaluate(() => document.body.innerText + [...document.querySelectorAll("input")].map((i) => i.value).join(" "));
if (!/Invoices – Archive/.test(await pageText())) throw new Error("pipeline not named after its sheet");
await page.screenshot({ path: join(OUT, "sh2-archive.png") });

step("switch the pipeline to the Invoices sheet from the preview header");
await sheetSelect.selectOption("Invoices");
await page.waitForFunction(() => /(1,0\d\d|9\d\d) rows/.test(document.querySelector('section[aria-label="Data preview"]')?.textContent ?? ""));
await page.screenshot({ path: join(OUT, "sh3-switched.png") });

step("one pipeline per sheet");
await page.goto(`${BASE}/pipelines/new`);
await page.getByRole("button", { name: "Use this source" }).first().click();
await chooser.getByRole("button", { name: /One pipeline per sheet \(3\)/ }).click();
await page.waitForURL(/\/pipelines$/);
for (const s of ["Invoices", "Summary", "Archive"]) await page.getByText(`Invoices – ${s}`).first().waitFor();

step("sources page lists each sheet as its own source");
await page.goto(`${BASE}/sources`);
const subRows = page.locator("tr.sub-row");
await subRows.first().waitFor();
if ((await subRows.count()) !== 3) throw new Error(`expected 3 sheet rows, got ${await subRows.count()}`);
// pipelines created just before the reload were saved, and are listed under the sheet they read
if (!/Invoices – Summary/.test(await subRows.nth(1).innerText())) throw new Error("Summary row does not list its pipeline");
await page.getByRole("button", { name: "New pipeline from Summary" }).first().click();
await page.waitForURL(/\/pipelines\/p_/);
await page.waitForSelector(".grid-row");
if ((await sheetSelect.inputValue()) !== "Summary") throw new Error("pipeline from the Summary row does not read Summary");
await page.goto(`${BASE}/sources`);
await subRows.first().waitFor();
await page.screenshot({ path: join(OUT, "sh4-sources.png") });

await browser.close();
if (errors.length) {
  console.log("console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("✓ sheets walkthrough passed with no console errors");
