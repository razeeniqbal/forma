// Docs, contextual help, the Add Tool taxonomy, taxonomy search in the palette, and Workbench sections.
import { BASE, createProject, openPipeline, start, step } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "d" });
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

step("Docs: sidebar entry, sections, search, Back / Next");
await page.goto(`${BASE}/projects`);
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs", exact: true }).click();
await page.getByRole("heading", { name: "What is FORMA?" }).waitFor();
for (const s of ["Getting Started", "Pipeline Canvas", "Tools", "Combining Data", "Review", "Execution", "Engineering"]) await page.locator(".docs-section-title", { hasText: s }).first().waitFor();
await page.getByLabel("Search docs").fill("lookup");
await page.locator(".docs-results a", { hasText: "Lookup" }).first().click();
await page.getByRole("heading", { name: "Lookup", exact: true }).waitFor();
await page.locator(".doc-pager-link.next").click();
await page.getByRole("heading", { name: "Append", exact: true }).waitFor();
expect(!(await page.locator(".doc").innerText()).includes(String.fromCharCode(0x2014)), "no em dashes in Docs");
await shot("docs");

step("new pipeline from the example: canvas with + Add Tool");
const projectId = await createProject(page, "Docs", { example: true });
await openPipeline(page, projectId, "Clean Invoices");
await page.getByRole("button", { name: "Add tool" }).click();

step("Add Tool: five categories first, Transform opens its groups");
const dialog = page.getByRole("dialog", { name: "Add tool" });
for (const c of ["Source", "Extract", "Transform", "Validate", "Load"]) await dialog.locator(".palette-item .t", { hasText: new RegExp(`^${c}$`) }).waitFor();
expect((await dialog.locator(".palette-item .t", { hasText: /^Pivot$/ }).count()) === 0, "operations are not all shown at the top level");
await dialog.locator(".palette-item", { hasText: /^Transform/ }).click();
for (const g of ["Clean", "Convert", "Structure", "Reshape", "Combine", "Calculate"]) await dialog.locator(".palette-item .t", { hasText: new RegExp(`^${g}$`) }).waitFor();
await shot("add-tool-transform");

step("Add Tool search shows taxonomy paths");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Add tool" }).click();
await page.getByPlaceholder(/Search tools/).fill("date");
const first = await dialog.locator(".palette-item").first().innerText();
expect(/Transform > Convert > Date/.test(first), "date search starts with Transform > Convert > Date:\n" + first);
await dialog.locator(".palette-item", { hasText: "Validate > Validation rules" }).waitFor();
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

step("command palette understands the taxonomy");
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/Search/).last().fill("pivot");
await page.locator(".palette-item", { hasText: "Transform > Reshape > Pivot" }).first().waitFor();
await page.getByPlaceholder(/Search/).last().fill("fit pipeline");
await page.locator(".palette-item", { hasText: "Fit Pipeline" }).first().waitFor();
await page.keyboard.press("Escape");

step("quick inspector: category, Configure, Open Workbench, contextual docs");
await page.locator(".cnode", { hasText: "Validate invoice" }).first().click();
const side = page.getByRole("complementary", { name: "Step preview" });
await side.getByRole("button", { name: "Configure" }).waitFor();
await side.getByRole("button", { name: "Open Workbench" }).waitFor();
await side.getByRole("link", { name: "Learn about validation" }).click();
await page.getByRole("heading", { name: "Validate", exact: true }).waitFor();
await page.goBack();
await page.locator(".cnode").first().waitFor();

step("returning restores the selected node");
await side.getByRole("button", { name: "Open Workbench" }).waitFor();

step("Workbench for Validate opens Step Configuration and Quality; the rest are collapsed");
await side.getByRole("button", { name: "Open Workbench" }).click();
await page.locator('.wbs.open[data-section="inspector"]').waitFor();
await page.locator('.wbs.open[data-section="quality"]').waitFor();
expect((await page.locator('.wbs.open[data-section="python"]').count()) === 0, "Code starts collapsed");
await page.getByRole("button", { name: /Engineer/ }).click();
await page.locator('.wbs.open[data-section="python"]').waitFor();
await shot("workbench-engineer");

await finish("docs and tools walkthrough");
