// The app's execution entry point. A pipeline runs through the graph engine: its explicit connections, or
// its linear chain migrated on the fly. Results come back in the shape the app already uses. The
// equivalence tests (tests/graphEquivalence.ts) prove a linear pipeline gives exactly what the linear
// engine gives.
import type { Dataset, ExecutionResult, PipelineSpec, RawSheet, StepResult } from "../types";
import type { ExecuteOptions } from "../execute";
import { executeGraph } from "./execute";
import { inputsOf, LOAD_ID, PRIMARY_ID, validateGraph } from "./model";
import { toGraphSpec } from "./spec";

export function executeSpec(spec: PipelineSpec, sheet: RawSheet, opts: ExecuteOptions = {}): ExecutionResult {
  if (!spec.source) throw new Error("Pipeline has no source");
  const upto = opts.uptoStep;
  const run = upto === undefined ? spec : { ...spec, steps: spec.steps.slice(0, upto + 1) };
  const index = new Map(run.steps.map((s, i) => [s.id, i]));
  const g2 = toGraphSpec(run);
  const g = executeGraph(g2, {
    primary: sheet,
    sheets: opts.sheets,
    limit: opts.limit,
    onLoaded: (id, rows, columns) => id === PRIMARY_ID && opts.onLoaded?.(rows, columns),
    onNode: (id, result) => {
      const i = index.get(id);
      if (i !== undefined) opts.onStep?.(i, result);
    },
  });
  const input = g.outputs.get(PRIMARY_ID)!;
  // The main Load is the pipeline's output; extra Loads are listed in `loads`.
  const load = g.loads.find((l) => l.id === LOAD_ID) ?? (spec.graph ? undefined : g.loads[0]);
  const byId = new Map(g.steps.map((r) => [r.stepId, r]));
  const explicit = !!spec.graph;
  const problems = explicit ? validateGraph(g2, (n) => g.outputs.get(n.id)?.columns) : undefined;
  // A step that never ran (not connected, or part of a loop) reports why.
  const notRun = (id: string): StepResult => ({
    stepId: id, rowsIn: 0, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [], issues: 0, durationMs: 0, summary: "Not run",
    error: problems?.find((p) => p.nodeId === id && p.level === "error")?.message ?? "Not connected to the pipeline",
  });
  // A failed or skipped step has no output: like the linear engine, its snapshot is the data it received.
  const snapshots: Dataset[] = [];
  for (const s of run.steps) snapshots.push(g.outputs.get(s.id) ?? (explicit ? undefined : snapshots[snapshots.length - 1]) ?? input);
  return {
    input,
    output: load?.output ?? { columns: input.columns, rows: [], rowIds: [] },
    beforeGate: load?.beforeGate ?? input,
    steps: run.steps.map((s) => byId.get(s.id) ?? notRun(s.id)),
    issues: g.issues,
    reviewRows: g.reviewRows,
    excludedRows: g.excludedRows,
    ruleResults: g.ruleResults,
    snapshots: opts.keepSnapshots ? snapshots : undefined,
    gated: g.gated,
    ...(explicit
      ? {
          stepInputs: run.steps.map((s) => {
            const from = inputsOf(g2.graph, s.id)[0]?.from;
            return from ? g.outputs.get(from) : undefined;
          }),
          problems,
          loads: [...g.loads].sort((a, b) => Number(b.id === LOAD_ID) - Number(a.id === LOAD_ID)).map((l) => ({ id: l.id, output: l.output, beforeGate: l.beforeGate })),
        }
      : {}),
  };
}
