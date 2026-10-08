// Editing a pipeline's connections (Phase 9). A pipeline is stored as a PipelineSpec; once someone edits a
// connection it carries an explicit `graph` (other sources + every connection) and execution follows it.
// Every operation here is pure, validated against the one compatibility table (`canConnect`), and keeps a
// combine step's `source` field in step with its second input, so the existing editors keep working.
import type { PipelineSpec, SourceSpec, Step, StoredGraph } from "../types";
import { operationOf } from "../taxonomy";
import { stepTitle } from "../registry";
import { canConnect, LOAD_ID, migrateSpec, PRIMARY_ID, sideNodeId, validateGraph } from "./model";
import type { GraphEdge, GraphNode, InputRoleId, NodeStep, PipelineSpecV2, Problem } from "./types";

type Edge = StoredGraph["edges"][number];
type Combine = Extract<Step, { type: "join" | "append" }>;

const isCombine = (s: Step): s is Combine => s.type === "join" || s.type === "append";
const strip = (s: Step): NodeStep => {
  if (!isCombine(s)) return s;
  const { source: _source, ...rest } = s;
  return rest;
};

export const edgeIdOf = (from: string, to: string, input: InputRoleId, slot?: number) => `${from}>${to}:${input}${slot ?? ""}`;
const sameSource = (a: SourceSpec, b: SourceSpec) => a.fileId === b.fileId && (a.sheet ?? "") === (b.sheet ?? "");

/** The pipeline as a graph: its explicit connections, or the linear chain migrated (§9.1). */
export function toGraphSpec(spec: PipelineSpec): PipelineSpecV2 {
  if (!spec.graph) return migrateSpec(spec);
  const nodes: GraphNode[] = [];
  if (spec.source) nodes.push({ id: PRIMARY_ID, kind: "source", order: -1, source: spec.source, rank: 0 });
  for (const s of spec.graph.sources) nodes.push({ id: s.id, kind: "source", order: s.order, source: s.source, rank: s.rank });
  spec.steps.forEach((st, i) => nodes.push({ id: st.id, kind: "step", order: i, step: strip(st) }));
  nodes.push({ id: LOAD_ID, kind: "load", order: spec.steps.length, destination: spec.destination });
  for (const l of spec.graph.loads ?? []) nodes.push({ id: l.id, kind: "load", order: l.order, destination: l.destination });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = spec.graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { formaSpec: 2, name: spec.name, graph: { nodes, edges }, reviewDecisions: spec.reviewDecisions };
}

/** Give a linear pipeline explicit connections, equal to its chain (no change in what runs). */
export function materialize(spec: PipelineSpec): PipelineSpec {
  if (spec.graph) return spec;
  const m = migrateSpec(spec);
  const sources = m.graph.nodes.flatMap((n) => (n.kind === "source" && n.id !== PRIMARY_ID ? [{ id: n.id, source: n.source, rank: n.rank, order: n.order }] : []));
  return { ...spec, graph: { sources, edges: m.graph.edges, nextRank: Math.max(0, ...sources.map((s) => s.rank)) + 1 } };
}

/** Primary input role of a step (the role its main data arrives on). */
export function primaryRole(step: Step | NodeStep): InputRoleId {
  return operationOf(step as Step).contract.inputs[0]?.role ?? "input";
}

/** Second-input role of a combine step. */
const secondaryRole = (s: Combine): InputRoleId => (s.type === "append" ? "datasets" : s.mode === "lookup" ? "reference" : "right");
const isSecondary = (e: Edge) => e.input === "right" || e.input === "reference" || (e.input === "datasets" && (e.slot ?? 0) >= 1);

/**
 * Keep combine steps and connections consistent. Connections are the truth, except right after an editor
 * picks a project source (the step's `source` names a file its second input does not read yet): then the
 * second input is pointed at that source. Also renames input roles when a step switches between Lookup and
 * Join, and drops source nodes that nothing reads.
 */
