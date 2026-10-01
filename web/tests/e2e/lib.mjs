// Shared helpers for the browser walkthroughs.
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/<name>.mjs [screenshotDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const OUT = process.argv[2] ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
export const BASE = process.env.FORMA_URL ?? "http://localhost:4173";
export const SAMPLES = resolve(import.meta.dirname, "..", "..", "public", "samples");

export async function start({ width = 1600, height = 940, prefix = "" } = {}) {
  const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  let n = 0;
  const shot = (name) => page.screenshot({ path: join(OUT, `${prefix}${String(++n).padStart(2, "0")}-${name}.png`) });
  const finish = async (label) => {
    await browser.close();
    if (errors.length) {
      console.log("console errors:\n" + errors.join("\n"));
      process.exit(1);
    }
    console.log(`✓ ${label} passed with no console errors`);
  };
  return { browser, ctx, page, errors, shot, finish };
}

export const step = (m) => console.log(`• ${m}`);

/** Creates a project through the UI; with `example` it gets the sample sources and the "Clean Invoices" pipeline. */
export async function createProject(page, name, { example = false, description = "" } = {}) {
  await page.goto(`${BASE}/projects/new`);
  await page.getByLabel("Project name").fill(name);
  if (description) await page.getByLabel(/Description/).fill(description);
  if (example) await page.getByText("Start from example").click();
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.waitForURL(/\/projects\/proj_[^/]+$/);
  return page.url().split("/projects/")[1];
}

/** Opens a pipeline of the current project by name from its Pipelines list. */
export async function openPipeline(page, projectId, name) {
  // In-app navigation when already inside the project (no reload while the app may still be saving).
  if (page.url().includes(`/projects/${projectId}`) || page.url().includes("/pipelines/")) await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pipelines", exact: true }).click();
  else await page.goto(`${BASE}/projects/${projectId}/pipelines`);
  await page.getByRole("link", { name, exact: true }).first().click();
  await page.waitForURL(/\/pipelines\/p_/);
  await page.locator(".cnode, .grid-row").first().waitFor();
  return page.url().split("/pipelines/")[1].split(/[?/]/)[0];
}

/** Switches the open pipeline to a workbench view ("Analyst", "Engineer", …). */
export async function workbench(page, view) {
  await page.getByRole("button", { name: "Workbench views" }).click();
  await page.getByRole("menuitem", { name: `${view} view` }).click();
  await page.locator(".grid-row, .panel").first().waitFor();
}

export async function pipelineView(page) {
  await page.getByRole("button", { name: /Pipeline view|^Pipeline$/ }).first().click();
  await page.locator(".cnode").first().waitFor();
}

/** Opens the transformation picker and chooses the first match for `q`. */
export async function pick(page, q) {
  await page.getByRole("button", { name: "Add transformation" }).last().click();
  await page.getByPlaceholder(/Search transformations|Add transformation/).fill(q);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
}

export async function apply(page) {
  await page.getByRole("button", { name: /Apply transformation|Save changes/ }).click();
  await page.waitForTimeout(350);
}

/** Starts a run from the pipeline header and waits for the live run to finish. */
export async function runAndWatch(page, { where } = {}) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  if (where) await page.locator(".modal .seg button", { hasText: where }).click();
  await page.getByRole("button", { name: /Run v\d+/ }).click();
}
