// Graph parity (GRAPH_ENGINE_DESIGN.md §11): pipelines the linear model cannot express, run by the
// TypeScript graph engine and by the generated graph Python, compared Load by Load.
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { executeGraph, type GraphExecutionResult } from "@/engine/graph/execute";
import { generateGraphPython } from "@/codegen/graph";
import { invoiceSteps } from "@/engine/demo";
import { parseCsv } from "@/parsers";
import { toText } from "@/engine/values";
import { RANK_BASE, type GraphEdge, type GraphNode, type InputRoleId, type NodeStep, type PipelineSpecV2 } from "@/engine/graph/types";
import type { RawSheet, SourceSpec } from "@/engine/types";
import { SAMPLES, sampleCsv } from "../helpers";

const OUT = join(__dirname, "..", "..", ".parity-out");
const PY = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

const csv = (file: string, fileId: string, endCol: number): SourceSpec => ({ type: "csv", file, fileId, headerRow: 0, startCol: 0, endCol, csvDelimiter: "," });
const source = (id: string, s: SourceSpec, rank: number, order = -10 + rank): GraphNode => ({ id, kind: "source", source: s, rank, order });
const step = (s: NodeStep, order: number): GraphNode => ({ id: s.id, kind: "step", step: s, order });
const load = (id: string, order: number, path = `output/${id}.csv`): GraphNode => ({ id, kind: "load", order, destination: { type: "file", format: "csv", path } });
const edge = (from: string, to: string, input: InputRoleId = "input", slot?: number): GraphEdge => ({ id: `${from}>${to}:${input}${slot ?? ""}`, from, to, input, ...(slot !== undefined ? { slot } : {}) });

/** The invoice cleaning steps as a chain from `from`, with ids prefixed so branches can repeat them. */
function chain(from: string, prefix = "", count = 7): { nodes: GraphNode[]; edges: GraphEdge[]; last: string } {
  const steps = invoiceSteps().slice(0, count).map((s) => ({ ...s, id: prefix + s.id }) as NodeStep);
  const nodes = steps.map((s, i) => step(s, i));
  const edges = steps.map((s, i) => edge(i ? steps[i - 1].id : from, s.id));
  return { nodes, edges, last: steps[steps.length - 1].id };
}

const INVOICES = csv("invoices.csv", "f", 6);

