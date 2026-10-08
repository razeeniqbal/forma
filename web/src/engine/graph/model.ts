// Graph model operations: migration from the linear PipelineSpec, execution order, contracts,
// connection compatibility, validation and schema inference (GRAPH_ENGINE_DESIGN.md §3 to §9).
// Everything here is pure and deterministic, and nothing reads node positions.
import type { PipelineSpec, Step } from "../types";
import { stepColumns, stepTitle } from "../registry";
import { operationOf, type InputRole } from "../taxonomy";
import type { GraphEdge, GraphNode, InputRoleId, NodeStep, PipelineGraph, PipelineSpecV2, Problem, SourceNode } from "./types";

export const PRIMARY_ID = "source";
export const LOAD_ID = "load";
/** Same ids as the canvas, so saved positions carry over. */
export const sideNodeId = (fileId: string, sheet?: string) => `side:${fileId}:${sheet ?? ""}`;

const edgeId = (from: string, to: string, input: InputRoleId, slot?: number) => `${from}>${to}:${input}${slot !== undefined ? slot : ""}`;

/** The step as the engine's Step type, for code that only reads its configuration (not titles). */
export const asStep = (s: NodeStep) => s as Step;

// ------------------------------------------------------------------ migration

/**
 * PipelineSpec (v1, linear) → PipelineSpecV2. Pure and deterministic. Node ids equal today's canvas ids
 * (`source`, step ids, `side:<fileId>:<sheet>`, `load`). A combine step that reads the main source file
 * gets its own source node too: today it reads the whole file even when the main source is sampled.
 */
export function migrateSpec(spec: PipelineSpec): PipelineSpecV2 {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // Rank 0 is always the main source's, even before one is chosen; ranks are never reused.
  let rank = 1;
  if (spec.source) nodes.push({ id: PRIMARY_ID, kind: "source", order: -1, source: spec.source, rank: 0 });
  const sides = new Map<string, SourceNode>();
  let prev: string | null = spec.source ? PRIMARY_ID : null;
  spec.steps.forEach((step, i) => {
    let config: NodeStep = step;
    if (step.type === "join" || step.type === "append") {
      const { source, ...rest } = step;
      config = rest;
      if (source.fileId) {
        const id = sideNodeId(source.fileId, source.sheet);
        if (!sides.has(id)) {
          const n: SourceNode = { id, kind: "source", order: i - 0.5, source, rank: rank++ };
          sides.set(id, n);
          nodes.push(n);
        }
        const role: InputRoleId = step.type === "append" ? "datasets" : step.mode === "lookup" ? "reference" : "right";
        edges.push({ id: edgeId(id, step.id, role, step.type === "append" ? 1 : undefined), from: id, to: step.id, input: role, ...(step.type === "append" ? { slot: 1 } : {}) });
      }
    }
    nodes.push({ id: step.id, kind: "step", order: i, step: config });
    if (prev) {
      const role: InputRoleId = step.type === "append" ? "datasets" : step.type === "join" ? (step.mode === "lookup" ? "primary" : "left") : "input";
      edges.push({ id: edgeId(prev, step.id, role, step.type === "append" ? 0 : undefined), from: prev, to: step.id, input: role, ...(step.type === "append" ? { slot: 0 } : {}) });
    }
    prev = step.id;
  });
  nodes.push({ id: LOAD_ID, kind: "load", order: spec.steps.length, destination: spec.destination });
  if (prev) edges.push({ id: edgeId(prev, LOAD_ID, "input"), from: prev, to: LOAD_ID, input: "input" });
  return { formaSpec: 2, name: spec.name, graph: { nodes, edges }, reviewDecisions: spec.reviewDecisions };
}

// ------------------------------------------------------------------ contracts and inputs

/** Input roles a node accepts, in evaluation order (the primary role first). */
export function contractOf(node: GraphNode): InputRole[] {
  if (node.kind === "source") return [];
  if (node.kind === "load") return [{ role: "input", label: "Input", cardinality: "one" }];
  return operationOf(asStep(node.step)).contract.inputs;
}

const ROLE_RANK: Record<InputRoleId, number> = { input: 0, left: 0, primary: 0, datasets: 0, right: 1, reference: 1 };

