// The canonical FORMA journey (PROJECT → SOURCE → PIPELINE → STEP → RUN), end to end in a real browser.
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/journey.mjs [screenshotDir]
import { join } from "node:path";
import { BASE, OUT, SAMPLES, apply, pick, pipelineView, start, step, workbench } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "j" });
const preview = page.locator('section[aria-label="Data preview"]');
const inspector = page.locator('section[aria-label="Step Inspector"], section[aria-label="New transformation"], section[aria-label="Edit step"], section[aria-label="Column details"], section[aria-label="Source"], section[aria-label="Load"]');
const header = (name) => preview.locator(".gh", { hasText: new RegExp(`^\\S*\\s*${name}$`) }).first();
const card = (stage, nth = 0) => page.locator(".cnode", { has: page.locator(".fc-stage", { hasText: new RegExp(`^${stage}$`, "i") }) }).nth(nth);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// 1. Open FORMA
step("1. open FORMA: empty state asks for a first project");
await page.goto(`${BASE}/`);
await page.getByRole("heading", { name: "Create your first project" }).waitFor();
await shot("empty-forma");

// 2. Create Project
step("2. create project “Invoice Processing”");
await page.getByRole("link", { name: "New project" }).first().click();
await page.getByLabel("Project name").fill("Invoice Processing");
await page.getByLabel(/Description/).fill("Clean, validate and standardise invoice data before loading it into the warehouse.");
await page.getByRole("button", { name: "Create Project" }).click();
await page.waitForURL(/\/projects\/proj_[^/]+$/);
const projectId = page.url().split("/projects/")[1];
await page.getByRole("heading", { name: "Start with your data" }).waitFor();
await shot("empty-project");

// 3. Add invoices.xlsx
step("3. add invoices.xlsx");
await page.getByTestId("source-file-input").setInputFiles(join(SAMPLES, "invoices.xlsx"));
await page.waitForURL(/\/sources\?source=/);

// 4–5. Inspect workbook, select Invoices sheet
step("4. inspect the workbook: every sheet is listed");
const list = page.getByRole("listbox", { name: "Project sources" });
for (const s of ["Invoices", "Summary", "Archive"]) await list.getByRole("option", { name: new RegExp(s) }).first().waitFor();
await shot("workbook");
step("5. select the Invoices sheet");
await list.getByRole("option", { name: /^Invoices/ }).click();
await page.locator('[aria-label="Source detail"] h2', { hasText: "/ Invoices" }).waitFor();

// 6. Create pipeline "Clean Invoices"
step("6. create pipeline “Clean Invoices” from the sheet");
await page.locator('[aria-label="Source detail"]').getByRole("link", { name: "Create pipeline", exact: true }).click();
await page.getByRole("radio", { name: /invoices\.xlsx \/ Invoices/, checked: true }).waitFor();
expect((await page.getByLabel("Pipeline name").inputValue()) === "Clean Invoices", "suggested name should be Clean Invoices");
await shot("create-pipeline");
await page.getByRole("button", { name: "Create Pipeline" }).click();
await page.waitForURL(/\/pipelines\/p_/);
const pid = page.url().split("/pipelines/")[1];

// 7. Pipeline view is the default
step("7. pipeline view opens by default: Source → Load");
await card("Source").waitFor();
await card("Load").waitFor();
expect((await card("Source").innerText()).includes("1,001"), "source card shows row count");
await shot("new-pipeline-view");

// Shape the data in the Analyst workbench (direct manipulation), then return.
step("shape the data in the Analyst workbench");
await workbench(page, "Analyst");
await page.waitForSelector(".grid-row");
const srcText = await inspector.first().innerText();
expect(/Row 3/.test(srcText), "header row 3 not detected:\n" + srcText);
await header("Details").click();
await page.locator(".float-bar button", { hasText: "Extract" }).click();
await page.waitForSelector("text=Suggest fields");
await page.waitForTimeout(400);
expect(/rows matched/.test(await inspector.first().innerText()), "no extraction results shown");
await apply(page);
const extractItem = page.locator(".step-item").filter({ hasText: "Extract fields" }).first();
await extractItem.dblclick();
const names = page.locator('input[aria-label="Field name"]');
const wanted = ["invoice_no", "invoice_date", "total"];
for (let i = 0; i < Math.min(await names.count(), 3); i++) await names.nth(i).fill(wanted[i]);
await apply(page);
await header("Created At").click({ button: "right" });
await page.getByRole("menuitem", { name: "Standardise date format" }).click();
await apply(page);
await header("Amount").click();
await page.locator(".float-bar button", { hasText: "Convert" }).click();
await apply(page);
await header("Customer").click();
await page.locator(".float-bar button", { hasText: "Clean" }).click();
await apply(page);
await page.keyboard.press("Escape");
await pick(page, "validate");
await apply(page);

step("undo + redo");
const before = await page.locator(".step-item").count();
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const undone = await page.locator(".step-item").count();
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(200);
expect(undone === before - 1 && (await page.locator(".step-item").count()) === before, `undo/redo mismatch ${before}/${undone}`);

// 8. See the pipeline
step("8. back in pipeline view: Source → Extract → Transform → Validate → Load");
await pipelineView(page);
const stages = (await page.locator(".fc-stage").allInnerTexts()).map((s) => s.trim().toUpperCase());
expect(stages[0] === "SOURCE" && stages.at(-1) === "LOAD", `flow order: ${stages}`);
for (const s of ["EXTRACT", "TRANSFORM", "VALIDATE"]) expect(stages.includes(s), `missing ${s} in ${stages}`);
expect(stages.indexOf("EXTRACT") < stages.indexOf("VALIDATE"), `extract before validate: ${stages}`);
await shot("pipeline-view");

