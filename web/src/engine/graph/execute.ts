// Graph executor (GRAPH_ENGINE_DESIGN.md §4, §5, §7). Every step runs through the same `applyStep` as the
// linear engine; what is new is how datasets, row identity and review issues travel along connections.
// Generated Python mirrors this file in codegen/graph.ts; keep them in lock-step.
import type { Dataset, Issue, RawSheet, RuleResult, StepResult } from "../types";
import { applyReviewGate, applyStep, countChanges, isReshaping, reconcileIssues, summarizeStep, type Ctx, type Env } from "../execute";
import { fingerprint, loadDataset, sideSheetKey } from "../load";
import { executionOrder, inputsOf, missingInput, nodeById, nodeTitle, stepOf } from "./model";
import { RANK_BASE, type PipelineSpecV2, type SourceNode } from "./types";

export interface GraphRunOptions {
  /** Raw sheets by `sideSheetKey(fileId, sheet)` or file id. */
  sheets?: Map<string, RawSheet> | Record<string, RawSheet>;
  /** Sheet of the rank-0 source, when it is not in `sheets`. */
  primary?: RawSheet;
  /** Preview sampling: applies to the rank-0 source only, as in the linear engine. */
  limit?: number;
  onLoaded?: (nodeId: string, rows: number, columns: number) => void;
  onNode?: (nodeId: string, result: StepResult) => void;
}

/** What flows along a connection: the dataset and the open issues raised on its path (§7.1). */
interface Flow {
  ds: Dataset;
  issues: Issue[];
}

export interface LoadResult {
  id: string;
  /** Rows entering the Load, before its review gate. */
  beforeGate: Dataset;
  output: Dataset;
}

export interface GraphExecutionResult {
  order: string[];
  /** Output of every source and step node that ran. */
  outputs: Map<string, Dataset>;
  /** Step results in execution order. */
  steps: StepResult[];
  loads: LoadResult[];
  /** Issues reaching any Load, first-seen order. */
  issues: Issue[];
  reviewRows: number[];
  excludedRows: number[];
  ruleResults: RuleResult[];
  gated: Dataset[];
  failed: boolean;
}

export const issueKey = (i: Issue) => JSON.stringify([i.row, i.column, i.stepId, i.kind, i.message]);

/**
 * Issues of a node's inputs. The primary input's list is kept exactly (including duplicates, as the linear
 * engine does); further inputs add only issues that are not already present (a diamond shares ancestors).
 */
export function mergeIssues(lists: Issue[][]): Issue[] {
  if (lists.length <= 1) return lists[0] ?? [];
  const out = lists[0].slice();
  const seen = new Set(out.map(issueKey));
  for (const list of lists.slice(1))
    for (const i of list) {
      const k = issueKey(i);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(i);
    }
  return out;
}

const uniq = (ids: number[]) => [...new Set(ids)];

