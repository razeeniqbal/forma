// Workbook sheets as project sources: inspect, pipeline per sheet, switch sheets, append another sheet.
import { join } from "node:path";
import { OUT, SAMPLES, apply, createProject, start, step } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "s" });
const expect = (c, m) => {
  if (!c) throw new Error(m);
};

step("project with one three-sheet workbook");
const projectId = await createProject(page, "Workbook project");
await page.getByTestId("source-file-input").setInputFiles(join(SAMPLES, "invoices.xlsx"));
await page.waitForURL(/\/sources\?source=/);
const list = page.getByRole("listbox", { name: "Project sources" });
for (const s of ["Invoices", "Summary", "Archive"]) await list.getByRole("option", { name: new RegExp(`^${s}`) }).waitFor();

step("sheet detail: rows / columns of the Archive sheet");
await list.getByRole("option", { name: /^Archive/ }).click();
const detail = page.locator('[aria-label="Source detail"]');
await detail.locator("h2", { hasText: "/ Archive" }).waitFor();
const dt = await detail.innerText();
expect(/Rows\s+25/.test(dt) && /Columns\s+5/.test(dt), "Archive sheet metadata:\n" + dt);
await shot("sheet-detail");

step("create a pipeline straight from the Summary sheet row");
await detail.getByRole("link", { name: "Create pipeline from Summary" }).click();
await page.getByRole("radio", { name: /Summary/, checked: true }).waitFor();
await page.getByRole("button", { name: "Create Pipeline" }).click();
await page.waitForURL(/\/pipelines\/p_/);
await page.locator(".flow-card", { hasText: "invoices.xlsx / Summary" }).waitFor();

step("switch the pipeline to the Archive sheet from the source preview");
await page.locator(".flow-card", { hasText: "Source" }).first().click();
const sheetSelect = page.getByRole("complementary", { name: "Step preview" }).getByLabel("Source sheet");
await sheetSelect.selectOption("Archive");
await page.locator(".flow-card", { hasText: "invoices.xlsx / Archive" }).waitFor();
await page.locator(".flow-card", { hasText: "25 rows" }).first().waitFor();
await shot("switched");

step("one pipeline per sheet");
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sources", exact: true }).click();
await page.getByRole("listbox", { name: "Project sources" }).getByRole("option", { name: /invoices\.xlsx/ }).click();
await page.getByRole("button", { name: "One pipeline per sheet" }).click();
await page.waitForURL(/\/pipelines$/);
for (const s of ["Invoices", "Summary", "Archive"]) await page.getByRole("link", { name: `invoices – ${s}`, exact: true }).waitFor();
expect((await page.locator("tbody tr").count()) === 4, "four pipelines in the project");

step("append the Archive sheet to the Invoices pipeline via “Use in pipeline”");
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sources", exact: true }).click();
await page.getByRole("listbox", { name: "Project sources" }).getByRole("option", { name: /^Archive/ }).click();
await page.locator('[aria-label="Source detail"]').getByRole("button", { name: /Use in pipeline/ }).click();
await page.getByRole("menuitem", { name: "Append to invoices – Invoices" }).click();
await page.waitForURL(/\/pipelines\/p_/);
await page.getByRole("radio", { name: /Archive/, checked: true }).waitFor();
await shot("append-draft");
await apply(page);
await page.waitForFunction(() => [...document.querySelectorAll(".flow-card")].some((c) => /Combine/i.test(c.textContent ?? "") && /1,026/.test(c.textContent ?? "")));
await shot("appended");

step("sources list shows which pipelines read each sheet");
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sources", exact: true }).click();
await page.getByRole("listbox", { name: "Project sources" }).getByRole("option", { name: /invoices\.xlsx/ }).click();
const sheetsTable = await page.locator('[aria-label="Source detail"] table').innerText();
expect(/Archive[\s\S]*invoices – Archive, invoices – Invoices|Archive[\s\S]*invoices – Invoices/.test(sheetsTable), "Archive used by the appending pipeline:\n" + sheetsTable);
console.log(`  project ${projectId}`);
await finish("sheets walkthrough");
