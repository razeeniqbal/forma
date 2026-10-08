// Editing connections (Phase 9): explicit graphs, connect / disconnect / reconnect, insert / remove.
import { describe, expect, it } from "vitest";
import { invoiceSteps } from "@/engine/demo";
import { execute } from "@/engine/execute";
import { executeSpec } from "@/engine/graph/run";
import { addLoad, addSourceNode, connect, disconnect, graphProblems, insertStep, loadDestination, materialize, reconnect, removeLoad, removeStep, setLoadDestination, syncCombineInputs, toGraphSpec } from "@/engine/graph/spec";
import { arrange, deriveGraph } from "@/canvas/graph";
import { generatePython } from "@/codegen/python";
import type { PipelineSpec, SourceSpec, Step } from "@/engine/types";
import { parseCsv } from "@/parsers";
import { sampleCsv } from "./helpers";

const csv = (file: string, fileId: string, endCol: number): SourceSpec => ({ type: "csv", file, fileId, headerRow: 0, startCol: 0, endCol, csvDelimiter: "," });
const CUSTOMERS = csv("customers.csv", "cust", 1);
const customers = parseCsv("customer,region\n  Evergreen Ltd ,East\nOrion Ventures,Central\nZenith Foods,\n").sheet;
const lookup: Step = { id: "lk", type: "join", source: CUSTOMERS, mode: "lookup", how: "left", on: [{ left: "customer", right: "customer" }], columns: ["region"], prefix: "c_", flagUnmatched: true };
const linear: PipelineSpec = { name: "Edit", source: csv("invoices.csv", "f", 6), steps: [...invoiceSteps().slice(0, 7), lookup], destination: null, reviewDecisions: [] };
const sheets = { cust: customers };
const run = (s: PipelineSpec) => executeSpec(s, sampleCsv(), { sheets });
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return r as Extract<T, { ok: true }>;
};

describe("explicit connections", () => {
  it("making connections explicit changes nothing that runs", () => {
    const explicit = materialize(linear);
    expect(explicit.graph!.edges).toHaveLength(10); // 7 chain steps, the Lookup's two inputs, Load
    const a = execute(linear, sampleCsv(), { sheets });
    const b = run(explicit);
    expect(b.output).toEqual(a.output);
    expect(b.reviewRows).toEqual(a.reviewRows);
    expect(b.issues).toEqual(a.issues);
    expect(b.problems).toEqual([]);
    expect(generatePython(explicit)).toMatch(/@node\("lk"\)/);
  });

  it("prepares the reference before the Lookup: add a source node, clean it, connect it", () => {
    let s = materialize(linear);
    const added = addSourceNode(s, CUSTOMERS);
    s = insertStep(added.spec, { id: "trim_cust", type: "trim", columns: ["customer"], collapseSpaces: true }, s.steps.length, { after: added.id });
    const ref = s.graph!.edges.find((e) => e.to === "lk" && e.input === "reference")!;
    s = ok(reconnect(s, ref.id, { from: "trim_cust" })).spec;
    // The automatic side source is no longer read, so it is dropped; the step describes its new input.
    expect(s.graph!.sources.map((x) => x.id)).toEqual([added.id]);
    expect((s.steps.find((x) => x.id === "lk") as Extract<Step, { type: "join" }>).source).toMatchObject({ fileId: "", file: "Trim text" });
    const before = run(materialize(linear)).output;
    const after = run(s).output;
    const region = (ds: typeof after) => ds.rows.find((r) => r[ds.columns.indexOf("customer")] === "Evergreen Ltd")?.[ds.columns.indexOf("region")];
    // Before trimming, "  Evergreen Ltd " matches nothing: those rows are held for review (unmatched).
    expect(region(before)).toBeUndefined();
    expect(region(after)).toBe("East");
    expect(graphProblems(s).filter((p) => p.level === "error")).toEqual([]);
  });

  it("refuses connections the rules forbid, with the reason", () => {
    const s = materialize(linear);
    expect(connect(s, "load", "lk", "primary")).toEqual({ ok: false, reason: "Load ends a branch. It has no output to connect." });
    expect(connect(s, "lk", "select_columns", "input")).toMatchObject({ ok: false });
  });

  it("disconnecting the Load's input is allowed but reports that Load needs an input", () => {
    const s = materialize(linear);
    const r = ok(disconnect(s, s.graph!.edges.find((e) => e.to === "load")!.id));
    expect(r.problems.map((p) => p.message)).toEqual(["Load requires an input."]);
    expect(run(r.spec).output.rows).toEqual([]);
  });

  it("an Append takes a further dataset on its next slot", () => {
    const s = materialize({ ...linear, steps: [...invoiceSteps().slice(0, 7), { id: "ap", type: "append", source: CUSTOMERS }] });
    const r = ok(connect(s, "trim_text", "ap", "datasets"));
    expect(r.spec.graph!.edges.filter((e) => e.to === "ap").map((e) => e.slot).sort()).toEqual([0, 1, 2]);
  });

  it("removing a step reconnects what it fed to its input", () => {
    const s = materialize(linear);
    const r = removeStep(s, 3); // convert_amount
    const into = r.graph!.edges.find((e) => e.to === "trim_text")!;
    expect(into.from).toBe("standardise_created_at");
    expect(graphProblems(r).filter((p) => p.level === "error")).toEqual([]);
  });

  it("inserting on a connection puts the step between its ends", () => {
    const s = materialize(linear);
    const e = s.graph!.edges.find((x) => x.to === "load")!;
    const r = insertStep(s, { id: "srt", type: "sort", column: "customer", direction: "asc" }, s.steps.length, { edge: e.id });
    expect(r.graph!.edges.find((x) => x.to === "load")!.from).toBe("srt");
    expect(r.graph!.edges.find((x) => x.to === "srt")!.from).toBe("lk");
  });
});

