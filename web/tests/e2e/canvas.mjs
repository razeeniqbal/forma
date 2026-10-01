// Pipeline canvas: position is visual, connection is logical, execution is deterministic.
import { BASE, createProject, openPipeline, start, step, workbench } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "c" });
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const node = (text) => page.locator(".react-flow__node", { has: page.locator(".cnode", { hasText: text }) }).first();
const transformOf = (loc) => loc.evaluate((el) => el.style.transform);
const viewport = () => page.locator(".react-flow__viewport").evaluate((el) => el.style.transform);
const preview = page.getByRole("complementary", { name: "Step preview" });
const drag = async (loc, dx, dy) => {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 12);
  await page.mouse.down();
  await page.mouse.move(b.x + 20 + dx / 2, b.y + 12 + dy / 2, { steps: 6 });
  await page.mouse.move(b.x + 20 + dx, b.y + 12 + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
};

const projectId = await createProject(page, "Canvas", { example: true });
const pid = await openPipeline(page, projectId, "Clean Invoices");

step("every step of the PipelineSpec is a node; connections are derived");
const nodes = await page.locator(".react-flow__node").count();
expect(nodes === 11, `expected 11 nodes (source, 9 steps, destination), got ${nodes}`);
expect((await page.locator(".react-flow__edge").count()) === 10, "10 flow connections");
expect((await page.locator(".react-flow__handle.connectable").count()) === 0, "no connectable ports while execution is ordered");
await shot("canvas");

step("record the run result and the generated Python before moving anything");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".cnode.running").first().waitFor({ timeout: 5000 });
await page.locator(".react-flow__edge-path.cedge.active").first().waitFor({ timeout: 5000 });
await page.locator(".run-banner.review, .run-banner.success").waitFor({ timeout: 20000 });
const bannerBefore = (await page.locator(".run-banner").innerText()).replace(/\s+/g, " ").replace(/ · \d+ ms/, "");
const cardsBefore = await page.locator(".cnode .fc-metrics").allInnerTexts();
const pythonOf = async () => {
  await page.goto(`${BASE}/pipelines/${pid}/export`);
  await page.waitForSelector("text=Generated Python code");
  // The header records when the file was generated; everything else must match exactly.
  return (await page.locator(".code").first().innerText()).replace(/Generated on: .*/, "");
};
const pyBefore = await pythonOf();
await page.goto(`${BASE}/pipelines/${pid}`);
await page.locator(".cnode").first().waitFor();

step("drag a node: it moves, no preview opens, the spec does not change");
const validate = node("Validate invoice");
const t0 = await transformOf(validate);
await drag(validate, 160, 230);
const t1 = await transformOf(validate);
expect(t0 !== t1, "node moved");
expect((await preview.count()) === 0, "dragging must not open the preview");
expect((await page.locator(".ws-head .badge", { hasText: "Draft" }).count()) === 0, "moving a node does not create a draft");

step("move every node somewhere else");
for (const n of await page.locator(".react-flow__node").all()) await drag(n, Math.round(Math.random() * 200 - 100), Math.round(Math.random() * 160 - 80));
const layout = await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.style.transform));
await shot("moved");

step("positions and viewport persist across a reload");
const pane = await page.locator(".react-flow__pane").boundingBox();
await page.mouse.move(pane.x + pane.width - 60, pane.y + pane.height - 120);
await page.mouse.down();
await page.mouse.move(pane.x + pane.width - 160, pane.y + pane.height - 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(500);
const vp = await viewport();
await page.reload();
await page.locator(".cnode").first().waitFor();
await page.waitForTimeout(300);
expect((await viewport()) === vp, `viewport restored (${vp} vs ${await viewport()})`);
expect(JSON.stringify(await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.style.transform))) === JSON.stringify(layout), "layout restored");

step("run again: identical result; generated Python identical");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".run-banner.review, .run-banner.success").waitFor({ timeout: 20000 });
await page.waitForFunction(() => !document.querySelector(".cnode.running, .cnode.pending"));
const bannerAfter = (await page.locator(".run-banner").innerText()).replace(/\s+/g, " ").replace(/ · \d+ ms/, "");
expect(bannerAfter === bannerBefore, `run result changed: ${bannerBefore} / ${bannerAfter}`);
const cardsAfter = await page.locator(".cnode .fc-metrics").allInnerTexts();
const strip = (xs) => xs.map((x) => x.replace(/\d+ ms/g, ""));
expect(JSON.stringify(strip(cardsAfter)) === JSON.stringify(strip(cardsBefore)), "per-step results changed after moving nodes");
const vpBeforeExport = await viewport();
const pyAfter = await pythonOf();
expect(pyAfter === pyBefore, "generated Python changed after moving nodes");
await page.goto(`${BASE}/pipelines/${pid}`);
await page.locator(".cnode").first().waitFor();

