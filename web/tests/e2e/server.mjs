// Browser walkthrough with a running FORMA server:
//   python -m forma_server --port 8787   (with WAREHOUSE_URL pointing at a database that has an "invoices" table)
//   npm run build && npx vite preview --port 4173 &
//   node tests/e2e/server.mjs [dir]
import { BASE, createProject, start, step, workbench } from "./lib.mjs";

const SERVER = process.env.FORMA_SERVER ?? "http://127.0.0.1:8787";
const { page, shot, finish } = await start({ prefix: "srv" });

step("connect the server in Settings");
await page.goto(`${BASE}/settings`);
await page.getByPlaceholder("http://localhost:8787").fill(SERVER);
await page.getByRole("button", { name: /Save & test/ }).click();
await page.getByText(/Connected · v/).waitFor();

step("new project: add a database source from the empty project");
const projectId = await createProject(page, "Warehouse");
await page.locator("button.add-option", { hasText: "Database" }).click();
await page.locator(".modal textarea").fill("select * from invoices order by invoice_no");
await page.getByPlaceholder("Source name (optional)").fill("warehouse invoices");
await page.getByRole("button", { name: /Fetch preview/ }).click();
await page.getByText(/300 rows · 5 columns/).waitFor();
await shot("db-source");
await page.getByRole("button", { name: "Use this source" }).click();
await page.waitForURL(/\/sources\?source=/);

step("create a pipeline on it and add a trim step");
await page.locator('[aria-label="Source detail"]').getByRole("link", { name: "Create pipeline", exact: true }).click();
await page.getByRole("button", { name: "Create Pipeline" }).click();
await page.waitForURL(/\/pipelines\/p_/);
await workbench(page, "Analyst");
await page.waitForSelector(".grid-row");
await page.locator('section[aria-label="Data preview"] .gh', { hasText: "status" }).click();
await page.locator(".float-bar button", { hasText: "Clean" }).click();
await page.getByRole("button", { name: /Apply transformation/ }).click();
await page.getByRole("button", { name: "Pipeline view" }).click();

step("execution target: FORMA Server");
await page.getByRole("button", { name: /Execution: Local/ }).click();
await page.getByRole("menuitem", { name: /^FORMA Server/ }).click();
await page.getByRole("button", { name: /Execution: FORMA Server/ }).waitFor();

step("run on the server and see the result in the pipeline view");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.locator(".modal .seg button.on", { hasText: "FORMA Server" }).waitFor();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".run-banner.success, .run-banner.review").waitFor({ timeout: 30000 });
const banner = await page.locator(".run-banner").innerText();
if (!/300/.test(banner)) throw new Error("server run banner missing row counts: " + banner);
await shot("server-run");

step("schedule on the server");
await page.getByRole("button", { name: /^Schedule$/ }).click();
await page.getByRole("button", { name: "Every day at 06:00" }).click();
await page.getByRole("button", { name: "Save schedule" }).click();
await page.getByText(/Scheduled on the FORMA server/).waitFor({ timeout: 15000 });

step("project runs list the server run");
await page.goto(`${BASE}/projects/${projectId}/runs`);
await page.locator(".badge", { hasText: "Server" }).first().waitFor();
await shot("runs");
console.log(`  ${banner.replace(/\s+/g, " ").trim()}`);
await finish("server walkthrough");
