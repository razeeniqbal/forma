// Upgrading stored data from before projects (schema v1) keeps every pipeline, version, decision and run.
import { BASE, createProject, openPipeline, start, step } from "./lib.mjs";

const { page, shot, finish } = await start({ prefix: "m" });

step("create data, run once, then strip it back to the pre-project (v1) shape");
const projectId = await createProject(page, "Temporary", { example: true });
const pid = await openPipeline(page, projectId, "Clean Invoices");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page.getByRole("button", { name: /Run v1/ }).click();
await page.locator(".run-banner.review, .run-banner.success").waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
const before = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open("forma");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("kv", "readwrite");
        const kv = tx.objectStore("kv");
        const out = {};
        const strip = (key) =>
          new Promise((r) => {
            const g = kv.get(key);
            g.onsuccess = () => {
              const v = (g.result ?? []).map(({ projectId, ...rest }) => rest);
              out[key] = v.map((x) => x.id);
              if (key === "pipelines") out.versions = v.map((p) => p.version);
              kv.put(v, key);
              r();
            };
          });
        Promise.all([strip("pipelines"), strip("sources"), strip("runs")]).then(() => {
          kv.delete("projects");
          kv.delete("schema");
          const s = kv.get("settings");
          s.onsuccess = () => kv.put({ ...(s.result ?? {}), defaultPreset: "analyst" }, "settings");
        });
        tx.oncomplete = () => resolve(out);
      };
    }),
);

step("reload: data moves into “My FORMA Project” with the same ids");
await page.goto(`${BASE}/projects`);
await page.getByRole("link", { name: "My FORMA Project" }).click();
await page.waitForURL(/\/projects\/proj_default$/);
await page.locator(".pmap-node.pipe", { hasText: "Clean Invoices" }).waitFor();
await shot("migrated-overview");
const after = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open("forma");
      open.onsuccess = () => {
        const kv = open.result.transaction("kv").objectStore("kv");
        const out = {};
        let n = 0;
        for (const key of ["pipelines", "sources", "runs", "projects", "schema"])
          kv.get(key).onsuccess = (e) => {
            out[key] = e.target.result;
            if (++n === 5) resolve(out);
          };
      };
    }),
);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!same(after.pipelines.map((p) => p.id), before.pipelines)) throw new Error("pipeline ids changed");
if (!same(after.pipelines.map((p) => p.version), before.versions)) throw new Error("versions changed");
if (!after.pipelines.every((p) => p.projectId === "proj_default")) throw new Error("pipelines not in default project");
if (!after.sources.every((s) => s.projectId === "proj_default")) throw new Error("sources not in default project");
if (!same(after.runs.map((r) => r.id), before.runs) || !after.runs.every((r) => r.projectId === "proj_default")) throw new Error("runs not kept");
if (after.schema !== 2) throw new Error("schema not recorded");
if (!after.projects.some((p) => p.id === "proj_default" && p.name === "My FORMA Project")) throw new Error("default project missing");

step("run history and pipeline open as before");
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Runs", exact: true }).click();
if ((await page.locator("tbody tr").count()) !== before.runs.length) throw new Error("run history incomplete");
await page.goto(`${BASE}/pipelines/${pid}`);
await page.locator(".flow-card").first().waitFor();
if (!/Showing run of v1/.test(await page.locator(".flow-basis").innerText())) throw new Error("run results not shown after migration");
await finish("migration walkthrough");