step("fit pipeline brings every node into view");
await page.getByRole("button", { name: "Fit pipeline" }).click();
await page.waitForTimeout(400);
const box = await page.locator(".pcanvas").boundingBox();
for (const b of await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())))
  expect(b.left >= box.x - 1 && b.right <= box.x + box.width + 1 && b.top >= box.y - 1 && b.bottom <= box.y + box.height + 1, "node outside the fitted view");

step("auto layout arranges by execution order; undo restores the user's layout");
await page.getByRole("button", { name: "Auto layout" }).click();
await page.waitForTimeout(500);
const auto = await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
for (let i = 1; i < auto.length; i++) expect(auto[i].top > auto[i - 1].top + 5 || (Math.abs(auto[i].top - auto[i - 1].top) < 5 && auto[i].left > auto[i - 1].left), `auto layout reading order broken at node ${i}`);
await shot("auto-layout");
await page.getByRole("button", { name: "Undo layout change" }).click();
await page.waitForTimeout(300);
expect(JSON.stringify(await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.style.transform))) === JSON.stringify(layout), "undo layout restores positions");

step("click a node: quick preview; double-click: expand; back: same canvas view");
await node("Extract invoice fields").click();
await preview.getByText("Input").first().waitFor();
await page.keyboard.press("Escape");
const vpBeforeExpand = await viewport();
await node("Extract invoice fields").dblclick();
await page.locator(".stp.on", { hasText: "Extract" }).waitFor();
await page.getByRole("button", { name: "Pipeline view" }).click();
await page.locator(".cnode").first().waitFor();
await page.waitForTimeout(300);
expect((await viewport()) === vpBeforeExpand, "viewport kept after expand and return");

step("keyboard: focus a node, Enter opens its preview, arrow keys move it");
const sel = node("Select columns");
const k0 = await transformOf(sel);
await sel.focus();
await page.keyboard.press("Enter");
await preview.getByText("SELECT").first().waitFor();
for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
await page.waitForTimeout(300);
expect((await transformOf(sel)) !== k0, "arrow keys move the focused node");
await page.keyboard.press("Escape");

step("review count on a node opens the review queue for that step; back keeps the view");
const vpReview = await viewport();
await node("Validate invoice").getByRole("link", { name: /review/ }).click();
await page.waitForURL(/\/review\?step=validate_invoice/);
await page.goBack();
await page.locator(".cnode").first().waitFor();
await page.waitForTimeout(300);
expect((await viewport()) === vpReview, "viewport kept after visiting the review queue");

step("drag a project source onto the canvas: lookup step with a supporting source node");
await page.getByRole("button", { name: "Project sources" }).click();
const target = await page.locator(".react-flow__pane").boundingBox();
await page.locator(".ctray-item", { hasText: "customers.csv" }).dragTo(page.locator(".react-flow__pane"), { targetPosition: { x: target.width - 300, y: target.height - 120 } });
await page.getByRole("menuitem", { name: /Look up columns/ }).click();
await page.getByRole("button", { name: /Apply transformation/ }).click();
await page.locator(".cnode.side", { hasText: "customers.csv" }).waitFor();
expect((await page.locator('.react-flow__edge[data-id^="side:"]').count()) === 1, "supporting source connects to the lookup step");
await page.locator(".react-flow__node", { has: page.locator(".cnode.side") }).first().click();
await preview.getByText("PROJECT SOURCE").waitFor();
await node("Lookup customers.csv").click();
const lk = await preview.innerText();
expect(/Keys/.test(lk) && /customer = customer/.test(lk) && /Lookup \(first match\)/.test(lk), "lookup preview shows keys and type:\n" + lk);
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sources", exact: true }).click();
await page.getByRole("listbox", { name: "Project sources" }).getByRole("option", { name: /customers\.csv/ }).click();
expect((await page.locator('[aria-label="Source detail"]').innerText()).includes("Clean Invoices"), "the source is referenced, not copied");
expect((await page.getByRole("listbox", { name: "Project sources" }).getByRole("option", { name: /customers\.csv/ }).count()) === 1, "no duplicate source");
await shot("lookup");

step("engineer view: selecting a canvas node shows its generated code");
await page.goto(`${BASE}/pipelines/${pid}`);
await workbench(page, "Engineer");
const panel = page.locator('section[aria-label="Pipeline canvas"]');
await panel.locator(".cnode", { hasText: "Extract invoice fields" }).click();
await page.waitForFunction(() => /def step_03_extract_invoice_fields/.test(document.querySelector('section[aria-label="Python code"]')?.textContent ?? ""));
await shot("engineer");
console.log(`  ${bannerAfter}`);
await finish("canvas walkthrough");
