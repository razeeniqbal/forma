// Pipeline canvas model.
//
// POSITION IS VISUAL. CONNECTION IS LOGICAL. EXECUTION IS DETERMINISTIC.
//
// The graph below is *derived* from the PipelineSpec (the only execution model): the main chain
// Source -> steps -> Load in spec order, plus one supporting-source node per project source that a
// Join / Lookup / Append step reads. Node positions live in PipelineCanvasState, separately from the
// spec, and never influence execution, generated Python or parity.
//
// The PipelineGraph shape (nodes + edges) is the one a future graph execution model can adopt. Today
// edges are not user-editable: the canvas only shows connections the engine already honours.
import type { PipelineSpec, Step } from "@/engine/types";
import { toGraphSpec } from "@/engine/graph/spec";
import { executionOrder, inputsOf } from "@/engine/graph/model";

export type CanvasNodeKind = "source" | "transform" | "quality" | "destination";

export interface PipelineNode {
  id: string;
  kind: CanvasNodeKind;
  /** Main source (-1), step index, or the step count for Load. Absent for supporting sources. */
  index?: number;
  /** Supporting source read by join / lookup / append steps. */
  side?: { fileId: string; file: string; sheet?: string; consumers: string[] };
}

export interface PipelineEdge {
  id: string;
  from: string;
  to: string;
  /** "flow": a step's primary input. "input": a second dataset feeding a Join, Lookup or Append. */
  kind: "flow" | "input";
  /** Pipelines with explicit connections: the stored connection this edge draws. */
  role?: string;
}

export interface PipelineGraph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  /** True when the pipeline has explicit, editable connections. */
  explicit?: boolean;
}

export interface XY {
  x: number;
  y: number;
}

export interface Viewport extends XY {
  zoom: number;
}

/** Presentation of one pipeline's canvas. Stored apart from the PipelineSpec. */
export interface PipelineCanvasState {
  pipelineId: string;
  /** Node positions by graph node id. Missing nodes are placed automatically. */
  nodes: Record<string, XY>;
  viewport?: Viewport;
}

export const SOURCE_ID = "source";
export const LOAD_ID = "load";
export const sideId = (fileId: string, sheet?: string) => `side:${fileId}:${sheet ?? ""}`;

const isCombine = (s: Step): s is Extract<Step, { type: "join" | "append" }> => s.type === "join" || s.type === "append";

export function deriveGraph(spec: PipelineSpec): PipelineGraph {
  if (spec.graph) return explicitGraph(spec);
  const nodes: PipelineNode[] = [{ id: SOURCE_ID, kind: "source", index: -1 }];
  const edges: PipelineEdge[] = [];
  const sides = new Map<string, PipelineNode>();
  let prev = SOURCE_ID;
  spec.steps.forEach((step, i) => {
    nodes.push({ id: step.id, kind: step.type === "validate" ? "quality" : "transform", index: i });
    edges.push({ id: `${prev}>${step.id}`, from: prev, to: step.id, kind: "flow" });
    if (isCombine(step) && step.source.fileId) {
      const self = spec.source && step.source.fileId === spec.source.fileId && (step.source.sheet ?? "") === (spec.source.sheet ?? "");
      const from = self ? SOURCE_ID : sideId(step.source.fileId, step.source.sheet);
      if (!self) {
        const existing = sides.get(from);
        if (existing) existing.side!.consumers.push(step.id);
        else sides.set(from, { id: from, kind: "source", side: { fileId: step.source.fileId, file: step.source.file, sheet: step.source.sheet, consumers: [step.id] } });
      }
      edges.push({ id: `${from}>>${step.id}`, from, to: step.id, kind: "input" });
    }
    prev = step.id;
  });
  nodes.push({ id: LOAD_ID, kind: "destination", index: spec.steps.length });
  edges.push({ id: `${prev}>${LOAD_ID}`, from: prev, to: LOAD_ID, kind: "flow" });
  return { nodes: [...nodes, ...sides.values()], edges };
}