export function syncCombineInputs(spec: PipelineSpec): PipelineSpec {
  if (!spec.graph) return spec;
  const sources = spec.graph.sources.map((s) => ({ ...s }));
  let edges = spec.graph.edges.slice();
  let nextRank = spec.graph.nextRank;
  const stepIds = new Set(spec.steps.map((s) => s.id));
  const sourceOf = (id: string) => (id === PRIMARY_ID ? spec.source ?? undefined : sources.find((s) => s.id === id)?.source);
  const titleOf = (id: string) => {
    const st = spec.steps.find((s) => s.id === id);
    return st ? stepTitle(st) : sourceOf(id)?.file ?? id;
  };

  const steps = spec.steps.map((st, i) => {
    if (!isCombine(st)) return st;
    // Lookup and Join name their inputs differently.
    if (st.type === "join") {
      const rename: Partial<Record<InputRoleId, InputRoleId>> = st.mode === "lookup" ? { left: "primary", right: "reference" } : { primary: "left", reference: "right" };
      edges = edges.map((e) => (e.to === st.id && rename[e.input] ? { ...e, input: rename[e.input]!, id: edgeIdOf(e.from, e.to, rename[e.input]!, e.slot) } : e));
    }
    const second = edges.filter((e) => e.to === st.id && isSecondary(e)).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))[0];
    if (st.source.fileId) {
      const from = second && sourceOf(second.from);
      if (from && sameSource(from, st.source)) {
        // Same file: carry header / region settings onto its source node.
        const node = sources.find((s) => s.id === second.from);
        if (node && JSON.stringify(node.source) !== JSON.stringify(st.source)) node.source = st.source;
        return st;
      }
      // The editor picked a project source: read it through its own source node.
      const id = sideNodeId(st.source.fileId, st.source.sheet);
      const node = sources.find((s) => s.id === id);
      if (!node) sources.push({ id, source: st.source, rank: nextRank++, order: i - 0.5 });
      else if (JSON.stringify(node.source) !== JSON.stringify(st.source)) node.source = st.source;
      const role = secondaryRole(st);
      const slot = st.type === "append" ? second?.slot ?? 1 : undefined;
      edges = edges.filter((e) => e !== second);
      edges.push({ id: edgeIdOf(id, st.id, role, slot), from: id, to: st.id, input: role, ...(slot !== undefined ? { slot } : {}) });
      return st;
    }
    if (!second) return st;
    // Connections are the truth: describe the second input on the step.
    const src = sourceOf(second.from);
    const described: SourceSpec = src && !stepIds.has(second.from) ? src : { type: "csv", file: titleOf(second.from), fileId: "", headerRow: 0, startCol: 0, endCol: 0 };
    return JSON.stringify(described) === JSON.stringify(st.source) ? st : ({ ...st, source: described } as Step);
  });

  // Drop connections to removed steps, and automatic source nodes nothing reads.
  const nodeIds = new Set([PRIMARY_ID, LOAD_ID, ...steps.map((s) => s.id), ...sources.map((s) => s.id), ...(spec.graph.loads ?? []).map((l) => l.id)]);
  edges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const kept = sources.filter((s) => !s.id.startsWith("side:") || edges.some((e) => e.from === s.id));
  edges = edges.filter((e) => e.from === PRIMARY_ID || e.from === LOAD_ID || !e.from.startsWith("side:") || kept.some((s) => s.id === e.from));
  const graph: StoredGraph = { ...spec.graph, sources: kept, edges, nextRank };
  const next = { ...spec, steps, graph };
  return JSON.stringify(next) === JSON.stringify(spec) ? spec : next;
}

export type EditResult = { ok: true; spec: PipelineSpec; problems: Problem[] } | { ok: false; reason: string };

/** Structural errors that an edit introduced (shown before it is kept). */
function newErrors(before: PipelineSpec, after: PipelineSpec): Problem[] {
  const had = new Set(validateGraph(toGraphSpec(before)).filter((p) => p.level === "error").map((p) => p.message));
  return validateGraph(toGraphSpec(after)).filter((p) => p.level === "error" && !had.has(p.message));
}

const nextSlot = (edges: Edge[], to: string) => Math.max(-1, ...edges.filter((e) => e.to === to && e.input === "datasets").map((e) => e.slot ?? 0)) + 1;

