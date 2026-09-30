// Transformation registry: metadata shared by the picker, pipeline list,
// inspector and code generator (PRD §6.5, §6.6).

import type { Step, StepType } from "./types";
import { ruleLabel } from "./execute";

export type Category = "Clean" | "Text" | "Numeric" | "Reshape" | "Extract" | "Validate" | "Combine";

export interface TransformMeta {
  type: StepType | "join" | "append" | "lookup" | "group" | "pivot";
  title: string;
  category: Category;
  description: string;
  keywords: string;
  /** Needs a single column selection to start */
  column?: boolean;
  later?: boolean;
}

export const TRANSFORMS: TransformMeta[] = [
  { type: "convert_number", title: "Change type → Number", category: "Clean", description: "Parse numbers, currency and thousands separators", keywords: "convert type number decimal currency amount", column: true },
  { type: "standardise_date", title: "Standardise date", category: "Clean", description: "Convert mixed date formats into one format", keywords: "date format convert type iso", column: true },
  { type: "fill_blanks", title: "Fill blanks", category: "Clean", description: "Replace empty values with a default", keywords: "empty missing null default", column: true },
  { type: "replace", title: "Replace values", category: "Clean", description: "Exact, contains or regex replacement", keywords: "replace substitute map standardise", column: true },
  { type: "trim", title: "Trim whitespace", category: "Clean", description: "Remove leading/trailing spaces", keywords: "trim whitespace spaces strip", column: true },
  { type: "change_case", title: "Change case", category: "Clean", description: "UPPER, lower or Title case", keywords: "case upper lower title capitalize", column: true },
  { type: "remove_duplicates", title: "Remove duplicates", category: "Clean", description: "Keep the first row for each key", keywords: "duplicate dedupe unique distinct" },
  { type: "extract", title: "Extract (pattern)", category: "Text", description: "Pull structured fields out of text", keywords: "extract regex pattern parse fields", column: true },
  { type: "extract_kv", title: "Parse key-value", category: "Text", description: "Parse 'key: value; key: value' text", keywords: "key value parse pairs kv", column: true },
  { type: "split", title: "Split column", category: "Text", description: "Split text by a delimiter into columns", keywords: "split delimiter separate columns", column: true },
  { type: "formula", title: "Formula", category: "Numeric", description: "Calculate a new column, e.g. [Amount] * 1.06", keywords: "formula calculate expression math compute" },
  { type: "round", title: "Round", category: "Numeric", description: "Round numbers to N decimals", keywords: "round decimals precision", column: true },
  { type: "select", title: "Select / reorder columns", category: "Reshape", description: "Keep and order the columns you need", keywords: "select columns keep drop remove reorder" },
  { type: "rename", title: "Rename columns", category: "Reshape", description: "Give columns clear names", keywords: "rename column name header" },
  { type: "filter", title: "Filter rows", category: "Reshape", description: "Keep rows matching a condition", keywords: "filter where condition rows keep" },
  { type: "sort", title: "Sort", category: "Reshape", description: "Order rows by a column", keywords: "sort order ascending descending" },
  { type: "validate", title: "Validate", category: "Validate", description: "Explicit data-quality rules", keywords: "validate rule check quality test" },
  { type: "group", title: "Group / Aggregate", category: "Reshape", description: "Coming in V1.x", keywords: "group aggregate sum", later: true },
  { type: "pivot", title: "Pivot / Unpivot", category: "Reshape", description: "Coming in V1.x", keywords: "pivot unpivot melt", later: true },
  { type: "join", title: "Join", category: "Combine", description: "Coming in V1.x", keywords: "join merge", later: true },
  { type: "append", title: "Append", category: "Combine", description: "Coming in V1.x", keywords: "append union concat", later: true },
  { type: "lookup", title: "Lookup", category: "Combine", description: "Coming in V1.x", keywords: "lookup vlookup", later: true },
];

export const STAGE_OF: Record<StepType, string> = {
  select: "Select",
  rename: "Transform",
  trim: "Clean",
  change_case: "Clean",
  replace: "Clean",
  fill_blanks: "Clean",
  convert_number: "Clean",
  standardise_date: "Clean",
  extract: "Extract",
  extract_kv: "Extract",
  split: "Extract",
  filter: "Transform",
  sort: "Transform",
  remove_duplicates: "Clean",
  formula: "Transform",
  round: "Transform",
  validate: "Validate",
};

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
    default:
      return [step.column];
  }
}
