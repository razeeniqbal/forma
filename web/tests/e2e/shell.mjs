// Navigation shell: global vs project navigation, collapsible sidebar, narrow windows, phone width.
import { BASE, createProject, openPipeline, start, step } from "./lib.mjs";

const { browser, page, shot, finish } = await start({ width: 1400, height: 860, prefix: "sh" });
const width = (p = page) => p.locator("nav.sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
const settle = () => page.waitForTimeout(350);
const nav = page.getByRole("navigation", { name: "Main" });

step("global navigation: Projects + Settings");
await page.goto(`${BASE}/projects`);
await nav.getByRole("link", { name: "Projects", exact: true }).waitFor();
if ((await nav.getByRole("link", { name: "Sources" }).count()) !== 0) throw new Error("project sections shown outside a project");

step("inside a project: ← Projects, project name, Overview / Sources / Pipelines / Runs / Project Settings");
const projectId = await createProject(page, "Shell test", { example: true });
for (const n of ["All projects", "Overview", "Sources", "Pipelines", "Runs", "Project Settings"]) await nav.getByRole("link", { name: n, exact: true }).waitFor();
await nav.getByText("Shell test").waitFor();
await openPipeline(page, projectId, "Clean Invoices");
if ((await nav.getByRole("link", { name: "Pipelines", exact: true }).getAttribute("aria-current")) !== "page") throw new Error("Pipelines is not marked current inside a pipeline");

step("wide window starts expanded; collapse with the button");
if ((await width()) < 150) throw new Error("sidebar should start expanded on a wide window");
await page.getByRole("button", { name: "Collapse sidebar" }).click();
await settle();
if ((await width()) > 70) throw new Error(`collapsed sidebar is ${await width()}px`);
await nav.getByRole("link", { name: "Sources", exact: true }).click();
await page.waitForURL(/\/sources/);
await shot("collapsed");

step("choice survives a reload; Ctrl+B expands");
await page.reload();
await settle();
if ((await width()) > 70) throw new Error("collapsed choice not remembered");
await page.keyboard.press("Control+b");
await settle();
if ((await width()) < 150) throw new Error("Ctrl+B did not expand the sidebar");

step("narrow window without a saved choice starts collapsed");
const narrowCtx = await browser.newContext({ viewport: { width: 900, height: 800 } });
const narrow = await narrowCtx.newPage();
await narrow.goto(`${BASE}/projects`);
await narrow.waitForTimeout(350);
if ((await width(narrow)) > 70) throw new Error(`narrow window sidebar is ${await width(narrow)}px`);

step("phone width: pipeline view only, navigation still reachable");
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await phone.goto(`${BASE}/projects/new`);
await phone.getByLabel("Project name").fill("Phone");
await phone.getByText("Start from example").click();
await phone.getByRole("button", { name: "Create Project" }).click();
await phone.waitForURL(/\/projects\/proj_/);
await phone.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pipelines", exact: true }).click();
await phone.getByRole("link", { name: "Clean Invoices", exact: true }).first().click();
await phone.locator(".cnode").first().waitFor();
if (await phone.locator(".panel .grid-row").count()) throw new Error("workbench panels shown at phone width");
const scrollW = await phone.evaluate(() => document.documentElement.scrollWidth);
if (scrollW > 392) throw new Error(`horizontal page scroll at phone width (${scrollW}px)`);
await phone.screenshot({ path: `${process.argv[2] ?? "e2e-shots"}/sh-phone.png` });
await finish("shell walkthrough");