/** Connect `from`'s output to `to`'s input `role`. Refused with a reason when the table forbids it. */
export function connect(spec: PipelineSpec, from: string, to: string, role: InputRoleId): EditResult {
  const s = materialize(spec);
  const check = canConnect(toGraphSpec(s).graph, from, to, role);
  if (!check.ok) return check;
  const slot = role === "datasets" ? nextSlot(s.graph!.edges, to) : undefined;
  const edge: Edge = { id: edgeIdOf(from, to, role, slot), from, to, input: role, ...(slot !== undefined ? { slot } : {}) };
  // A combine step's second input now comes from this connection, not from the file it named.
  const steps = s.steps.map((st) => (st.id === to && isCombine(st) && isSecondary(edge) ? ({ ...st, source: { ...st.source, fileId: "" } } as Step) : st));
  const next = syncCombineInputs({ ...s, steps, graph: { ...s.graph!, edges: [...s.graph!.edges, edge] } });
  return { ok: true, spec: next, problems: newErrors(s, next) };
}

/** Remove a connection. The result may be incomplete; its new problems are returned for confirmation. */
export function disconnect(spec: PipelineSpec, edgeId: string): EditResult {
  const s = materialize(spec);
  const edge = s.graph!.edges.find((e) => e.id === edgeId);
  if (!edge) return { ok: false, reason: "That connection no longer exists." };
  const steps = s.steps.map((st) => (st.id === edge.to && isCombine(st) && isSecondary(edge) ? ({ ...st, source: { ...st.source, fileId: "", file: "" } } as Step) : st));
  const next = syncCombineInputs({ ...s, steps, graph: { ...s.graph!, edges: s.graph!.edges.filter((e) => e.id !== edgeId) } });
  return { ok: true, spec: next, problems: newErrors(s, next) };
}

/** Move one end of a connection: a new producer (`from`) or a new consumer and role (`to`, `role`). */
export function reconnect(spec: PipelineSpec, edgeId: string, change: { from?: string; to?: string; role?: InputRoleId }): EditResult {
  const s = materialize(spec);
  const edge = s.graph!.edges.find((e) => e.id === edgeId);
  if (!edge) return { ok: false, reason: "That connection no longer exists." };
  const without = { ...s, graph: { ...s.graph!, edges: s.graph!.edges.filter((e) => e.id !== edgeId) } };
  const r = connect(without, change.from ?? edge.from, change.to ?? edge.to, change.role ?? edge.input);
  return r.ok ? { ...r, problems: newErrors(s, r.spec) } : r;
}

/**
 * Insert a new step into a pipeline with explicit connections: on a connection (it takes that connection's
 * place), or after a node (between it and its only consumer, else as a new branch from it).
 */
export function insertStep(spec: PipelineSpec, step: Step, index: number, at: { edge: string } | { after: string }): PipelineSpec {
  const s = materialize(spec);
  const steps = [...s.steps.slice(0, index), step, ...s.steps.slice(index)];
  let edges = s.graph!.edges.slice();
  const role = primaryRole(step);
  const inSlot = role === "datasets" ? 0 : undefined;
  const target = "edge" in at ? edges.find((e) => e.id === at.edge) : (() => {
    const outs = edges.filter((e) => e.from === at.after);
    return outs.length === 1 ? outs[0] : undefined;
  })();
  const from = target ? target.from : "after" in at ? at.after : undefined;
  if (target) {
    edges = edges.filter((e) => e !== target);
    edges.push({ id: edgeIdOf(step.id, target.to, target.input, target.slot), from: step.id, to: target.to, input: target.input, ...(target.slot !== undefined ? { slot: target.slot } : {}) });
  }
  if (from) edges.push({ id: edgeIdOf(from, step.id, role, inSlot), from, to: step.id, input: role, ...(inSlot !== undefined ? { slot: inSlot } : {}) });
  return syncCombineInputs({ ...s, steps, graph: { ...s.graph!, edges } });
}

/** Remove a step; whatever it fed now reads the step's own primary input, so a chain stays connected. */
export function removeStep(spec: PipelineSpec, index: number): PipelineSpec {
  const s = materialize(spec);
  const step = s.steps[index];
  if (!step) return spec;
  const edges = s.graph!.edges;
  const primary = edges.find((e) => e.to === step.id && !isSecondary(e));
  const bridged = edges
    .filter((e) => e.to !== step.id)
    .map((e) => (e.from === step.id ? (primary ? { ...e, from: primary.from, id: edgeIdOf(primary.from, e.to, e.input, e.slot) } : null) : e))
    .filter((e): e is Edge => !!e);
  return syncCombineInputs({ ...s, steps: s.steps.filter((_, k) => k !== index), graph: { ...s.graph!, edges: bridged } });
}

