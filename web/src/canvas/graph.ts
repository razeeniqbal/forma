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
  /** "flow": the main chain in execution order. "input": a supporting source feeding a step. */
  kind: "flow" | "input";
}

export interface PipelineGraph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
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
  for (const [consumer, list] of byConsumer) {
    const c = pos[consumer];
    list.forEach((n, k) => (pos[n.id] = { x: c.x + (k - (list.length - 1) / 2) * LAYOUT.sideGap, y: c.y + LAYOUT.rowGap }));
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
    const c = out[n.side.consumers[0]];
    out[n.id] = c ? { x: c.x, y: c.y + LAYOUT.rowGap } : auto[n.id];
  }
  return out;
}

/** Saved positions that still belong to a node of the graph (removed steps drop out). */
export function prunePositions(graph: PipelineGraph, saved: Record<string, XY>): Record<string, XY> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return Object.fromEntries(Object.entries(saved).filter(([id]) => ids.has(id)));
}
