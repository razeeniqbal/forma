// Migration guarantee (GRAPH_ENGINE_DESIGN.md §9.2): a migrated linear pipeline run by the graph engine
// gives exactly what the linear engine gives.
import { expect } from "vitest";
import { execute } from "@/engine/execute";
import { executeGraph } from "@/engine/graph/execute";
import { migrateSpec } from "@/engine/graph/model";
import { executeSpec } from "@/engine/graph/run";
import type { ExecutionResult, PipelineSpec, RawSheet } from "@/engine/types";

const stable = (r: { steps: ExecutionResult["steps"] }) => r.steps.map(({ durationMs: _d, ...rest }) => rest);

export function expectGraphEquivalent(spec: PipelineSpec, sheet: RawSheet, sheets: Record<string, RawSheet> = {}, limit?: number): ExecutionResult {
  const linear = execute(spec, sheet, { sheets, limit });
  const graph = executeGraph(migrateSpec(spec), { primary: sheet, sheets, limit });
  expect(graph.loads).toHaveLength(1);
  const load = graph.loads[0];
  expect(load.output.columns).toEqual(linear.output.columns);
  expect(load.output.rowIds).toEqual(linear.output.rowIds);
  expect(load.output.rows).toEqual(linear.output.rows);
  expect(load.beforeGate.rowIds).toEqual(linear.beforeGate.rowIds);
  expect(graph.reviewRows).toEqual(linear.reviewRows);
  expect(graph.excludedRows).toEqual(linear.excludedRows);
  expect(graph.issues).toEqual(linear.issues);
  expect(graph.ruleResults).toEqual(linear.ruleResults);
  expect(stable(graph)).toEqual(stable(linear));
  // The app's entry point returns the same ExecutionResult the linear engine does.
  const viaApp = executeSpec(spec, sheet, { sheets, limit, keepSnapshots: true });
  const withSnapshots = execute(spec, sheet, { sheets, limit, keepSnapshots: true });
  expect({ ...viaApp, steps: stable(viaApp), gated: undefined }).toEqual({ ...withSnapshots, steps: stable(withSnapshots), gated: undefined });
  return linear;
}
