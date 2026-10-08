// Schema propagation helpers: what each node outputs, and why a downstream reference broke.
import type { Dataset, PipelineSpec } from "@/engine/types";
import { stepTitle } from "@/engine/registry";

export interface SchemaChange {
  columns: number;
  added: string[];
  removed: string[];
}

/** Columns a node outputs compared with what it received. */
export function schemaChange(before: Dataset | undefined, after: Dataset | undefined): SchemaChange | null {
  if (!after) return null;
  const prev = before?.columns ?? [];
  return { columns: after.columns.length, added: after.columns.filter((c) => !prev.includes(c)), removed: prev.filter((c) => !after.columns.includes(c)) };
}

/**
 * When a step fails because a column is missing, find the upstream step that renamed or removed it.
 * Returns a sentence such as: Step 03 (Rename columns) renamed "region" to "region_code".
 */
export function explainMissingColumn(spec: PipelineSpec, index: number, error: string | undefined, snapshots?: (Dataset | undefined)[]): string | null {
  const m = error?.match(/^Column "(.+)" not found$/);
  if (!m) return null;
  const col = m[1];
  for (let i = index - 1; i >= 0; i--) {
    const s = spec.steps[i];
    const num = String(i + 2).padStart(2, "0");
    if (s.type === "rename" && s.mapping[col]) return `Step ${num} (${stepTitle(s)}) renamed "${col}" to "${s.mapping[col]}". Update this step to use the new name.`;
    if (s.type === "select" && !s.columns.includes(col)) {
      const had = i === 0 || !snapshots || snapshots[i - 1]?.columns.includes(col);
      if (had) return `Step ${num} (${stepTitle(s)}) does not keep "${col}". Add it there, or choose another column here.`;
    }
    if ((s.type === "group" || s.type === "pivot" || s.type === "unpivot") && snapshots?.[i] && !snapshots[i]!.columns.includes(col))
      return `Step ${num} (${stepTitle(s)}) reshapes the data and its output has no "${col}" column.`;
  }
  return `"${col}" is not in the data that reaches this step.`;
}