describe("keeping combine steps and connections consistent", () => {
  it("picking a project source in the editor points the second input at it", () => {
    const s = materialize(linear);
    const other = csv("regions.csv", "reg", 1);
    const edited = syncCombineInputs({ ...s, steps: s.steps.map((x) => (x.id === "lk" ? ({ ...x, source: other } as Step) : x)) });
    const ref = edited.graph!.edges.find((e) => e.to === "lk" && e.input === "reference")!;
    expect(ref.from).toBe("side:reg:");
    expect(edited.graph!.sources.map((x) => x.id)).toEqual(["side:reg:"]); // the unused customers node is dropped
  });

  it("switching Lookup to Join renames the inputs to left and right", () => {
    const s = materialize(linear);
    const j = syncCombineInputs({ ...s, steps: s.steps.map((x) => (x.id === "lk" ? ({ ...x, mode: "join" } as Step) : x)) });
    expect(j.graph!.edges.filter((e) => e.to === "lk").map((e) => e.input).sort()).toEqual(["left", "right"]);
  });

  it("ignores connections to steps that no longer exist", () => {
    const s = materialize(linear);
    const g = toGraphSpec({ ...s, graph: { ...s.graph!, edges: [...s.graph!.edges, { id: "x", from: "gone", to: "lk", input: "reference" }] } });
    expect(g.graph.edges.some((e) => e.from === "gone")).toBe(false);
  });
});

describe("canvas for explicit connections", () => {
  it("draws stored connections and arranges them in layers by dependency", () => {
    let s = materialize(linear);
    const added = addSourceNode(s, CUSTOMERS);
    s = insertStep(added.spec, { id: "trim_cust", type: "trim", columns: ["customer"], collapseSpaces: true }, s.steps.length, { after: added.id });
    s = ok(reconnect(s, s.graph!.edges.find((e) => e.to === "lk" && e.input === "reference")!.id, { from: "trim_cust" })).spec;
    const g = deriveGraph(s);
    expect(g.explicit).toBe(true);
    expect(g.edges.find((e) => e.from === "trim_cust")?.kind).toBe("input");
    const pos = arrange(s, g);
    expect(pos["lk"].x).toBeGreaterThan(pos["trim_cust"].x);
    expect(pos["trim_cust"].x).toBeGreaterThan(pos[added.id].x);
    const seen = new Set(Object.values(pos).map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(Object.keys(pos).length); // no two nodes on top of each other
  });
});

describe("branching into several Loads", () => {
  it("a branch Load writes its own output; the main output is unchanged", () => {
    const base = run(materialize(linear));
    const { spec: s, id } = addLoad(linear, "status_case", { type: "file", format: "csv", path: "output/by_status.csv" });
    const r = run(s);
    expect(r.output).toEqual(base.output);
    expect(r.loads!.map((l) => l.id)).toEqual(["load", id]);
    const branch = r.loads!.find((l) => l.id === id)!;
    // The branch reads Change case (title), before Rename: it still has the original column names.
    expect(branch.output.columns).toContain("Customer");
    expect(branch.output.columns).not.toContain("region");
    expect(loadDestination(s, id)).toMatchObject({ path: "output/by_status.csv" });
    expect(graphProblems(s).filter((p) => p.level === "error")).toEqual([]);
  });

  it("removing a branch Load leaves the main Load; an unconnected Load is reported", () => {
    const { spec: s, id } = addLoad(linear, "status_case");
    expect(removeLoad(s, id).graph!.loads).toEqual([]);
    expect(removeLoad(s, "load")).toBe(s);
    const cut = ok(disconnect(s, s.graph!.edges.find((e) => e.to === id)!.id));
    expect(cut.problems.map((p) => p.message)).toEqual(["Load requires an input."]);
  });

  it("the canvas shows the branch Load and places it", () => {
    const { spec: s, id } = addLoad(linear, "status_case");
    const g = deriveGraph(s);
    const n = g.nodes.find((x) => x.id === id)!;
    expect(n.kind).toBe("destination");
    expect(n.index).toBeUndefined();
    expect(arrange(s, g)[id]).toBeDefined();
    expect(setLoadDestination(s, id, { type: "database", table: "wh.by_status" }).graph!.loads![0].destination).toMatchObject({ table: "wh.by_status" });
  });
});