/** Edges into a node, primary input first, then by slot. */
export function inputsOf(graph: PipelineGraph, id: string): GraphEdge[] {
  return graph.edges
    .filter((e) => e.to === id)
    .sort((a, b) => ROLE_RANK[a.input] - ROLE_RANK[b.input] || (a.slot ?? 0) - (b.slot ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const nodeById = (graph: PipelineGraph, id: string) => graph.nodes.find((n) => n.id === id);

/**
 * A step node as the engine's Step type. Combine steps read their second dataset from an edge, so for titles
 * and messages they get a descriptive source named after that input ("Lookup customers.csv"). The executor
 * never loads it: the dataset arrives through the connection.
 */
export function stepOf(graph: PipelineGraph, node: Extract<GraphNode, { kind: "step" }>): Step {
  const s = node.step;
  if (s.type !== "join" && s.type !== "append") return s as Step;
  const second = inputsOf(graph, node.id)[1];
  const from = second && nodeById(graph, second.from);
  const file = from ? nodeTitle(from, graph) : "";
  const sheet = from?.kind === "source" ? from.source.sheet : undefined;
  return { ...s, source: { type: "csv", file, fileId: "", sheet, headerRow: 0, startCol: 0, endCol: 0 } } as Step;
}

/** A readable name for a node, used in messages and in generated code. */
export function nodeTitle(node: GraphNode, graph?: PipelineGraph): string {
  if (node.kind === "source") return node.source.file || "Source";
  if (node.kind === "load") return "Load";
  if (node.label) return node.label;
  return graph ? stepTitle(stepOf(graph, node)).trim() : node.step.label || node.step.type;
}

// ------------------------------------------------------------------ order

const byOrder = (a: GraphNode, b: GraphNode) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Execution order: every source first (by creation order), then Kahn's algorithm with creation order as the
 * only tie-break. Positions never take part. Nodes on or behind a cycle are left out (validation reports them).
 */
export function executionOrder(graph: PipelineGraph): string[] {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (indeg.has(e.to) && indeg.has(e.from)) indeg.set(e.to, indeg.get(e.to)! + 1);
  const out: string[] = [];
  const ready = graph.nodes.filter((n) => indeg.get(n.id) === 0).sort((a, b) => Number(b.kind === "source") - Number(a.kind === "source") || byOrder(a, b));
  const done = new Set<string>();
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n.id);
    done.add(n.id);
    const next: GraphNode[] = [];
    for (const e of graph.edges) {
      if (e.from !== n.id || !indeg.has(e.to)) continue;
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0 && !done.has(e.to)) next.push(nodeById(graph, e.to)!);
    }
    ready.push(...next);
    // Sources stay first; among the rest, the earliest created runs next.
    ready.sort((a, b) => Number(b.kind === "source") - Number(a.kind === "source") || byOrder(a, b));
  }
  return out;
}

/** Every node upstream of `id`. */
export function ancestors(graph: PipelineGraph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) if (e.to === cur && !seen.has(e.from)) {
      seen.add(e.from);
      stack.push(e.from);
    }
  }
  return seen;
}

/** Whether `from` → `to` would close a loop. */
export const wouldCycle = (graph: PipelineGraph, from: string, to: string) => from === to || ancestors(graph, from).has(to);

// ------------------------------------------------------------------ compatibility

export type Connectable = { ok: true } | { ok: false; reason: string };

/** One table for every caller: validation, canvas handles and compatible-target highlighting (§6.1). */
export function canConnect(graph: PipelineGraph, fromId: string, toId: string, role: InputRoleId): Connectable {
  const from = nodeById(graph, fromId);
  const to = nodeById(graph, toId);
  if (!from || !to) return { ok: false, reason: "That node no longer exists." };
  if (from.kind === "load") return { ok: false, reason: "Load ends a branch. It has no output to connect." };
  if (to.kind === "source") return { ok: false, reason: "A source brings data in. It has no inputs." };
  if (fromId === toId) return { ok: false, reason: "A tool cannot read its own output." };
  const contract = contractOf(to);
  const slot = contract.find((c) => c.role === role);
  if (!slot) return { ok: false, reason: `${nodeTitle(to, graph)} has no ${role} input.` };
  if (slot.cardinality === "one" && graph.edges.some((e) => e.to === toId && e.input === role)) return { ok: false, reason: `${nodeTitle(to, graph)} already has its ${slot.label.toLowerCase()}. Disconnect it first.` };
  if (graph.edges.some((e) => e.from === fromId && e.to === toId)) return { ok: false, reason: "These tools are already connected." };
  if (from.kind === "step" && to.kind === "step" && operationOf(asStep(from.step)).category === "validate" && operationOf(asStep(to.step)).category === "extract")
    return { ok: false, reason: "Extract before validating: rules check the fields that extraction creates." };
  if (wouldCycle(graph, fromId, toId)) return { ok: false, reason: `This connection would make FORMA run ${nodeTitle(to, graph)} before itself. Pipelines run in one direction, so loops are not supported.` };
  return { ok: true };
}

