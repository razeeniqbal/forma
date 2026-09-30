// End-to-end walkthrough of the PRD §25 acceptance scenario in a real browser.
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/acceptance.mjs [screenshotDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
let n = 0;
const shot = async (name) => page.screenshot({ path: join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`) });
const step = (msg) => console.log(`• ${msg}`);
const preview = page.locator('section[aria-label="Data preview"]');
const inspector = page.locator('section[aria-label="Step Inspector"], section[aria-label="New transformation"], section[aria-label="Edit step"], section[aria-label="Column details"], section[aria-label="Source"], section[aria-label="Load"]');
const header = (name) => preview.locator(".gh", { hasText: new RegExp(`^\\S*\\s*${name}$`) }).first();
const apply = async () => {
  await page.getByRole("button", { name: /Apply transformation|Save changes/ }).click();
  await page.waitForTimeout(300);
};

// 1. upload the workbook (sample)
step("create pipeline from sample workbook");
await page.goto(`${BASE}/pipelines/new`);
await page.getByRole("button", { name: "Use sample invoices" }).click();
await page.waitForURL(/\/pipelines\/p_/);
await page.waitForSelector(".grid-row");
await shot("workspace-source");

// 2. inspect detected sheet and region
step("inspect detected region");
const srcText = await inspector.first().innerText();
if (!/Row 3/.test(srcText)) throw new Error("header row 3 not detected:\n" + srcText);

// 3-5. select Details, extract fields, preview success/failures
step("select Details → Extract");
await header("Details").click();
await page.locator(".float-bar button", { hasText: "Extract" }).click();
await page.waitForSelector("text=Suggest fields");
await page.waitForTimeout(400);
await shot("extract-editor");
const extractText = await inspector.first().innerText();
if (!/rows matched/.test(extractText)) throw new Error("no extraction results shown");
await apply();

// rename generic suggested field names so they match the scenario
step("name extracted fields invoice_no / invoice_date / total");
const lastStep = page.locator(".step-item").filter({ hasText: "Extract fields" }).first();
await lastStep.dblclick();
const names = page.locator('input[aria-label="Field name"]');
const count = await names.count();
const wanted = ["invoice_no", "invoice_date", "total"];
for (let i = 0; i < Math.min(count, 3); i++) await names.nth(i).fill(wanted[i]);
await apply();

// 6. standardise the date (context menu on Created At)
step("standardise Created At");
await header("Created At").click({ button: "right" });
await page.getByRole("menuitem", { name: "Standardise date format" }).click();
await page.waitForTimeout(300);
await shot("standardise-date");
await apply();

// 7. convert amount to number
step("convert Amount");
await header("Amount").click();
await page.locator(".float-bar button", { hasText: "Convert" }).click();
await apply();

// 8. clean text fields
step("trim Customer");
await header("Customer").click();
await page.locator(".float-bar button", { hasText: "Clean" }).click();
await apply();

// 9. validate via the transformation picker
step("add validation rules via picker");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Add transformation" }).last().click();
await page.getByPlaceholder(/Search transformations|Add transformation/).fill("validate");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
await shot("validate-editor");
await apply();

// undo / redo
step("undo + redo");
const stepsBefore = await page.locator(".step-item").count();
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const stepsUndo = await page.locator(".step-item").count();
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(200);
if (stepsUndo !== stepsBefore - 1 || (await page.locator(".step-item").count()) !== stepsBefore) throw new Error(`undo/redo mismatch ${stepsBefore}/${stepsUndo}`);

// engineer preset
step("engineer workspace preset");
await page.getByRole("button", { name: /Analyst/ }).first().click();
await page.getByRole("menuitem", { name: "Engineer" }).click();
await page.waitForTimeout(500);
await shot("engineer-preset");

// 11. run
step("run pipeline");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.waitForURL(/\/runs\/run_/);
await page.waitForSelector("text=Execution timeline");
await page.waitForTimeout(500);
await shot("run-summary");
const runText = await page.locator("body").innerText();

// 13. inspect output
step("view output data");
await page.getByRole("button", { name: /View output data/ }).click();
await page.waitForSelector(".modal .grid-row");
await shot("output-data");
await page.keyboard.press("Escape");

// 10. review invalid rows
step("review queue: exclude one row");
await page.getByRole("link", { name: /Review \d+ rows/ }).first().click();
await page.waitForSelector("text=Review selected row");
await shot("review-queue");
await page.getByText("Exclude row", { exact: true }).click();
await page.getByRole("button", { name: "Apply decision" }).click();
await page.waitForTimeout(300);

// validation page
step("validation page");
const pid = (await page.locator('.crumbs a[href^="/pipelines/"]').first().getAttribute("href")).split("/")[2];
await page.goto(`${BASE}/pipelines/${pid}/validate`);
await page.waitForSelector("text=Validation health");
await page.waitForTimeout(800);
await shot("validate-page");

// 14-15. generated Python + export project
step("export project");
await page.goto(`${BASE}/pipelines/${pid}/export`);
await page.waitForSelector("text=Generated Python code");
await page.waitForTimeout(800);
await shot("export");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download project/ }).first().click()]);
const zipPath = join(OUT, dl.suggestedFilename());
await dl.saveAs(zipPath);

// command palette
step("command palette");
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/Search pipelines/).fill("runs");
await shot("palette");
await page.keyboard.press("Escape");

await browser.close();
console.log(`\nrun page: ${/Completed with review items|Success/.exec(runText)?.[0] ?? "?"}`);
console.log(`project zip: ${zipPath}`);
if (errors.length) {
  console.log("\nconsole errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("✓ acceptance walkthrough passed with no console errors");
