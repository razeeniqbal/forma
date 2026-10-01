// The FORMA server runs the exact generated pipeline.py; its output must match
// the TypeScript engine cell for cell (Excel source and a live database source).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "@/engine/execute";
import { invoicePipeline } from "@/engine/demo";
import { configObject, generatePython } from "@/codegen/python";
import { toCsv } from "@/lib/exporters";
import type { PipelineSpec, RawSheet } from "@/engine/types";
import { SAMPLES, sampleSheet } from "../helpers";

const PY = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const SERVER_DIR = join(__dirname, "..", "..", "..", "server");
const PORT = 18787 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "forma-server-"));
  execFileSync(PY, ["-c", `
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute("create table invoices (invoice_no text, customer text, amount numeric, due text, status text)")
rows = [("INV-%d" % (1000 + i), ["Acme", "Beta", None, "Delta"][i % 4], [4500.5, 120, None, 99.99][i % 4], ["2026-10-%02d" % (i % 28 + 1), "31/13/2026"][i % 7 == 0], [" open", "Paid", "PAID"][i % 3]) for i in range(200)]
con.executemany("insert into invoices values (?,?,?,?,?)", rows)
con.commit()
`, join(dir, "wh.db")]);
  proc = spawn(PY, ["-m", "forma_server", "--port", String(PORT)], {
    cwd: SERVER_DIR,
    env: { ...process.env, FORMA_DATA_DIR: join(dir, "data"), WAREHOUSE_URL: `sqlite:///${join(dir, "wh.db")}`, ANTHROPIC_API_KEY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start");
}, 30000);

afterAll(() => {
  proc?.kill();
  rmSync(dir, { recursive: true, force: true });
});

async function api(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text();
}

async function runOnServer(id: string, spec: PipelineSpec, files: Record<string, string>) {
  await api(`/api/pipelines/${id}`, { method: "PUT", body: JSON.stringify({ name: spec.name, version: 1, pipeline_py: generatePython(spec), config: configObject(spec), files }) });
  const run = await api(`/api/pipelines/${id}/runs`, { method: "POST", body: "{}" });
  for (let i = 0; i < 300; i++) {
    const r = await api(`/api/runs/${run.id}`);
    if (r.status !== "running") return { run: r, output: (await api(`/api/runs/${run.id}/output`)) as string };
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("run timed out");
}

describe("FORMA server ≡ engine", () => {
  it("Excel pipeline with a group step", async () => {
    const xlsx = readFileSync(join(SAMPLES, "invoices.xlsx"));
    await fetch(`${BASE}/api/files/fx?name=invoices.xlsx`, { method: "PUT", body: xlsx });
    const spec = invoicePipeline("fx");
    spec.steps.push({ id: "g", type: "group", by: ["status", "customer"], aggs: [{ column: "total", fn: "sum", as: "total" }, { column: "invoice_no", fn: "count", as: "n" }] });
    const { run, output } = await runOnServer("px", spec, { source: "fx" });
    const ts = execute(spec, await sampleSheet());
    expect(run.status).toBe(ts.reviewRows.length ? "review" : "success");
    expect(output).toBe(toCsv(ts.output));
    expect(run.result.review_count).toBe(ts.reviewRows.length);
    expect(run.result.steps.map((s: { rows_out: number }) => s.rows_out)).toEqual(ts.steps.map((s) => s.rowsOut));
  }, 60000);

  it("live database source (snapshot for building, live query at run time)", async () => {
    const query = "select * from invoices order by invoice_no";
    const snap = await api("/api/sources/query", { method: "POST", body: JSON.stringify({ kind: "database", url_env: "WAREHOUSE_URL", query }) });
    const sheet: RawSheet = { name: "query", cells: snap.grid };
    const spec: PipelineSpec = {
      name: "Warehouse",
      source: { type: "database", file: "invoices (query)", fileId: "db", headerRow: 0, startCol: 0, endCol: 4, origin: { kind: "database", urlEnv: "WAREHOUSE_URL", query } },
      steps: [
        { id: "t", type: "trim", columns: ["status"], collapseSpaces: true },
        { id: "c", type: "change_case", columns: ["status"], mode: "title" },
        { id: "a", type: "convert_number", column: "amount", decimals: 2 },
        { id: "d", type: "standardise_date", column: "due", inputFormats: ["YYYY-MM-DD"], outputFormat: "DD/MM/YYYY" },
        { id: "v", type: "validate", rules: [{ id: "r1", column: "customer", kind: "not_blank" }] },
      ],
      destination: { type: "file", format: "csv", path: "out.csv" },
      reviewDecisions: [],
    };
    const { run, output } = await runOnServer("pdb", spec, {});
    const ts = execute(spec, sheet);
    expect(ts.reviewRows.length).toBeGreaterThan(0);
    expect(run.status).toBe("review");
    expect(output).toBe(toCsv(ts.output));
  }, 60000);
});
