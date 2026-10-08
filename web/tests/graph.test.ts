// Graph model: migration, order, compatibility, validation, schema (GRAPH_ENGINE_DESIGN.md §3 to §9).
import { describe, expect, it } from "vitest";
import { deriveGraph } from "@/canvas/graph";
import { invoicePipeline, invoiceSteps } from "@/engine/demo";
import { canConnect, executionOrder, inferSchemas, migrateSpec, validateGraph } from "@/engine/graph/model";
import { executeGraph } from "@/engine/graph/execute";
import type { GraphEdge, GraphNode, PipelineSpecV2 } from "@/engine/graph/types";
import type { PipelineSpec, SourceSpec } from "@/engine/types";
import { parseCsv } from "@/parsers";
import { sampleCsv, sampleSheet } from "./helpers";
import { expectGraphEquivalent } from "./graphEquivalence";

const csv = (file: string, fileId: string, endCol: number): SourceSpec => ({ type: "csv", file, fileId, headerRow: 0, startCol: 0, endCol, csvDelimiter: "," });
const INVOICES = csv("invoices.csv", "f", 6);
const lookupCust = { id: "lk", type: "join" as const, source: csv("customers.csv", "cust", 1), mode: "lookup" as const, how: "left" as const, on: [{ left: "customer", right: "customer" }], columns: ["region"], prefix: "c_", flagUnmatched: true };
const v1: PipelineSpec = { name: "x", source: INVOICES, steps: [...invoiceSteps().slice(0, 7), lookupCust, { id: "ap", type: "append", source: INVOICES }], destination: null, reviewDecisions: [] };
const v2 = (nodes: GraphNode[], edges: GraphEdge[]): PipelineSpecV2 => ({ formaSpec: 2, name: "g", graph: { nodes, edges }, reviewDecisions: [] });
const e = (from: string, to: string, input: GraphEdge["input"] = "input", slot?: number): GraphEdge => ({ id: `${from}>${to}:${input}${slot ?? ""}`, from, to, input, slot });

describe("migration from the linear PipelineSpec", () => {
  const g = migrateSpec(v1).graph;

  it("keeps the canvas node ids, so saved positions carry over", () => {
    const canvas = deriveGraph(v1).nodes.map((n) => n.id);
    // A combine step that reads the main file gets its own source node (it reads the whole file today).
    expect(g.nodes.map((n) => n.id).sort()).toEqual([...canvas, "side:f:"].sort());
  });

  it("names each input by its role and ranks sources once", () => {
    expect(g.edges.find((x) => x.to === "lk" && x.from === "side:cust:")?.input).toBe("reference");
    expect(g.edges.find((x) => x.to === "lk" && x.from !== "side:cust:")?.input).toBe("primary");
    expect(g.edges.filter((x) => x.to === "ap").sort((a, b) => a.slot! - b.slot!).map((x) => [x.input, x.slot])).toEqual([["datasets", 0], ["datasets", 1]]);
    expect(g.nodes.filter((n) => n.kind === "source").map((n) => n.kind === "source" && [n.id, n.rank])).toEqual([["source", 0], ["side:cust:", 1], ["side:f:", 2]]);
  });

  it("orders execution exactly as the linear spec", () => {
    const order = executionOrder(g).filter((id) => !id.startsWith("side:") && id !== "source" && id !== "load");
    expect(order).toEqual(v1.steps.map((s) => s.id));
  });

  it("gives identical results on a sampled preview (limit) and with review decisions", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f");
    expectGraphEquivalent(spec, sheet, {}, 120);
    const first = expectGraphEquivalent(spec, sheet);
    const row = first.reviewRows[0];
    expectGraphEquivalent({ ...spec, reviewDecisions: [{ row, column: null, action: "exclude", decidedAt: 0 }] }, sheet);
  });
});