// ------------------------------------------------------------------ schema

export type Schema = { columns: string[] } | { dynamic: true } | null;

const cols = (s: Schema) => (s && "columns" in s ? s.columns : null);
const plus = (base: string[], add: string[]) => [...base, ...add.filter((c) => !base.includes(c))];

/** Output columns of a step given its input schemas, without data where possible (§8). Pivot is dynamic. */
export function stepSchema(step: Step, inputs: Schema[]): Schema {
  const [a, b] = inputs.map(cols);
  if (inputs[0] && "dynamic" in inputs[0]) return { dynamic: true };
  if (!a) return null;
  switch (step.type) {
    case "select":
      return { columns: step.columns.slice() };
    case "rename":
      return { columns: a.map((c) => step.mapping[c] || c) };
    case "extract":
      return { columns: plus(a, step.fields.map((f) => f.name)) };
    case "extract_kv":
      return { columns: plus(a, step.keys.map((k) => k.name)) };
    case "split":
      return { columns: plus(a, step.into) };
    case "formula":
      return { columns: plus(a, [step.output]) };
    case "group":
      return { columns: [...step.by, ...step.aggs.map((g) => g.as)] };
    case "pivot":
      return { dynamic: true };
    case "unpivot":
      return { columns: [...step.keep, step.nameColumn || "variable", step.valueColumn || "value"] };
    case "join":
      return b ? { columns: [...a, ...step.columns.map((c) => (a.includes(c) ? `${step.prefix}${c}` : c))] } : null;
    case "append": {
      if (!b) return null;
      const mapped = b.map((c) => step.mapping?.[c] || c);
      return { columns: plus(a, mapped) };
    }
    default:
      return { columns: a.slice() };
  }
}

/** Output schema of every node, in execution order. `sourceColumns` supplies what a source loads. */
export function inferSchemas(graph: PipelineGraph, sourceColumns: (node: SourceNode) => string[] | undefined): Map<string, Schema> {
  const out = new Map<string, Schema>();
  for (const id of executionOrder(graph)) {
    const n = nodeById(graph, id)!;
    if (n.kind === "source") {
      const c = sourceColumns(n);
      out.set(id, c ? { columns: c } : null);
      continue;
    }
    const ins = inputsOf(graph, id).map((e) => out.get(e.from) ?? null);
    if (n.kind === "load") out.set(id, ins[0] ?? null);
    else {
      let s: Schema = ins[0] ?? null;
      // Append folds every further dataset in, slot by slot.
      if (n.step.type === "append") for (const extra of ins.slice(1)) s = stepSchema(asStep(n.step), [s, extra]);
      else s = stepSchema(asStep(n.step), ins);
      out.set(id, s);
    }
  }
  return out;
}

// ------------------------------------------------------------------ validation

/** Why a node cannot run for lack of inputs, or null when its required inputs are all connected. */
export function missingInput(graph: PipelineGraph, node: GraphNode): string | null {
  const ins = graph.edges.filter((e) => e.to === node.id);
  for (const c of contractOf(node)) {
    const count = ins.filter((e) => e.input === c.role).length;
    if (c.cardinality === "many" && count < 2) return `${nodeTitle(node, graph)} needs at least two datasets.`;
    if (c.cardinality === "one" && count === 0) return node.kind === "load" ? "Load requires an input." : `${nodeTitle(node, graph)} needs its ${c.label.toLowerCase()}.`;
  }
  return null;
}

/** Upstream cause for a column missing at `id` on its primary path, as a sentence. */
function explainMissing(graph: PipelineGraph, id: string, col: string): string {
  let cur = inputsOf(graph, id)[0]?.from;
  while (cur) {
    const n = nodeById(graph, cur)!;
    if (n.kind !== "step") break;
    const s = asStep(n.step);
    if (s.type === "rename" && s.mapping[col]) return ` ${nodeTitle(n, graph)} renamed "${col}" to "${s.mapping[col]}".`;
    if (s.type === "select" && !s.columns.includes(col)) return ` ${nodeTitle(n, graph)} does not keep "${col}".`;
    cur = inputsOf(graph, cur)[0]?.from;
  }
  return "";
}

/**
 * Structural and configuration problems, each attached to a node or edge (§6). Errors stop a run before it
 * starts; warnings are shown but do not block.
 */
