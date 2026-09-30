// Browser walkthrough with a running FORMA server:
//   python -m forma_server --port 8787   (with WAREHOUSE_URL pointing at a database that has an "invoices" table)
//   npm run build && npx vite preview --port 4173 &
//   node tests/e2e/server.mjs [dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
const SERVER = process.env.FORMA_SERVER ?? "http://127.0.0.1:8787";
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 940 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
const step = (m) => console.log(`• ${m}`);

step("connect the server in Settings");
await page.goto(`${BASE}/settings`);
await page.getByPlaceholder("http://localhost:8787").fill(SERVER);
await page.getByRole("button", { name: /Save & test/ }).click();
await page.getByText(/Connected · v/).waitFor();

step("create a pipeline from a database query");
await page.goto(`${BASE}/pipelines/new`);
const dbCard = page.locator("button.option", { hasText: "Database" });
await page.waitForFunction(() => ![...document.querySelectorAll("button.option")].some((b) => b.textContent.includes("Needs server")));
await dbCard.click();
await page.locator(".modal textarea").fill("select * from invoices order by invoice_no");
await page.getByPlaceholder("Source name (optional)").fill("warehouse invoices");
await page.getByRole("button", { name: /Fetch preview/ }).click();
await page.getByText(/300 rows · 5 columns/).waitFor();
await page.screenshot({ path: join(OUT, "s1-db-source.png") });
await page.getByRole("button", { name: "Use this source" }).click();
await page.waitForURL(/\/pipelines\/p_/);
await page.waitForSelector(".grid-row");

step("add a trim step, then run on the FORMA server");
await page.locator('section[aria-label="Data preview"] .gh', { hasText: "status" }).click();
await page.locator(".float-bar button", { hasText: "Clean" }).click();
await page.getByRole("button", { name: /Apply transformation/ }).click();
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByText("FORMA server", { exact: true }).waitFor();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.waitForURL(/\/runs\/run_srv_/);
await page.getByText(/^Success$|Completed with review items/).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "s2-server-run.png") });
const runText = await page.locator("body").innerText();
if (!/300/.test(runText)) throw new Error("server run summary missing row counts");

step("schedule on the server");
await page.locator('.crumbs a[href^="/pipelines/"]').first().click();
await page.getByRole("button", { name: /^Schedule$/ }).click();
await page.getByRole("button", { name: "Every day at 06:00" }).click();
await page.getByRole("button", { name: "Save schedule" }).click();
await page.getByText(/Scheduled on the FORMA server/).waitFor({ timeout: 15000 });

step("runs page lists server runs");
await page.goto(`${BASE}/runs`);
await page.locator(".badge", { hasText: "Server" }).first().waitFor();
await page.screenshot({ path: join(OUT, "s3-runs.png") });
await browser.close();
if (errors.length) {
  console.log("console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("✓ server walkthrough passed with no console errors");
