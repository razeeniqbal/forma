// Browser walkthrough: schedule, presets, rule suggestions from review, Airflow export.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept(d.defaultValue() || "My preset"));
const step = (m) => console.log(`• ${m}`);

step("open invoice demo");
await page.goto(`${BASE}/pipelines`);
await page.getByRole("button", { name: /Invoice demo/ }).first().click();
await page.waitForURL(/\/pipelines\/p_/);
await page.waitForSelector(".grid-row");

step("schedule weekdays 06:00");
await page.getByRole("button", { name: /^Schedule$/ }).click();
await page.getByRole("button", { name: "Weekdays at 06:00" }).click();
await page.waitForSelector("text=Next runs:");
await page.screenshot({ path: join(OUT, "p1-schedule.png") });
await page.getByRole("button", { name: "Save schedule" }).click();
await page.getByRole("button", { name: /^Scheduled$/ }).waitFor();

step("save a step as preset and see it in the picker");
const trim = page.locator(".step-item", { hasText: "Trim text" }).first();
await trim.hover();
await trim.getByRole("button", { name: "More step actions" }).click();
await page.getByRole("menuitem", { name: /Save as preset/ }).click();
await page.getByRole("button", { name: "Add transformation" }).last().click();
await page.waitForSelector("text=Your presets");
await page.screenshot({ path: join(OUT, "p2-presets.png") });
await page.keyboard.press("Escape");

step("drop a date format so rows fail, then run");
await page.locator(".step-item", { hasText: "Standardise Created At" }).first().dblclick();
await page.locator('section[aria-label="Edit step"] .chip', { hasText: "MMM DD, YYYY" }).click();
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.waitForURL(/\/runs\/run_/);

step("review: rule suggestion with impact preview");
await page.getByRole("link", { name: /Review \d+ rows/ }).first().click();
await page.waitForSelector("text=Accept MMM DD, YYYY");
const row = page.locator("tr", { hasText: "Accept MMM DD, YYYY" });
await row.getByRole("button", { name: "Preview impact" }).click();
await row.getByText(/Resolves/).waitFor({ timeout: 20000 });
const impact = await row.innerText();
await page.screenshot({ path: join(OUT, "p3-rule-suggestion.png") });
if (!/Resolves \d+/.test(impact) || /Resolves 0 /.test(impact)) throw new Error("impact not shown: " + impact);
await row.getByRole("button", { name: "Apply" }).click();
await page.waitForTimeout(300);

step("export Airflow project");
const pid = (await page.locator('.crumbs a[href^="/pipelines/"]').first().getAttribute("href")).split("/")[2];
await page.goto(`${BASE}/pipelines/${pid}/export`);
await page.waitForSelector("text=Generated Python code");
await page.locator("label.option", { hasText: "Airflow" }).click();
await page.waitForTimeout(1000);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download project/ }).first().click()]);
const zip = join(OUT, "airflow.zip");
await dl.saveAs(zip);
console.log(`impact: ${impact.replace(/\s+/g, " ").slice(0, 160)}`);
console.log(`zip: ${zip}`);
await browser.close();
if (errors.length) {
  console.log("console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("✓ phase 2 walkthrough passed with no console errors");