export function validateGraph(spec: PipelineSpecV2, sourceColumns: (node: SourceNode) => string[] | undefined = () => undefined): Problem[] {
  const { graph } = spec;
  const problems: Problem[] = [];
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) problems.push({ level: "error", nodeId: n.id, message: `Two tools share the id "${n.id}".` });
    ids.add(n.id);
  }
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) problems.push({ level: "error", edgeId: e.id, message: "This connection points at a tool that no longer exists." });
    else if (e.from === e.to) problems.push({ level: "error", edgeId: e.id, message: "A tool cannot read its own output." });
  }
  const ordered = new Set(executionOrder(graph));
  for (const n of graph.nodes) {
    if (!ordered.has(n.id)) problems.push({ level: "error", nodeId: n.id, message: `${nodeTitle(n, graph)} is part of a loop. Pipelines run in one direction, so loops are not supported.` });
    const ins = graph.edges.filter((e) => e.to === n.id);
    const outs = graph.edges.filter((e) => e.from === n.id);
    if (n.kind === "source" && ins.length) problems.push({ level: "error", nodeId: n.id, message: "A source brings data in. It has no inputs." });
    if (n.kind === "load" && outs.length) problems.push({ level: "error", nodeId: n.id, message: "Load ends a branch. It cannot feed another tool." });
    const contract = contractOf(n);
    for (const e of ins) if (!contract.some((c) => c.role === e.input)) problems.push({ level: "error", edgeId: e.id, nodeId: n.id, message: `${nodeTitle(n, graph)} has no ${e.input} input.` });
    const missing = missingInput(graph, n);
    if (missing) problems.push({ level: "error", nodeId: n.id, message: missing });
    for (const c of contract) {
      const count = ins.filter((e) => e.input === c.role).length;
      if (c.cardinality === "one" && count > 1) problems.push({ level: "error", nodeId: n.id, message: `${nodeTitle(n, graph)} has more than one ${c.label.toLowerCase()}.` });
    }
  }
  // Nodes that do not lead to any Load are not used by the pipeline.
  const used = new Set<string>();
  for (const l of graph.nodes) if (l.kind === "load") for (const a of [l.id, ...ancestors(graph, l.id)]) used.add(a);
  if (!graph.nodes.some((n) => n.kind === "load")) problems.push({ level: "error", message: "The pipeline has no Load." });
  for (const n of graph.nodes) if (!used.has(n.id) && n.kind !== "load") problems.push({ level: "warning", nodeId: n.id, message: `${nodeTitle(n, graph)} is not used by any Load.` });

  // Configuration against the columns that actually reach each tool.
  const schemas = inferSchemas(graph, sourceColumns);
  for (const n of graph.nodes) {
    if (n.kind !== "step") continue;
    const ins = inputsOf(graph, n.id).map((e) => cols(schemas.get(e.from) ?? null));
    const input = ins[0];
    const step = asStep(n.step);
    if (input) {
      const missing = [...new Set(stepColumns(step))].filter((c) => c && !input.includes(c));
      for (const c of missing) problems.push({ level: "error", nodeId: n.id, message: `"${c}" is not in the input of ${nodeTitle(n, graph)}.${explainMissing(graph, n.id, c)}` });
    }
    if (step.type === "join") {
      if (!step.on.length) problems.push({ level: "error", nodeId: n.id, message: `${nodeTitle(n, graph)} has no keys. Choose the columns that identify the same record on both sides.` });
      const right = ins[1];
      if (right) {
        for (const k of step.on) if (k.right && !right.includes(k.right)) problems.push({ level: "error", nodeId: n.id, message: `Key "${k.right}" is not in the ${step.mode === "lookup" ? "reference dataset" : "right input"}.` });
        for (const c of step.columns) if (!right.includes(c)) problems.push({ level: "error", nodeId: n.id, message: `"${c}" is not in the ${step.mode === "lookup" ? "reference dataset" : "right input"}.` });
      }
    }
    if (step.type === "append" && step.mapping) {
      const targets = Object.values(step.mapping).filter(Boolean);
      if (new Set(targets).size !== targets.length) problems.push({ level: "error", nodeId: n.id, message: "Two appended columns map to the same column." });
      for (const extra of ins.slice(1)) if (extra) for (const from of Object.keys(step.mapping)) if (step.mapping[from] && !extra.includes(from)) problems.push({ level: "error", nodeId: n.id, message: `Mapped column "${from}" is not in an appended dataset.` });
    }
  }
  return problems;
}
