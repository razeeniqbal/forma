// Pipeline canvas: position is visual, connection is logical, execution is deterministic.
import { beforeEach, describe, expect, it } from "vitest";
import { autoLayout, deriveGraph, LOAD_ID, prunePositions, resolvePositions, SOURCE_ID, sideId } from "@/canvas/graph";
import { invoicePipeline } from "@/engine/demo";
import { execute } from "@/engine/execute";
import { generatePython } from "@/codegen/python";
import { parseCsv } from "@/parsers";
import { useApp } from "@/store/app";
import type { PipelineSpec, SourceFile } from "@/engine/types";
import { sampleSheet } from "./helpers";

const lookup = (id: string, fileId: string, file: string, sheet?: string): PipelineSpec["steps"][number] => ({
  id,
  type: "join",
  source: { type: sheet ? "excel" : "csv", file, fileId, sheet, headerRow: 0, startCol: 0, endCol: 1 },
  mode: "lookup",
  how: "left",
  on: [{ left: "customer", right: "customer" }],
  columns: ["region"],
  prefix: "c_",
  flagUnmatched: false,
});
const append = (id: string, fileId: string, file: string, sheet?: string): PipelineSpec["steps"][number] => ({
  id,
  type: "append",
  source: { type: sheet ? "excel" : "csv", file, fileId, sheet, headerRow: 0, startCol: 0, endCol: 1 },
});

describe("graph derived from the PipelineSpec", () => {
  it("is the main chain in execution order: Source, steps, Load", () => {
    const g = deriveGraph(invoicePipeline("f"));
    const chain = g.nodes.filter((n) => n.index !== undefined).sort((a, b) => a.index! - b.index!).map((n) => n.id);
    expect(chain[0]).toBe(SOURCE_ID);
    expect(chain.at(-1)).toBe(LOAD_ID);
    expect(chain.slice(1, -1)).toEqual(invoicePipeline("f").steps.map((s) => s.id));
    expect(g.edges.every((e) => e.kind === "flow")).toBe(true);
    expect(g.nodes.find((n) => n.id === "validate_invoice")?.kind).toBe("quality");
  });

  it("adds a supporting-source node per project source read by join, lookup and append", () => {
    const spec: PipelineSpec = {
      ...invoicePipeline("main"),
      steps: [append("ap1", "jan", "January.csv"), append("ap2", "feb", "February.csv"), lookup("lk", "cust", "customers.csv"), lookup("lk2", "cust", "customers.csv")],
    };
    const g = deriveGraph(spec);
    const sides = g.nodes.filter((n) => n.side);
    expect(sides.map((n) => n.id).sort()).toEqual([sideId("cust"), sideId("feb"), sideId("jan")].sort());
    expect(g.nodes.find((n) => n.id === sideId("cust"))!.side!.consumers).toEqual(["lk", "lk2"]);
    const inputs = g.edges.filter((e) => e.kind === "input").map((e) => [e.from, e.to]);
    expect(inputs).toEqual([
      [sideId("jan"), "ap1"],
      [sideId("feb"), "ap2"],
      [sideId("cust"), "lk"],
      [sideId("cust"), "lk2"],
    ]);
  });

  it("distinguishes sheets of one workbook and reuses the main source for a self-join", () => {
    const base = invoicePipeline("book");
    const spec: PipelineSpec = { ...base, steps: [append("a", "book", "invoices.xlsx", "Archive"), append("b", "book", "invoices.xlsx", base.source!.sheet)] };
    const g = deriveGraph(spec);
    expect(g.nodes.filter((n) => n.side).map((n) => n.id)).toEqual([sideId("book", "Archive")]);
    expect(g.edges.find((e) => e.to === "b" && e.kind === "input")?.from).toBe(SOURCE_ID);
  });
});