function runGraphCase(name: string, spec: PipelineSpecV2, files: Record<string, string>, sheets: Record<string, RawSheet>): GraphExecutionResult {
  const dir = join(OUT, `graph_${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(SAMPLES, "invoices.csv"), join(dir, "invoices.csv"));
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  writeFileSync(join(dir, "pipeline.py"), generateGraphPython(spec, { version: 1 }));
  execFileSync(PY, [join(__dirname, "run_python.py"), dir], { stdio: ["ignore", "ignore", "pipe"] });
  const py = JSON.parse(readFileSync(join(dir, "python.json"), "utf8"));
  const ts = executeGraph(spec, { sheets: { f: sampleCsv(), ...sheets } });
  expect(ts.failed).toBe(false);
  expect(ts.steps.filter((s) => s.error)).toEqual([]);
  expect(Object.keys(py.loads).sort()).toEqual(ts.loads.map((l) => l.id).sort());
  for (const l of ts.loads) {
    const p = py.loads[l.id];
    expect(p.columns, l.id).toEqual(l.output.columns);
    expect(p.rowIds, l.id).toEqual(l.output.rowIds);
    const rows = l.output.rows.map((r) => r.map(toText));
    for (let i = 0; i < rows.length; i++) expect(p.rows[i], `${l.id} row ${l.output.rowIds[i]}`).toEqual(rows[i]);
  }
  expect(py.reviewRows).toEqual(ts.reviewRows);
  expect(py.excludedRows).toEqual(ts.excludedRows);
  expect(py.issues).toBe(ts.issues.length);
  expect(py.issueKeys).toEqual(ts.issues.map((i) => [i.row, i.column, i.stepId, i.kind]));
  expect(py.rules.map((r: { evaluated: number; passed: number }) => [r.evaluated, r.passed])).toEqual(ts.ruleResults.map((r) => [r.evaluated, r.passed]));
  return ts;
}

const spec = (name: string, nodes: GraphNode[], edges: GraphEdge[]): PipelineSpecV2 => ({ formaSpec: 2, name, graph: { nodes, edges }, reviewDecisions: [] });

describe("graph parity: TypeScript graph engine ≡ generated graph Python", () => {
  it("prepares the reference dataset before a Lookup; a flagged reference row is held, its matches become unmatched", () => {
    const regions = ["customer,region", "  Evergreen Ltd ,East", "Riverstone Sdn Bhd,", "Kinabalu Traders,North", "Orion Ventures,Central", "Zenith Foods,South"].join("\n") + "\n";
    const main = chain("inv");
    const nodes: GraphNode[] = [
      source("inv", INVOICES, 0),
      source("reg", csv("regions.csv", "reg", 1), 1),
      ...main.nodes,
      step({ id: "reg_trim", type: "trim", columns: ["customer"], collapseSpaces: true }, 20),
      step({ id: "reg_check", type: "validate", rules: [{ id: "has_region", column: "region", kind: "not_blank" }] }, 21),
      step({ id: "lk", type: "join", mode: "lookup", how: "left", on: [{ left: "customer", right: "customer" }], columns: ["region"], prefix: "r_", flagUnmatched: true }, 30),
      load("load", 40),
    ];
    const edges = [...main.edges, edge("reg", "reg_trim"), edge("reg_trim", "reg_check"), edge(main.last, "lk", "primary"), edge("reg_check", "lk", "reference"), edge("lk", "load")];
    const ts = runGraphCase("prepared_lookup", spec("Prepared lookup", nodes, edges), { "regions.csv": regions }, { reg: parseCsv(regions).sheet });
    expect(ts.reviewRows).toContain(RANK_BASE + 3); // Riverstone, held on the reference path (grid row 3)
    const out = ts.loads[0].output;
    const evergreen = out.rows.find((r) => r[out.columns.indexOf("customer")] === "Evergreen Ltd");
    expect(evergreen?.[out.columns.indexOf("region")]).toBe("East"); // matched after trimming the reference
    expect(out.rows.some((r) => r[out.columns.indexOf("customer")] === "Riverstone Sdn Bhd")).toBe(false); // unmatched, sent to review
  });

  it("branches to two Loads; a row flagged in one branch still loads in the other", () => {
    const main = chain("inv");
    const nodes: GraphNode[] = [
      source("inv", INVOICES, 0),
      ...main.nodes,
      step({ id: "paid", type: "filter", column: "status", op: "equals", value: "Paid" }, 10),
      load("load_paid", 11),
      step({ id: "big", type: "validate", rules: [{ id: "small", column: "amount", kind: "lt", value: 5000 }] }, 12),
      load("load_checked", 13),
    ];
    const edges = [...main.edges, edge(main.last, "paid"), edge("paid", "load_paid"), edge(main.last, "big"), edge("big", "load_checked")];
    const ts = runGraphCase("branches", spec("Branches", nodes, edges), {}, {});
    const paid = new Set(ts.loads[0].output.rowIds);
    const flaggedOnlyInB = ts.issues.filter((i) => i.stepId === "big").map((i) => i.row);
    expect(flaggedOnlyInB.some((r) => paid.has(r))).toBe(true);
  });

  it("diamond: one source, two branches, merged by a Lookup on a key", () => {
    const main = chain("inv");
    const nodes: GraphNode[] = [
      source("inv", INVOICES, 0),
      ...main.nodes,
      step({ id: "checks", type: "validate", rules: [{ id: "c", column: "customer", kind: "not_blank" }] }, 10),
      step({ id: "per_customer", type: "group", by: ["customer"], aggs: [{ column: "amount", fn: "sum", as: "customer_total" }] }, 11),
      step({ id: "with_totals", type: "join", mode: "lookup", how: "left", on: [{ left: "customer", right: "customer" }], columns: ["customer_total"], prefix: "t_", flagUnmatched: false }, 12),
      load("load", 13),
    ];
    const edges = [...main.edges, edge(main.last, "checks"), edge(main.last, "per_customer"), edge("checks", "with_totals", "primary"), edge("per_customer", "with_totals", "reference"), edge("with_totals", "load")];
    const ts = runGraphCase("diamond", spec("Diamond", nodes, edges), {}, {});
    expect(ts.loads[0].output.columns).toContain("customer_total");
  });

  it("appends three monthly files in one Append, with a schema mapping", () => {
    const jan = ["customer,amount", "Atlas Holdings,100", "Beta Trading,200"].join("\n") + "\n";
    const feb = ["customer_name,amount_total", "Atlas Holdings,RM 1,200", ",50"].join("\n") + "\n";
    const mar = ["customer_name,amount_total,note", "Delta Corp,300,late"].join("\n") + "\n";
    const nodes: GraphNode[] = [
      source("jan", csv("jan.csv", "jan", 1), 0),
      source("feb", csv("feb.csv", "feb", 1), 1),
      source("mar", csv("mar.csv", "mar", 2), 2),
      step({ id: "months", type: "append", mapping: { customer_name: "customer", amount_total: "amount" } }, 1),
      step({ id: "num", type: "convert_number", column: "amount", decimals: 2 }, 2),
      step({ id: "named", type: "validate", rules: [{ id: "n", column: "customer", kind: "not_blank" }] }, 3),
      load("load", 4),
    ];
    const edges = [edge("jan", "months", "datasets", 0), edge("feb", "months", "datasets", 1), edge("mar", "months", "datasets", 2), edge("months", "num"), edge("num", "named"), edge("named", "load")];
    const ts = runGraphCase("append_three", spec("Three months", nodes, edges), { "jan.csv": jan, "feb.csv": feb, "mar.csv": mar }, { jan: parseCsv(jan).sheet, feb: parseCsv(feb).sheet, mar: parseCsv(mar).sheet });
    expect(ts.loads[0].output.columns).toEqual(["customer", "amount", "note"]);
    expect(ts.reviewRows).toHaveLength(1);
  });

  it("a Rename on one branch renames only that branch's review issues", () => {
    const main = chain("inv");
    const nodes: GraphNode[] = [
      source("inv", INVOICES, 0),
      ...main.nodes,
      step({ id: "short_names", type: "rename", mapping: { invoice_no: "inv" } }, 10),
      load("load_a", 11),
      step({ id: "inv_rule", type: "validate", rules: [{ id: "inv_pattern", column: "invoice_no", kind: "matches", pattern: "^INV-\\d+$" }] }, 12),
      load("load_b", 13),
    ];
    const edges = [...main.edges, edge(main.last, "short_names"), edge("short_names", "load_a"), edge(main.last, "inv_rule"), edge("inv_rule", "load_b")];
    const ts = runGraphCase("branch_rename", spec("Branch rename", nodes, edges), {}, {});
    // The same extraction issue appears renamed on branch A and unchanged on branch B.
    const extracted = ts.issues.filter((i) => i.stepId === "extract_invoice_fields");
    expect(extracted.some((i) => i.column === "inv")).toBe(true);
    expect(extracted.some((i) => i.column === "invoice_no")).toBe(true);
  });
});

describe("pipelines edited in the app", () => {
  it("a Lookup whose reference is cleaned on its own branch exports and runs identically", async () => {
    const { addSourceNode, insertStep, materialize, reconnect, toGraphSpec } = await import("@/engine/graph/spec");
    const customersText = ["customer,region", "  Evergreen Ltd ,East", "Orion Ventures,Central", "Zenith Foods,"].join("\n") + "\n";
    const CUST = csv("customers.csv", "cust", 1);
    const linear = {
      name: "Edited",
      source: INVOICES,
      steps: [...invoiceSteps().slice(0, 7), { id: "lk", type: "join" as const, source: CUST, mode: "lookup" as const, how: "left" as const, on: [{ left: "customer", right: "customer" }], columns: ["region"], prefix: "c_", flagUnmatched: true }],
      destination: null,
      reviewDecisions: [],
    };
    let s = materialize(linear);
    const added = addSourceNode(s, CUST);
    s = insertStep(added.spec, { id: "trim_cust", type: "trim", columns: ["customer"], collapseSpaces: true }, s.steps.length, { after: added.id });
    const r = reconnect(s, s.graph!.edges.find((e) => e.to === "lk" && e.input === "reference")!.id, { from: "trim_cust" });
    if (!r.ok) throw new Error(r.reason);
    runGraphCase("edited_lookup", toGraphSpec(r.spec), { "customers.csv": customersText }, { cust: parseCsv(customersText).sheet });
  });
});

describe("branching built in the app", () => {
  it("a branch Load added before Rename exports and runs identically, main output first", async () => {
    const { addLoad, toGraphSpec } = await import("@/engine/graph/spec");
    const linear = { name: "Branch", source: INVOICES, steps: invoiceSteps(), destination: { type: "file" as const, format: "csv" as const, path: "output/main.csv" }, reviewDecisions: [] };
    const { spec: s } = addLoad(linear, "status_case", { type: "file", format: "csv", path: "output/raw_titles.csv" });
    const g = toGraphSpec(s);
    const ts = runGraphCase("app_branch", g, {}, {});
    expect(ts.loads.map((l) => l.id).sort()).toEqual(["load", "load_2"]);
  });
});

describe("FORMA server runner", () => {
  const SERVER = join(__dirname, "..", "..", "..", "server");
  const runOnServer = (name: string, pipelinePy: string, config: Record<string, unknown>, files: Record<string, string>) => {
    const dir = join(OUT, `server_${name}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(SAMPLES, "invoices.csv"), join(dir, "invoices.csv"));
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    // Paths resolve next to pipeline.py, as the server's job preparation arranges.
    writeFileSync(join(dir, "pipeline.py"), pipelinePy);
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    try {
      execFileSync(PY, ["-m", "forma_server.runner", dir], { env: { ...process.env, PYTHONPATH: SERVER }, stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      /* the result file says what failed */
    }
    return { result: JSON.parse(readFileSync(join(dir, "result.json"), "utf8")), csv: readFileSync(join(dir, "forma_output.csv"), "utf8") };
  };

  it("runs a graph export node by node and reports each step by id", async () => {
    const { graphConfigObject } = await import("@/codegen/graph");
    const regions = ["customer,region", "Evergreen Ltd,East", "Orion Ventures,Central"].join("\n") + "\n";
    const main = chain("inv");
    const g = spec(
      "Server graph",
      [
        source("inv", INVOICES, 0),
        source("reg", csv("regions.csv", "reg", 1), 1),
        ...main.nodes,
        step({ id: "reg_trim", type: "trim", columns: ["customer"], collapseSpaces: true }, 20),
        step({ id: "lk", type: "join", mode: "lookup", how: "left", on: [{ left: "customer", right: "customer" }], columns: ["region"], prefix: "r_", flagUnmatched: false }, 30),
        load("load", 40),
      ],
      [...main.edges, edge("reg", "reg_trim"), edge(main.last, "lk", "primary"), edge("reg_trim", "lk", "reference"), edge("lk", "load")],
    );
    const { result, csv: out } = runOnServer("graph", generateGraphPython(g), graphConfigObject(g), { "regions.csv": regions });
    expect(result.error).toBeUndefined();
    const ts = executeGraph(g, { sheets: { f: sampleCsv(), reg: parseCsv(regions).sheet } });
    expect(result.rows_out).toBe(ts.loads[0].output.rows.length);
    expect(result.review_count).toBe(ts.reviewRows.length);
    expect(result.steps.map((s: { step_id: string }) => s.step_id)).toEqual(ts.steps.map((s) => s.stepId));
    expect(result.steps.map((s: { issues: number }) => s.issues)).toEqual(ts.steps.map((s) => s.issues));
    expect(out.split(/\r?\n/)[0]).toBe(ts.loads[0].output.columns.join(","));
  });

  it("writes every Load of a branching pipeline and reports each", async () => {
    const { graphConfigObject } = await import("@/codegen/graph");
    const { addLoad, toGraphSpec } = await import("@/engine/graph/spec");
    const linear = { name: "Server branch", source: INVOICES, steps: invoiceSteps(), destination: { type: "file" as const, format: "csv" as const, path: "output/main.csv" }, reviewDecisions: [] };
    const g = toGraphSpec(addLoad(linear, "status_case", { type: "file", format: "csv", path: "output/raw_titles.csv" }).spec);
    const { result } = runOnServer("branch", generateGraphPython(g), graphConfigObject(g), {});
    expect(result.error).toBeUndefined();
    const ts = executeGraph(g, { sheets: { f: sampleCsv() } });
    const byId = Object.fromEntries(ts.loads.map((l) => [l.id, l.output.rows.length]));
    expect(result.loads.map((l: { id: string }) => l.id)).toEqual(["load", "load_2"]); // the main Load first
    for (const l of result.loads as { id: string; rows_out: number }[]) expect(l.rows_out).toBe(byId[l.id]);
    expect(result.rows_out).toBe(byId.load);
  });

  it("still runs a linear export step by step", async () => {
    const { configObject, generatePython } = await import("@/codegen/python");
    const { execute } = await import("@/engine/execute");
    const linear = { name: "Server linear", source: INVOICES, steps: invoiceSteps(), destination: null, reviewDecisions: [] };
    const { result } = runOnServer("linear", generatePython(linear), configObject(linear), {});
    expect(result.error).toBeUndefined();
    const ts = execute(linear, sampleCsv());
    expect(result.rows_out).toBe(ts.output.rows.length);
    expect(result.review_count).toBe(ts.reviewRows.length);
    expect(result.steps.map((s: { rows_out: number }) => s.rows_out)).toEqual(ts.steps.map((s) => s.rowsOut));
  });
});