// 9–10. Click Extract → quick preview
step("9–10. click Extract: quick preview with input → output");
await card("Extract").click();
const side = page.getByRole("complementary", { name: "Step preview" });
await side.getByText("Input").first().waitFor();
const sideText = await side.innerText();
expect(/INV-\d+/.test(sideText), "preview shows an extracted invoice number:\n" + sideText);
expect(/ready/.test(sideText) && /review/.test(sideText), "preview shows ready / review counts");
await shot("step-preview");

// 11–12. Expand → workbench on that step
step("11–12. open Extract in the Workbench: only the sections that matter are open");
await side.getByRole("button", { name: "Open Workbench" }).click();
await page.locator(".stp.on", { hasText: "Extract" }).waitFor();
await page.locator('.wbs.open[data-section="preview"]').waitFor();
expect((await page.locator('.wbs.open[data-section="quality"]').count()) === 0, "Quality starts collapsed for Extract");
await page.locator('.wbs[data-section="beforeAfter"] .wbs-head').click();
await page.locator('section[aria-label="Before / After"]').waitFor();
expect((await inspector.first().innerText()).includes("Extract"), "inspector shows the expanded step");
await shot("expanded-step");

// 13. Return to pipeline view
step("13. return to pipeline view");
await page.getByRole("button", { name: "Pipeline view" }).click();
await card("Source").waitFor();

// 14–16. Run and watch
step("14–15. run the pipeline and watch it progress");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".cnode.running").first().waitFor({ timeout: 5000 });
await page.locator(".run-banner.running").waitFor();
await shot("running");
await page.locator(".run-banner.review, .run-banner.success").waitFor({ timeout: 20000 });
const banner = await page.locator(".run-banner").innerText();
step(`16. ${banner.replace(/\s+/g, " ").trim()}`);
expect(/1,001\s+input/.test(banner) && /ready/.test(banner) && /\d+ review/.test(banner), "banner tells what happened: " + banner);
const extractCard = await card("Extract").innerText();
expect(/ready/.test(extractCard) && /review/.test(extractCard), "extract card shows its impact: " + extractCard);
await shot("run-complete");

// 17. Open review items for one step
step("17. open the review items of the Validate step");
await card("Validate").getByRole("link", { name: /review/ }).click();
await page.waitForURL(/\/runs\/run_.+\/review\?step=/);
await page.getByRole("button", { name: "Clear step filter" }).waitFor();
await page.waitForSelector("text=Review selected row");
await shot("review-filtered");

// 18. Resolve
step("18. resolve a row");
await page.getByText("Exclude row", { exact: true }).click();
await page.getByRole("button", { name: "Apply decision" }).click();
await page.waitForTimeout(300);

// 19. Rerun → watched in pipeline view
step("19. rerun from the review queue");
await page.getByRole("button", { name: /Rerun with 1 decision/ }).click();
await page.waitForURL(new RegExp(`/pipelines/${pid}$`));
await page.locator(".run-banner.review, .run-banner.success").waitFor({ timeout: 20000 });
const banner2 = await page.locator(".run-banner").innerText();
expect(/Showing run of v2/.test(await page.locator(".flow-basis").innerText()), "rerun created v2");

// 20. Inspect output
step("20. inspect the output of the run");
await page.locator(".run-banner").getByRole("link", { name: "View run" }).click();
await page.waitForURL(/\/runs\/run_/);
await page.getByRole("button", { name: /View output data/ }).click();
await page.waitForSelector(".modal .grid-row");
await shot("output");
await page.keyboard.press("Escape");
const crumbs = await page.locator(".crumbs").innerText();
expect(crumbs.includes("Invoice Processing"), "run breadcrumbs start at the project: " + crumbs);

// 21–22. Engineer view → generated Python
step("21–22. engineer view shows the generated Python");
await page.goto(`${BASE}/pipelines/${pid}`);
await workbench(page, "Engineer");
await page.waitForFunction(() => /def step_\d+/.test(document.querySelector('section[aria-label="Python code"]')?.textContent ?? ""));
await shot("engineer");

// 23. Export
step("23. export the pipeline");
await page.goto(`${BASE}/pipelines/${pid}/export`);
await page.waitForSelector("text=Generated Python code");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download project/ }).first().click()]);
await dl.saveAs(join(OUT, dl.suggestedFilename()));

// Project is the home of it all.
step("project overview maps source → pipeline → output; runs are listed under the project");
await page.goto(`${BASE}/projects/${projectId}`);
await page.locator(".pmap-node.pipe", { hasText: "Clean Invoices" }).waitFor();
expect((await page.locator(".pmap-wires path").count()) >= 2, "map draws source → pipeline → output");
await shot("overview");
await page.goto(`${BASE}/projects/${projectId}/runs`);
expect((await page.locator("tbody tr").count()) === 2, "two runs in the project");

step("command palette finds the pipeline");
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/Search/).last().fill("clean");
await page.locator(".palette-item", { hasText: "Clean Invoices" }).first().waitFor();
await page.keyboard.press("Escape");

console.log(`  first run: ${banner.replace(/\s+/g, " ").trim()}`);
console.log(`  rerun:     ${banner2.replace(/\s+/g, " ").trim()}`);
await finish("journey");
