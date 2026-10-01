// Lookup from a project source, group by, run, export.
import { join } from "node:path";
import { OUT, apply, createProject, openPipeline, pick, start, step, workbench } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "r" });

step("example project: invoices + customers, Clean Invoices pipeline");
const projectId = await createProject(page, "Reshape", { example: true });
const pid = await openPipeline(page, projectId, "Clean Invoices");
await workbench(page, "Analyst");

step("lookup region / tier from the project source customers.csv");
await pick(page, "lookup");
const panel = page.locator('section[aria-label="New transformation"]');
await panel.getByText("Lookup from · project sources").waitFor();
await panel.getByRole("radio", { name: /customers\.csv/ }).click();
await panel.getByText("Columns to bring in").waitFor();
await page.waitForTimeout(500);
const text = await panel.innerText();
if (!/19 rows · 4 columns/.test(text)) throw new Error("customers.csv not loaded:\n" + text);
if (!/Clean Invoices[\s\S]*customers/.test(text)) throw new Error("key mapping names both sides:\n" + text);
await shot("lookup");
await apply(page);

step("group by region");
await pick(page, "group");
await panel.locator("label", { hasText: /^customer$/ }).first().locator("input").uncheck();
await panel.locator("label", { hasText: /^region$/ }).first().locator("input").check();
await page.waitForTimeout(400);
await apply(page);
const preview = await page.locator('section[aria-label="Data preview"]').innerText();
if (!/region/.test(preview) || !/row_count/.test(preview)) throw new Error("group output missing:\n" + preview.slice(0, 400));

step("run from the pipeline view");
await page.getByRole("button", { name: "Pipeline view" }).click();
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".run-banner.review, .run-banner.success, .run-banner.failed").waitFor({ timeout: 20000 });
if (await page.locator(".flow-card.failed").count()) throw new Error("a step failed");
const combine = await page.locator(".flow-card", { hasText: "Lookup" }).first().innerText();
await shot("run");

step("export project");
await page.goto(page.url().replace(/\/pipelines\/.*/, `/pipelines/${pid}/export`));
await page.waitForSelector("text=Generated Python code");
await page.waitForTimeout(800);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download project/ }).first().click()]);
await dl.saveAs(join(OUT, dl.suggestedFilename()));
console.log(`  lookup card: ${combine.replace(/\s+/g, " ")}`);
await finish("reshape walkthrough");