/** Canvas graph of a pipeline with explicit connections: exactly its stored nodes and connections. */
function explicitGraph(spec: PipelineSpec): PipelineGraph {
  const g = toGraphSpec(spec).graph;
  const nodes: PipelineNode[] = [];
  for (const n of g.nodes) {
    if (n.kind === "source" && n.id === SOURCE_ID) nodes.push({ id: n.id, kind: "source", index: -1 });
    else if (n.kind === "source")
      nodes.push({ id: n.id, kind: "source", side: { fileId: n.source.fileId, file: n.source.file, sheet: n.source.sheet, consumers: g.edges.filter((e) => e.from === n.id).map((e) => e.to) } });
    // The main Load sits at the end of the chain; extra Loads (branches) have no chain position.
    else if (n.kind === "load") nodes.push({ id: n.id, kind: "destination", ...(n.id === LOAD_ID ? { index: spec.steps.length } : {}) });
    else nodes.push({ id: n.id, kind: n.step.type === "validate" ? "quality" : "transform", index: spec.steps.findIndex((s) => s.id === n.id) });
  }
  const edges: PipelineEdge[] = g.edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    role: e.input,
    kind: e.input === "right" || e.input === "reference" || (e.input === "datasets" && (e.slot ?? 0) >= 1) ? "input" : "flow",
  }));
  return { nodes, edges, explicit: true };
}

/**
 * Layered arrangement by dependency, for pipelines with explicit connections: each node one column right of
 * its furthest input, rows ordered by their inputs' rows so connections cross as little as possible.
 */
function layeredLayout(spec: PipelineSpec, graph: PipelineGraph): Record<string, XY> {
  const g = toGraphSpec(spec).graph;
  const order = executionOrder(g);
  const depth = new Map<string, number>();
  for (const id of order) {
    const ins = inputsOf(g, id).map((e) => depth.get(e.from) ?? 0);
    depth.set(id, ins.length ? Math.max(...ins) + 1 : 0);
  }
  // A source sits one column before its first consumer, so it does not stretch the layout.
  for (const n of g.nodes) {
    if (n.kind !== "source") continue;
    const consumers = g.edges.filter((e) => e.from === n.id).map((e) => depth.get(e.to) ?? 1);
    depth.set(n.id, Math.max(0, (consumers.length ? Math.min(...consumers) : 1) - 1));
  }
  for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);
  const row = new Map<string, number>();
  const columns = new Map<number, string[]>();
  for (const id of [...order, ...graph.nodes.map((n) => n.id).filter((id) => !order.includes(id))]) {
    const d = depth.get(id)!;
    columns.set(d, [...(columns.get(d) ?? []), id]);
  }
  const pos: Record<string, XY> = {};
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(d)!;
    const weight = (id: string) => {
      const ins = inputsOf(g, id).map((e) => row.get(e.from)).filter((r): r is number => r !== undefined);
      return ins.length ? ins[0] : Number.MAX_SAFE_INTEGER;
    };
    ids.sort((a, b) => weight(a) - weight(b));
    ids.forEach((id, k) => {
      row.set(id, k);
      pos[id] = { x: d * LAYOUT.colGap, y: k * LAYOUT.rowGap };
    });
  }
  return pos;
}

/** Auto Layout for any pipeline: by execution order for a chain, by dependency layers otherwise. Presentation only. */
export function arrange(spec: PipelineSpec, graph: PipelineGraph): Record<string, XY> {
  return graph.explicit ? layeredLayout(spec, graph) : autoLayout(graph);
}

/**
 * Layout grid: the main chain reads left to right in execution order and wraps into rows like text, so
 * long pipelines stay legible. Supporting sources sit below the step they feed.
 */
export const LAYOUT = { colGap: 340, rowGap: 210, rowPitch: 270, sideGap: 290, perRow: 6 };