describe("layout", () => {
  const spec: PipelineSpec = { ...invoicePipeline("main"), steps: [...invoicePipeline("main").steps.slice(0, 3), lookup("lk", "cust", "customers.csv"), append("ap", "jan", "jan.csv"), append("ap2", "feb", "feb.csv")] };
  const g = deriveGraph(spec);

  it("auto layout follows execution order left to right with supporting sources below their step", () => {
    const pos = autoLayout(g);
    const chain = g.nodes.filter((n) => n.index !== undefined).sort((a, b) => a.index! - b.index!);
    // Reading order (row by row, left to right) is execution order.
    for (let i = 1; i < chain.length; i++) {
      const a = pos[chain[i - 1].id];
      const b = pos[chain[i].id];
      expect(b.y > a.y || (b.y === a.y && b.x > a.x)).toBe(true);
    }
    expect(Math.max(...chain.map((n) => pos[n.id].x))).toBeLessThan(6 * 340);
    expect(pos[sideId("cust")]).toEqual({ x: pos.lk.x, y: pos.lk.y + 210 });
    // No two nodes share a slot.
    const slots = Object.values(pos).map((p) => `${p.x},${p.y}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("keeps saved positions and places new nodes beside their neighbours", () => {
    const saved = { [SOURCE_ID]: { x: -500, y: 40 }, select_columns: { x: 10, y: 400 }, lk: { x: 900, y: 900 } };
    const pos = resolvePositions(g, saved);
    expect(pos[SOURCE_ID]).toEqual(saved[SOURCE_ID]);
    expect(pos.select_columns).toEqual(saved.select_columns);
    expect(pos.lk).toEqual(saved.lk);
    // extract sits after select (only predecessor saved before lk) and its side source sits under its consumer.
    expect(pos[sideId("cust")]).toEqual({ x: 900, y: 900 + 210 });
    expect(Object.keys(pos).sort()).toEqual(g.nodes.map((n) => n.id).sort());
  });

  it("without saved positions uses auto layout; removed nodes drop out of saved layout", () => {
    expect(resolvePositions(g, undefined)).toEqual(autoLayout(g));
    expect(prunePositions(g, { gone: { x: 1, y: 1 }, lk: { x: 2, y: 2 } })).toEqual({ lk: { x: 2, y: 2 } });
  });
});

describe("moving nodes never changes execution", () => {
  beforeEach(async () => {
    await useApp.getState().resetAll();
  });

  it("random positions for every node: same output, same generated Python, spec untouched", async () => {
    const app = useApp.getState();
    const project = app.createProject({ name: "Canvas" });
    const sheet = await sampleSheet();
    const file: SourceFile = { id: "src_inv", name: "invoices.xlsx", kind: "excel", size: 1, addedAt: 1, sheets: [sheet] };
    const meta = await app.addSource(file, project.id);
    const p = app.createPipelineFromSpec({ ...invoicePipeline(meta.id), name: "Clean Invoices" }, project.id);
    const specBefore = JSON.stringify(useApp.getState().pipelines.find((x) => x.id === p.id)!.spec);
    const before = execute(p.spec, sheet);
    // The header records when the file was generated; everything else must match exactly.
    const py = (spec: PipelineSpec) => generatePython(spec, { version: 1 }).replace(/Generated on: .*/, "");
    const pyBefore = py(p.spec);

    const graph = deriveGraph(p.spec);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 4000 - 2000;
    app.setCanvasLayout(p.id, Object.fromEntries(graph.nodes.map((n) => [n.id, { x: rnd(), y: rnd() }])), true);
    app.setCanvasViewport(p.id, { x: rnd(), y: rnd(), zoom: 0.37 });

    const after = useApp.getState().pipelines.find((x) => x.id === p.id)!;
    expect(JSON.stringify(after.spec)).toBe(specBefore);
    expect(after.updatedAt).toBe(p.updatedAt);
    const res = execute(after.spec, sheet);
    expect(res.output).toEqual(before.output);
    expect(res.reviewRows).toEqual(before.reviewRows);
    expect(res.issues).toEqual(before.issues);
    expect(py(after.spec)).toBe(pyBefore);
    expect(Object.keys(useApp.getState().canvases[p.id].nodes)).toHaveLength(graph.nodes.length);
  });

  it("canvas state is stored per pipeline and follows duplicate / delete", async () => {
    const app = useApp.getState();
    const project = app.createProject({ name: "Canvas" });
    const { sheet } = parseCsv("a,b\n1,2\n");
    const meta = await app.addSource({ id: "s1", name: "a.csv", kind: "csv", size: 1, addedAt: 1, sheets: [sheet] }, project.id);
    const p = await app.createPipeline(project.id, "P", meta);
    app.setCanvasLayout(p.id, { [SOURCE_ID]: { x: 5, y: 6 } });
    app.setCanvasLayout(p.id, { [LOAD_ID]: { x: 7, y: 8 } });
    app.setCanvasViewport(p.id, { x: 1, y: 2, zoom: 0.8 });
    expect(useApp.getState().canvases[p.id]).toEqual({ pipelineId: p.id, nodes: { [SOURCE_ID]: { x: 5, y: 6 }, [LOAD_ID]: { x: 7, y: 8 } }, viewport: { x: 1, y: 2, zoom: 0.8 } });
    const copy = app.duplicatePipeline(p.id)!;
    expect(useApp.getState().canvases[copy.id].nodes).toEqual(useApp.getState().canvases[p.id].nodes);
    app.deletePipeline(p.id);
    expect(useApp.getState().canvases[p.id]).toBeUndefined();
    await useApp.getState().deleteProject(project.id);
    expect(useApp.getState().canvases).toEqual({});
  });
});
