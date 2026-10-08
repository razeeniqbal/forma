// Step descriptions shared by the pipeline list, inspector and code generator (PRD §6.5, §6.6).
// Tool categories and operation metadata live in taxonomy.ts.

import type { Step } from "./types";
import { nodeLabel } from "./taxonomy";
import { ruleLabel } from "./execute";

/** Label for a step in run records, code comments and lists: its tool category (see taxonomy.ts). */
export function stageOf(step: Step): string {
  return nodeLabel(step);
}

let counter = 0;
export function newId(prefix = "s"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function describeStep(step: Step): { title: string; detail: string } {
  switch (step.type) {
    case "select":
      return { title: "Select columns", detail: `${step.columns.length} columns: ${step.columns.slice(0, 4).join(", ")}${step.columns.length > 4 ? "…" : ""}` };
    case "rename":
      return { title: "Rename columns", detail: Object.entries(step.mapping).map(([a, b]) => `${a} → ${b}`).join(", ") };
    case "trim":
      return { title: "Trim text", detail: step.columns.join(", ") };
    case "change_case":
      return { title: `Change case (${step.mode})`, detail: step.columns.join(", ") };
    case "replace":
      return { title: "Replace values", detail: `${step.column}: "${step.find}" → "${step.replace}"` };
    case "fill_blanks":
      return { title: "Fill blanks", detail: `${step.column} ← "${step.value}"` };
    case "convert_number":
      return { title: "Convert to number", detail: `${step.column} → decimal` };
    case "standardise_date":
      return { title: `Standardise ${step.column}`, detail: `${step.column} → ${step.outputFormat}` };
    case "extract":
      return { title: "Extract fields", detail: step.fields.map((f) => f.name).join(", ") || step.column };
    case "extract_kv":
      return { title: "Parse key-value", detail: step.keys.map((k) => k.name).join(", ") || step.column };
    case "split":
      return { title: `Split ${step.column}`, detail: `into ${step.into.join(", ")}` };
    case "filter":
      return { title: "Filter rows", detail: `${step.column} ${step.op.replace("_", " ")} ${step.value}` };
    case "sort":
      return { title: `Sort by ${step.column}`, detail: step.direction === "asc" ? "Ascending" : "Descending" };
    case "remove_duplicates":
      return { title: "Remove duplicates", detail: step.columns.length ? `by ${step.columns.join(", ")}` : "all columns" };
    case "formula":
      return { title: `Formula → ${step.output}`, detail: step.expression };
    case "round":
      return { title: `Round ${step.column}`, detail: `${step.decimals} decimals` };
    case "validate":
      return {
        title: "Validate",
        detail: step.rules.length ? step.rules.slice(0, 3).map((r) => `${r.column}: ${ruleLabel(r)}`).join("; ") : "No rules yet",
      };
    case "group":
      return { title: `Group by ${step.by.join(", ") || "all rows"}`, detail: step.aggs.map((a) => `${a.fn}(${a.column})`).join(", ") };
    case "pivot":
      return { title: `Pivot ${step.column}`, detail: `${step.fn}(${step.value}) by ${step.index.join(", ") || "all rows"}` };
    case "unpivot":
      return { title: "Unpivot columns", detail: `${step.columns.length} columns → ${step.nameColumn}, ${step.valueColumn}` };
    case "join":
      return {
        title: `${step.mode === "lookup" ? "Lookup" : "Join"} ${step.source.file}`,
        detail: `${step.how} on ${step.on.map((o) => (o.left === o.right ? o.left : `${o.left}=${o.right}`)).join(", ")}${step.columns.length ? ` → ${step.columns.join(", ")}` : ""}`,
      };
    case "append":
      return { title: `Append ${step.source.file}`, detail: step.source.sheet ? `sheet ${step.source.sheet}` : "all rows" };
  }
}

export function stepTitle(step: Step): string {
  return step.label || describeStep(step).title;
}

/** Columns a step reads (for inspector + "affects columns" display). */
export function stepColumns(step: Step): string[] {
  switch (step.type) {
    case "select":
      return step.columns;
    case "rename":
      return Object.keys(step.mapping);
    case "trim":
    case "change_case":
    case "remove_duplicates":
      return step.columns;
    case "formula":
      return [...step.expression.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    case "validate":
      return [...new Set(step.rules.map((r) => r.column))];
    case "group":
      return [...step.by, ...step.aggs.map((a) => a.column)];
    case "pivot":
      return [...step.index, step.column, step.value];
    case "unpivot":
      return [...step.keep, ...step.columns];
    case "join":
      return step.on.map((o) => o.left);
    case "append":
      return [];
    default:
      return [step.column];
  }
}
