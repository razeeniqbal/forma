// Editable connections: prepare a reference dataset on its own branch, disconnect, reconnect by dragging,
// connect without dragging, and see problems before anything runs.
import { apply, createProject, openPipeline, start, step } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "g" });
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const node = (text) => page.locator(".react-flow__node", { has: page.locator(".cnode", { hasText: text }) }).first();
const side = page.getByRole("complementary", { name: "Step preview" });

step("example pipeline with a Lookup on customers.csv");
const projectId = await createProject(page, "Graph", { example: true });
await openPipeline(page, projectId, "Clean Invoices");
await page.getByRole("button", { name: "Project sources" }).click();
const pane = await page.locator(".react-flow__pane").boundingBox();
await page.locator(".ctray-item", { hasText: "customers.csv" }).dragTo(page.locator(".react-flow__pane"), { targetPosition: { x: pane.width - 320, y: pane.height - 140 } });
await page.getByRole("menuitem", { name: /Look up columns/ }).click();
await page.getByRole("button", { name: "Use", exact: true }).first().click();
await apply(page);
await node("Lookup customers.csv").waitFor();

step("add customers.csv as a source to prepare first, then trim it");
if (!(await page.locator(".ctray").count())) await page.getByRole("button", { name: "Project sources" }).click();
await page.locator(".ctray-item", { hasText: "customers.csv" }).dragTo(page.locator(".react-flow__pane"), { targetPosition: { x: 520, y: pane.height - 120 } });
await page.getByRole("menuitem", { name: /prepare first/ }).click();
await page.getByPlaceholder(/Search tools/).fill("trim");
await page.keyboard.press("Enter");
await apply(page);
const trim = page.locator(".react-flow__node", { has: page.locator(".cnode", { hasText: "Trim text" }) }).last();
await trim.waitFor();
if (await page.locator(".ctray").count()) await page.getByRole("button", { name: "Close sources" }).click();
await page.getByRole("button", { name: "Auto layout" }).click();
await page.waitForTimeout(600);
await shot("prepared-branch");

step("disconnect the Lookup's reference: FORMA asks, then shows the problem on the node");
await node("Lookup customers.csv").click();
await side.locator(".sp-conn summary").click();
await side.getByRole("button", { name: /Disconnect customers\.csv from reference dataset/ }).click();
await page.getByRole("button", { name: "Keep change" }).click();
await page.locator(".cnode.failed", { hasText: "Lookup" }).waitFor();
const why = await side.innerText();
expect(/needs its reference dataset/i.test(why), "the inspector explains the missing input:\n" + why);

step("runs are refused while the pipeline is incomplete");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v\d+/ }).click();
await page.getByText(/Fix the pipeline's connections first/).waitFor();

step("drag the trimmed customers into the Lookup's second input");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Fit pipeline" }).click();
await page.waitForTimeout(500);
await trim.hover();
const ob = await trim.locator(".react-flow__handle-right").boundingBox();
await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
await page.mouse.down();
const target = await node("Lookup").locator(".react-flow__handle-bottom").boundingBox();
await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 - 4, { steps: 15 });
expect((await page.locator(".cnode.compat-yes", { hasText: "Lookup" }).count()) === 1, "the Lookup lights up as a compatible target");
await shot("dragging");
await page.mouse.up();
await page.locator(".cnode.failed", { hasText: "Lookup" }).waitFor({ state: "detached" });
expect((await page.locator(".react-flow__edge").count()) >= 10, "connections drawn");
await shot("reconnected");

step("the Lookup now reads the trimmed dataset; the editor says so");
await node("Lookup").click();
await side.getByRole("button", { name: "Configure" }).click();
await page.getByText(/connected on the canvas/).waitFor();
await page.getByRole("button", { name: "Cancel" }).click();

step("a forbidden connection is refused with its reason (accessible connect)");
await node("Validate invoice").click();
await side.locator(".sp-conn summary").click();
const options = await side.getByLabel("Connect output to").locator("option").allInnerTexts();
expect(!options.some((o) => /Select columns/.test(o)), "no loop-making target is offered: " + options.join(" | "));

step("branch: a second Load after Change case, with its own destination");
await page.keyboard.press("Escape");
await node("Change case").click();
await page.getByRole("button", { name: "Add tool" }).click();
await page.getByRole("dialog", { name: "Add tool" }).locator(".palette-item", { hasText: /^Load/ }).click();
await page.getByRole("dialog", { name: "Add tool" }).locator(".palette-item", { hasText: "New Load (branch)" }).click();
await side.getByText("Branch destination").waitFor();
await side.getByPlaceholder(/output\//).fill("output/titles.csv");
await page.waitForTimeout(400);
await page.locator(".cnode.destination", { hasText: "titles.csv" }).waitFor();

step("run the connected, branching pipeline: every output is kept");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v\d+/ }).click();
await page.locator(".run-banner.review, .run-banner.success").waitFor({ timeout: 30000 });
console.log(`  ${(await page.locator(".run-banner").innerText()).replace(/\s+/g, " ").trim()}`);
await page.locator(".cnode.destination", { hasText: "titles.csv" }).locator(".fc-metrics", { hasText: /loaded|ready/ }).waitFor();
await page.getByRole("link", { name: "View run" }).click();
const outputs = page.getByLabel("Outputs");
await outputs.getByText("titles.csv").waitFor();
expect((await outputs.locator(".run-load").count()) === 2, "two outputs listed");
await outputs.locator(".run-load", { hasText: "titles.csv" }).getByRole("button", { name: "View" }).click();
await page.getByRole("dialog").getByText(/titles\.csv: [\d,]+ rows/).waitFor();
await shot("outputs");
await page.keyboard.press("Escape");
await page.goBack();
await page.locator(".cnode").first().waitFor();

step("export is graph code");
await page.getByRole("link", { name: "Export" }).click();
await page.getByText(/@node\(/).first().waitFor();
await shot("export");

await finish("graph walkthrough");