/** Readable arrangement in execution order. Presentation only. */
export function autoLayout(graph: PipelineGraph): Record<string, XY> {
  const pos: Record<string, XY> = {};
  const chain = graph.nodes.filter((n) => n.index !== undefined).sort((a, b) => a.index! - b.index!);
  const consumersWithSides = new Set(graph.nodes.flatMap((n) => (n.side ? [n.side.consumers[0]] : [])));
  let y = 0;
  for (let start = 0; start < chain.length; start += LAYOUT.perRow) {
    const row = chain.slice(start, start + LAYOUT.perRow);
    row.forEach((n, c) => (pos[n.id] = { x: c * LAYOUT.colGap, y }));
    y += LAYOUT.rowPitch + (row.some((n) => consumersWithSides.has(n.id)) ? LAYOUT.rowGap : 0);
  }
  // Group supporting sources under their first consumer, spread side by side when one step reads several.
  const byConsumer = new Map<string, PipelineNode[]>();
  for (const n of graph.nodes) if (n.side) byConsumer.set(n.side.consumers[0], [...(byConsumer.get(n.side.consumers[0]) ?? []), n]);
  let loose = 0;
  for (const [consumer, list] of byConsumer) {
    const c = pos[consumer];
    // A source nothing reads yet (just added to prepare) gets its own row below the pipeline.
    if (!c) list.forEach((n) => (pos[n.id] = { x: loose++ * LAYOUT.colGap, y: y + LAYOUT.rowGap }));
    else list.forEach((n, k) => (pos[n.id] = { x: c.x + (k - (list.length - 1) / 2) * LAYOUT.sideGap, y: c.y + LAYOUT.rowGap }));
  }
  // Anything else (an extra Load) goes beside what feeds it, or on the loose row.
  for (const n of graph.nodes) {
    if (pos[n.id]) continue;
    const from = graph.edges.find((e) => e.to === n.id && pos[e.from]);
    pos[n.id] = from ? { x: pos[from.from].x + LAYOUT.colGap, y: pos[from.from].y + LAYOUT.rowGap } : { x: loose++ * LAYOUT.colGap, y: y + LAYOUT.rowGap };
  }
  return pos;
}

/**
 * Positions for every node: the user's saved layout, with nodes that have no saved position (new steps,
 * new supporting sources) placed next to their neighbours instead of over them.
 */
export function resolvePositions(graph: PipelineGraph, saved: Record<string, XY> | undefined): Record<string, XY> {
  const auto = autoLayout(graph);
  if (!saved || !graph.nodes.some((n) => saved[n.id])) return auto;
  const out: Record<string, XY> = {};
  for (const n of graph.nodes) if (saved[n.id]) out[n.id] = saved[n.id];
  if (graph.explicit) {
    // New nodes go just right of their primary input, on the first free row.
    const taken = (p: XY) => Object.values(out).some((q) => Math.abs(q.x - p.x) < 120 && Math.abs(q.y - p.y) < 80);
    for (let pass = 0; pass < graph.nodes.length; pass++)
      for (const n of graph.nodes) {
        if (out[n.id]) continue;
        const into = graph.edges.find((e) => e.to === n.id && e.kind === "flow" && out[e.from]);
        const outOf = graph.edges.find((e) => e.from === n.id && out[e.to]);
        const anchor = into ? { x: out[into.from].x + LAYOUT.colGap, y: out[into.from].y } : outOf ? { x: out[outOf.to].x - LAYOUT.colGap, y: out[outOf.to].y + LAYOUT.rowGap } : undefined;
        if (!anchor) continue;
        let p = anchor;
        for (let k = 1; taken(p) && k < 20; k++) p = { x: anchor.x, y: anchor.y + k * LAYOUT.rowGap };
        out[n.id] = p;
      }
    for (const n of graph.nodes) if (!out[n.id]) out[n.id] = auto[n.id] ?? { x: 0, y: 0 };
    return out;
  }
  const chain = graph.nodes.filter((n) => n.index !== undefined).sort((a, b) => a.index! - b.index!);
  chain.forEach((n, i) => {
    if (out[n.id]) return;
    const before = chain.slice(0, i).reverse().find((m) => out[m.id]);
    const after = chain.slice(i + 1).find((m) => saved[m.id]);
    const p = before && out[before.id];
    const s = after && saved[after.id];
    if (p && s) out[n.id] = { x: Math.round((p.x + s.x) / 2), y: Math.min(p.y, s.y) - LAYOUT.rowGap * 0.8 };
    else if (p) out[n.id] = { x: p.x + LAYOUT.colGap, y: p.y };
    else if (s) out[n.id] = { x: s.x - LAYOUT.colGap, y: s.y };
    else out[n.id] = auto[n.id];
  });
  for (const n of graph.nodes) {
    if (out[n.id] || !n.side) continue;
    const c = n.side.consumers[0] !== undefined ? out[n.side.consumers[0]] : undefined;
    out[n.id] = c ? { x: c.x, y: c.y + LAYOUT.rowGap } : auto[n.id] ?? { x: 0, y: 0 };
  }
  return out;
}

/** Saved positions that still belong to a node of the graph (removed steps drop out). */
export function prunePositions(graph: PipelineGraph, saved: Record<string, XY>): Record<string, XY> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return Object.fromEntries(Object.entries(saved).filter(([id]) => ids.has(id)));
}