describe("execution order", () => {
  const two = (orderA: number, orderB: number) =>
    v2(
      [
        { id: "a", kind: "source", source: csv("a.csv", "a", 1), rank: 0, order: 0 },
        { id: "b", kind: "source", source: csv("b.csv", "b", 1), rank: 1, order: 1 },
        { id: "ga", kind: "step", step: { id: "ga", type: "group", by: ["k"], aggs: [{ column: "v", fn: "sum", as: "v" }] }, order: orderA },
        { id: "gb", kind: "step", step: { id: "gb", type: "group", by: ["k"], aggs: [{ column: "v", fn: "sum", as: "v" }] }, order: orderB },
        { id: "la", kind: "load", destination: null, order: 10 },
        { id: "lb", kind: "load", destination: null, order: 11 },
      ],
      [e("a", "ga"), e("b", "gb"), e("ga", "la"), e("gb", "lb")],
    );
  const sheets = { a: parseCsv("k,v\nx,1\ny,2\n").sheet, b: parseCsv("k,v\nz,5\n").sheet };

  it("runs sources first, then by dependency with creation order as the only tie-break", () => {
    expect(executionOrder(two(2, 3).graph)).toEqual(["a", "b", "ga", "gb", "la", "lb"]);
    expect(executionOrder(two(3, 2).graph)).toEqual(["a", "b", "gb", "ga", "la", "lb"]);
  });

  it("creation order decides which branch gets the next row ids; node array order does not", () => {
    const first = executeGraph(two(2, 3), { sheets });
    const swapped = executeGraph(two(3, 2), { sheets });
    // Source rows are 2..3 (grid rows after the header), so created rows start at 4.
    expect(first.loads.find((l) => l.id === "la")!.output.rowIds).toEqual([4, 5]);
    expect(swapped.loads.find((l) => l.id === "lb")!.output.rowIds).toEqual([4]);
    const shuffled = two(2, 3);
    shuffled.graph.nodes.reverse();
    shuffled.graph.edges.reverse();
    expect(executeGraph(shuffled, { sheets }).loads.map((l) => l.output.rowIds)).toEqual(first.loads.map((l) => l.output.rowIds));
  });

  it("namespaces the row ids of every source after the first", () => {
    const r = executeGraph(two(2, 3), { sheets });
    expect(r.outputs.get("b")!.rowIds).toEqual([1_000_000_002]);
  });
});

describe("connections", () => {
  const g = migrateSpec(v1).graph;

  it("formalises what can connect to what, with a reason", () => {
    expect(canConnect(g, "load", "lk", "primary")).toEqual({ ok: false, reason: "Load ends a branch. It has no output to connect." });
    expect(canConnect(g, "lk", "source", "input")).toMatchObject({ ok: false });
    expect(canConnect(g, "side:cust:", "lk", "reference")).toMatchObject({ ok: false, reason: expect.stringMatching(/already has its reference dataset/) });
    const open = { ...g, edges: g.edges.filter((x) => x.to !== "select_columns") };
    expect(canConnect(open, "lk", "select_columns", "input")).toMatchObject({ ok: false, reason: expect.stringMatching(/before itself.*loops are not supported/) });
    expect(canConnect(g, "trim_text", "lk", "left")).toMatchObject({ ok: false, reason: expect.stringMatching(/no left input/) });
  });

  it("does not let Validate feed Extract", () => {
    const g2 = v2(
      [
        { id: "s", kind: "source", source: INVOICES, rank: 0, order: 0 },
        { id: "v", kind: "step", step: { id: "v", type: "validate", rules: [] }, order: 1 },
        { id: "x", kind: "step", step: { id: "x", type: "split", column: "Details", delimiter: ",", into: ["a"] }, order: 2 },
      ],
      [e("s", "v")],
    ).graph;
    expect(canConnect(g2, "v", "x", "input")).toMatchObject({ ok: false, reason: expect.stringMatching(/Extract before validating/) });
    expect(canConnect(g2, "s", "x", "input")).toEqual({ ok: true });
  });
});