export function executeGraph(spec: PipelineSpecV2, opts: GraphRunOptions = {}): GraphExecutionResult {
  const { graph } = spec;
  const sheets = opts.sheets instanceof Map ? opts.sheets : new Map(Object.entries(opts.sheets ?? {}));
  const order = executionOrder(graph);
  const env: Env = { sheets, nextId: 1, fingerprints: new Map() };
  const flows = new Map<string, Flow>();
  const steps: StepResult[] = [];
  const loads: LoadResult[] = [];
  const loadIssues: Issue[][] = [];
  const ruleResults: RuleResult[] = [];
  const gated: Dataset[] = [];
  const held: number[] = [];
  const excluded: number[] = [];
  let failed = false;
  const missingSources = new Set<string>();

  /** Review gate: hold rows with open issues on this path, apply decisions. */
  const gate = (f: Flow): Dataset => {
    gated.push(f.ds);
    const g = applyReviewGate(f.ds, f.issues, spec.reviewDecisions, env.fingerprints);
    held.push(...g.reviewRows);
    excluded.push(...g.excludedRows);
    return g.output;
  };

  for (const id of order) {
    const node = nodeById(graph, id)!;

    if (node.kind === "source") {
      const ds = loadSource(node, sheets, opts);
      if (!ds) {
        failed = true;
        missingSources.add(id);
        continue;
      }
      ds.rows.forEach((row, r) => env.fingerprints.set(ds.rowIds[r], fingerprint(row)));
      if (node.rank === 0) env.nextId = (ds.rowIds.length ? Math.max(...ds.rowIds) : 0) + 1;
      flows.set(id, { ds, issues: [] });
      opts.onLoaded?.(id, ds.rows.length, ds.columns.length);
      continue;
    }

    const edges = inputsOf(graph, id);
    const ins = edges.map((e) => flows.get(e.from));
    const complete = ins.length > 0 && ins.every((f): f is Flow => !!f);

    if (node.kind === "load") {
      // When a step upstream failed, the Load receives the last good data on its path (as the linear engine
      // does); the run is still reported as failed.
      let f = ins[0];
      for (let cur = edges[0]?.from; !f && cur; cur = inputsOf(graph, cur)[0]?.from) f = flows.get(cur);
      if (f) {
        loadIssues.push(f.issues);
        loads.push({ id, beforeGate: f.ds, output: gate(f) });
      }
      continue;
    }

    const t0 = performance.now();
    // A required input that is not connected: the step fails with the same message validation gives.
    const lacking = missingInput(graph, node);
    if (lacking && ins.every((f) => f)) {
      failed = true;
      const r: StepResult = { stepId: id, rowsIn: ins[0]?.ds.rows.length ?? 0, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [], issues: 0, durationMs: 0, summary: "Failed", error: lacking };
      steps.push(r);
      opts.onNode?.(id, r);
      continue;
    }
    if (!complete) {
      // A source file that is not available fails the step that reads it; everything after that is skipped.
      const missing = edges.map((e) => e.from).find((f) => missingSources.has(f));
      const file = missing && (nodeById(graph, missing) as SourceNode).source.file;
      const primaryIn = ins[0];
      const r: StepResult = missing && primaryIn
        ? { stepId: id, rowsIn: primaryIn.ds.rows.length, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [], issues: 0, durationMs: 0, summary: "Failed", error: `Source file "${file}" is not available. Re-upload it in the step settings.` }
        : { stepId: id, rowsIn: 0, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [], issues: 0, durationMs: 0, summary: "Skipped", error: "Skipped (previous step failed)" };
      steps.push(r);
      opts.onNode?.(id, r);
      continue;
    }
    const step = stepOf(graph, node);
    const [primary, ...others] = ins as Flow[];
    // Gates: before an identity change on the primary input, and on every further input of a combine (§7.2).
    const ds = isReshaping(step) ? gate(primary) : primary.ds;
    const extra = others.map((f, k) => ({ ds: gate(f), name: nodeTitle(nodeById(graph, edges[k + 1].from)!, graph) }));
    const issues = mergeIssues([primary.issues, ...others.map((f) => f.issues)]);
    const ctx: Ctx = { issues: [], step, env };
    try {
      let out = ds;
      if (extra.length) for (const x of extra) out = applyStep(out, step, { ...ctx, other: x.ds, otherName: x.name }, ruleResults);
      else out = applyStep(ds, step, ctx, ruleResults);
      // Each combine call shares ctx.issues, so everything raised is collected there.
      const raised = ctx.issues;
      const next = reconcileIssues(issues, step, ds, out).concat(raised);
      const r: StepResult = {
        stepId: id,
        rowsIn: ds.rows.length,
        rowsOut: out.rows.length,
        changedCells: countChanges(ds, out),
        addedColumns: out.columns.filter((c) => !ds.columns.includes(c)),
        removedColumns: ds.columns.filter((c) => !out.columns.includes(c)),
        issues: raised.length,
        durationMs: performance.now() - t0,
        summary: summarizeStep(step, ds, out, countChanges(ds, out), raised.length),
      };
      flows.set(id, { ds: out, issues: next });
      steps.push(r);
      opts.onNode?.(id, r);
    } catch (e) {
      failed = true;
      const r: StepResult = { stepId: id, rowsIn: ds.rows.length, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [], issues: 0, durationMs: performance.now() - t0, summary: "Failed", error: (e as Error).message };
      steps.push(r);
      opts.onNode?.(id, r);
    }
  }

  return {
    order,
    outputs: new Map([...flows].map(([k, f]) => [k, f.ds])),
    steps,
    loads,
    issues: mergeIssues(loadIssues),
    reviewRows: uniq(held),
    excludedRows: uniq(excluded),
    ruleResults,
    gated,
    failed,
  };
}

function loadSource(node: SourceNode, sheets: Map<string, RawSheet>, opts: GraphRunOptions): Dataset | null {
  const s = node.source;
  const sheet = (node.rank === 0 ? opts.primary : undefined) ?? sheets.get(sideSheetKey(s.fileId, s.sheet)) ?? sheets.get(s.fileId);
  if (!sheet) return null;
  let ds = loadDataset(sheet, s);
  if (node.rank === 0 && opts.limit !== undefined && ds.rows.length > opts.limit) ds = { columns: ds.columns, rows: ds.rows.slice(0, opts.limit), rowIds: ds.rowIds.slice(0, opts.limit) };
  if (node.rank > 0) ds = { ...ds, rowIds: ds.rowIds.map((r) => node.rank * RANK_BASE + r) };
  return ds;
}