/** Add a project source as its own node (to prepare it before combining). */
export function addSourceNode(spec: PipelineSpec, source: SourceSpec): { spec: PipelineSpec; id: string } {
  const s = materialize(spec);
  const g = s.graph!;
  let id = `src:${source.fileId}:${source.sheet ?? ""}`;
  for (let k = 2; g.sources.some((x) => x.id === id); k++) id = `src:${source.fileId}:${source.sheet ?? ""}:${k}`;
  return { id, spec: { ...s, graph: { ...g, sources: [...g.sources, { id, source, rank: g.nextRank, order: -1 + g.sources.length / 1000 }], nextRank: g.nextRank + 1 } } };
}

/** Every source a pipeline reads besides its main one (combine steps' files and source nodes). */
export function extraSources(spec: PipelineSpec): SourceSpec[] {
  const out: SourceSpec[] = [];
  for (const s of spec.steps) if (isCombine(s) && s.source.fileId) out.push(s.source);
  for (const s of spec.graph?.sources ?? []) out.push(s.source);
  return out.filter((s, i) => out.findIndex((x) => sameSource(x, s)) === i);
}

/** Structural problems of a pipeline (no data needed). */
export const graphProblems = (spec: PipelineSpec): Problem[] => validateGraph(toGraphSpec(spec));

// ------------------------------------------------------------------ branching (several Loads)

/** Order of extra Loads: after everything else, in the order they were added. */
const LOAD_ORDER = 1_000_000;

/** Add a Load reading `after`'s output: a new branch that ends in its own destination. */
export function addLoad(spec: PipelineSpec, after: string, destination: PipelineSpec["destination"] = null): { spec: PipelineSpec; id: string } {
  const s = materialize(spec);
  const loads = s.graph!.loads ?? [];
  let k = loads.length + 2;
  while (loads.some((l) => l.id === `load_${k}`)) k++;
  const id = `load_${k}`;
  const graph: StoredGraph = {
    ...s.graph!,
    loads: [...loads, { id, destination, order: LOAD_ORDER + k }],
    edges: [...s.graph!.edges, { id: edgeIdOf(after, id, "input"), from: after, to: id, input: "input" }],
  };
  return { id, spec: { ...s, graph } };
}

/** Remove an extra Load and its connection. The main Load stays. */
export function removeLoad(spec: PipelineSpec, id: string): PipelineSpec {
  if (!spec.graph || id === LOAD_ID) return spec;
  return { ...spec, graph: { ...spec.graph, loads: (spec.graph.loads ?? []).filter((l) => l.id !== id), edges: spec.graph.edges.filter((e) => e.to !== id && e.from !== id) } };
}

/** Destination of a Load (the main one, or an extra one). */
export function loadDestination(spec: PipelineSpec, id: string): PipelineSpec["destination"] {
  return id === LOAD_ID ? spec.destination : spec.graph?.loads?.find((l) => l.id === id)?.destination ?? null;
}

export function setLoadDestination(spec: PipelineSpec, id: string, destination: PipelineSpec["destination"]): PipelineSpec {
  if (id === LOAD_ID) return { ...spec, destination };
  if (!spec.graph) return spec;
  return { ...spec, graph: { ...spec.graph, loads: (spec.graph.loads ?? []).map((l) => (l.id === id ? { ...l, destination } : l)) } };
}

/** Every Load of a pipeline, the main one first. */
export function loadIds(spec: PipelineSpec): string[] {
  return [LOAD_ID, ...(spec.graph?.loads ?? []).map((l) => l.id)];
}

/** A short name for a destination, e.g. "fact_invoices.csv" or "warehouse.invoices". */
export function destinationLabel(d: PipelineSpec["destination"]): string {
  if (!d) return "Set destination";
  if (d.type === "database") return d.table || "Database table";
  return d.path ? d.path.replace(/^.*[\\/]/, "") : `${(d.format ?? "csv").toUpperCase()} file`;
}