describe("validation", () => {
  const cols = () => ["customer", "amount"];

  it("finds missing inputs, too few datasets, loops and unused tools", () => {
    const g = v2(
      [
        { id: "s", kind: "source", source: INVOICES, rank: 0, order: 0 },
        { id: "ap", kind: "step", step: { id: "ap", type: "append" }, order: 1 },
        { id: "a", kind: "step", step: { id: "a", type: "trim", columns: [], collapseSpaces: false }, order: 2 },
        { id: "b", kind: "step", step: { id: "b", type: "trim", columns: [], collapseSpaces: false }, order: 3 },
        { id: "load", kind: "load", destination: null, order: 9 },
      ],
      [e("s", "ap", "datasets", 0), e("a", "b"), e("b", "a")],
    );
    const msgs = validateGraph(g, cols).map((p) => p.message);
    expect(msgs).toContain("Load requires an input.");
    expect(msgs.some((m) => /needs at least two datasets/.test(m))).toBe(true);
    expect(msgs.some((m) => /part of a loop/.test(m))).toBe(true);
    expect(msgs.some((m) => /not used by any Load/.test(m))).toBe(true);
  });

  it("explains a downstream reference broken by a rename, before anything runs", () => {
    const g = v2(
      [
        { id: "s", kind: "source", source: INVOICES, rank: 0, order: 0 },
        { id: "r", kind: "step", step: { id: "r", type: "rename", mapping: { customer: "client" } }, order: 1 },
        { id: "f", kind: "step", step: { id: "f", type: "filter", column: "customer", op: "not_blank", value: "" }, order: 2 },
        { id: "load", kind: "load", destination: null, order: 3 },
      ],
      [e("s", "r"), e("r", "f"), e("f", "load")],
    );
    expect(validateGraph(g, cols)).toEqual([{ level: "error", nodeId: "f", message: '"customer" is not in the input of Filter rows. Rename columns renamed "customer" to "client".' }]);
  });

  it("checks Join keys against the right input and accepts a valid migrated pipeline", () => {
    const g = migrateSpec(v1);
    const problems = validateGraph(g, (n) => (n.source.fileId === "cust" ? ["customer", "region"] : ["No.", "Customer", "Details", "Amount", "Status", "Remarks", "Created At"]));
    expect(problems.filter((p) => p.level === "error")).toEqual([]);
    const noKeys = migrateSpec({ ...v1, steps: [...v1.steps.slice(0, 7), { ...lookupCust, on: [] }] });
    expect(validateGraph(noKeys).map((p) => p.message)).toContain("Lookup customers.csv has no keys. Choose the columns that identify the same record on both sides.");
  });
});

describe("schema propagation", () => {
  it("infers each node's output columns; pivot is dynamic", () => {
    const g = v2(
      [
        { id: "s", kind: "source", source: INVOICES, rank: 0, order: 0 },
        { id: "sel", kind: "step", step: { id: "sel", type: "select", columns: ["customer", "amount", "status"] }, order: 1 },
        { id: "f", kind: "step", step: { id: "f", type: "formula", output: "tax", expression: "[amount] * 0.06" }, order: 2 },
        { id: "p", kind: "step", step: { id: "p", type: "pivot", index: ["customer"], column: "status", value: "amount", fn: "sum" }, order: 3 },
        { id: "load", kind: "load", destination: null, order: 4 },
      ],
      [e("s", "sel"), e("sel", "f"), e("f", "p"), e("p", "load")],
    ).graph;
    const s = inferSchemas(g, () => ["customer", "amount", "status", "notes"]);
    expect(s.get("sel")).toEqual({ columns: ["customer", "amount", "status"] });
    expect(s.get("f")).toEqual({ columns: ["customer", "amount", "status", "tax"] });
    expect(s.get("p")).toEqual({ dynamic: true });
    expect(s.get("load")).toEqual({ dynamic: true });
  });
});

it("a migrated CSV pipeline with a lookup and a self-append runs identically", () => {
  const customers = parseCsv("customer,region\nEvergreen Ltd,East\nOrion Ventures,Central\n").sheet;
  expectGraphEquivalent(v1, sampleCsv(), { cust: customers, f: sampleCsv() });
});

describe("failures match the linear engine", () => {
  it("a failing step: same error, later steps skipped, last good data reaches Load", () => {
    const broken: PipelineSpec = { ...v1, steps: [...invoiceSteps().slice(0, 3), { id: "bad", type: "filter", column: "nope", op: "not_blank", value: "" }, ...invoiceSteps().slice(3, 6)] };
    const r = expectGraphEquivalent(broken, sampleCsv());
    expect(r.steps.find((s) => s.stepId === "bad")?.error).toBe('Column "nope" not found');
  });

  it("a side file that is not available fails the step that reads it", () => {
    const r = expectGraphEquivalent({ ...v1, steps: v1.steps.slice(0, 8) }, sampleCsv(), {});
    expect(r.steps.find((s) => s.stepId === "lk")?.error).toMatch(/customers.csv" is not available/);
  });
});
