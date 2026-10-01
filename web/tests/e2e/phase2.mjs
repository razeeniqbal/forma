// Schedule, transformation presets, rule suggestions from review (impact preview), Airflow export.
import { join } from "node:path";
import { OUT, createProject, openPipeline, start, step, workbench } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "p" });
page.on("dialog", (d) => d.accept(d.defaultValue() || "My preset"));

const projectId = await createProject(page, "Phase two", { example: true });
const pid = await openPipeline(page, projectId, "Clean Invoices");

step("schedule weekdays 06:00");
await page.getByRole("button", { name: /^Schedule$/ }).click();
await page.getByRole("button", { name: "Weekdays at 06:00" }).click();
await page.waitForSelector("text=Next runs:");
await shot("schedule");
await page.getByRole("button", { name: "Save schedule" }).click();
await page.getByRole("button", { name: /^Scheduled$/ }).waitFor();

step("save a step as preset and see it in the picker");
await workbench(page, "Analyst");
const trim = page.locator(".step-item", { hasText: "Trim text" }).first();
await trim.hover();
await trim.getByRole("button", { name: "More step actions" }).click();
await page.getByRole("menuitem", { name: /Save as preset/ }).click();
await page.getByRole("button", { name: "Add transformation" }).last().click();
await page.waitForSelector("text=Your presets");
await shot("presets");
await page.keyboard.press("Escape");

step("drop a date format so rows fail, then run");
await page.locator(".step-item", { hasText: "Standardise Created At" }).first().dblclick();
await page.locator('section[aria-label="Edit step"] .chip', { hasText: "MMM DD, YYYY" }).click();
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".run-banner.review").waitFor({ timeout: 20000 });

step("review: rule suggestion with impact preview");
await page.locator(".run-banner").getByRole("link", { name: /review/ }).click();
await page.waitForSelector("text=Accept MMM DD, YYYY");
const row = page.locator("tr", { hasText: "Accept MMM DD, YYYY" });
await row.getByRole("button", { name: "Preview impact" }).click();
await row.getByText(/Resolves/).waitFor({ timeout: 20000 });
const impact = await row.innerText();
await shot("rule-suggestion");
if (!/Resolves \d+/.test(impact) || /Resolves 0 /.test(impact)) throw new Error("impact not shown: " + impact);
await row.getByRole("button", { name: "Apply" }).click();
await page.waitForTimeout(300);

step("export Airflow project");
await page.goto(page.url().replace(/\/runs\/.*/, `/pipelines/${pid}/export`));
await page.waitForSelector("text=Generated Python code");
await page.locator("label.option", { hasText: "Airflow" }).click();
await page.waitForTimeout(800);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download project/ }).first().click()]);
await dl.saveAs(join(OUT, "airflow.zip"));
console.log(`  impact: ${impact.replace(/\s+/g, " ").slice(0, 160)}`);
await finish("phase 2 walkthrough");
