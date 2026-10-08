// Tool taxonomy and operation contracts.
//
// SOURCE → EXTRACT → TRANSFORM → VALIDATE → LOAD is the mental model FORMA uses to organise its tools.
// It is not a mandatory sequence. Every existing step type is placed here once; the picker, the
// command palette, canvas nodes, inspectors and Docs read from this module instead of hard-coding it.
//
// Operation contracts describe the datasets a tool reads and produces. Today they drive labels and
// input roles in the UI. They are written so that a future graph engine can use the same contracts for
// connection validation, handles, execution and generated Python.
import type { Step, StepType } from "./types";

export type ToolCategory = "source" | "extract" | "transform" | "validate" | "load";

export type TransformGroup = "clean" | "convert" | "structure" | "reshape" | "combine" | "calculate";

/** Pseudo operations for the two ends of a pipeline, which are not steps in the PipelineSpec. */
export type OperationId = StepType | "lookup" | "source" | "load";

export interface CategoryMeta {
  id: ToolCategory;
  title: string;
  /** One line shown in Add Tool and Docs. */
  tagline: string;
  /** Docs page that explains it. */
  doc: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "source", title: "Source", tagline: "Bring data into the pipeline", doc: "tools-source" },
  { id: "extract", title: "Extract", tagline: "Turn messy content into structured fields", doc: "tools-extract" },
  { id: "transform", title: "Transform", tagline: "Clean, convert, reshape or combine data", doc: "tools-transform" },
  { id: "validate", title: "Validate", tagline: "Check data against explicit rules", doc: "tools-validate" },
  { id: "load", title: "Load", tagline: "Send processed data somewhere", doc: "tools-load" },
];

export const GROUPS: { id: TransformGroup; title: string; tagline: string }[] = [
  { id: "clean", title: "Clean", tagline: "Trim, replace, fill blanks, change case" },
  { id: "convert", title: "Convert", tagline: "Numbers and dates" },
  { id: "structure", title: "Structure", tagline: "Select, rename, filter, sort, remove duplicates" },
  { id: "reshape", title: "Reshape", tagline: "Group, pivot, unpivot" },
  { id: "combine", title: "Combine", tagline: "Join, lookup, append" },
  { id: "calculate", title: "Calculate", tagline: "Formula, round" },
];

/** A dataset input of an operation. Multi-input operations name each role. */
export interface InputRole {
  role: "input" | "left" | "right" | "primary" | "reference" | "datasets";
  label: string;
  /** "many": two or more datasets (Append). */
  cardinality: "one" | "many";
}

export interface OperationContract {
  inputs: InputRole[];
  /** What the operation produces: a dataset, or a destination result (Load). */
  output: "dataset" | "destination";
}

export interface Operation {
  id: OperationId;
  category: ToolCategory;
  group?: TransformGroup;
  title: string;
  description: string;
  keywords: string;
  /** Starts from a selected column when one is selected. */
  column?: boolean;
  contract: OperationContract;
  /** Docs page that explains it. */
  doc: string;
}

const ONE: OperationContract = { inputs: [{ role: "input", label: "Input", cardinality: "one" }], output: "dataset" };

const op = (id: OperationId, category: ToolCategory, group: TransformGroup | undefined, title: string, description: string, keywords: string, extra: Partial<Operation> = {}): Operation => ({
  id,
  category,
  group,
  title,
  description,
  keywords,
  contract: ONE,
  doc: group ? `transform-${group}` : `tools-${category}`,
  ...extra,
});

/** Every tool FORMA has, once. The order is the order shown in Add Tool. */
export const OPERATIONS: Operation[] = [
  op("source", "source", undefined, "Source", "A project source: CSV, Excel, JSON, JSONL, text, database or API", "source file csv excel json jsonl text database api google sheets upload", {
    contract: { inputs: [], output: "dataset" },
  }),

  op("extract", "extract", undefined, "Pattern extraction", "Pull structured fields out of text with patterns", "extract regex pattern parse fields invoice date amount", { column: true }),
  op("extract_kv", "extract", undefined, "Key-value extraction", "Parse 'key: value; key: value' text into columns", "key value parse pairs kv", { column: true }),
  op("split", "extract", undefined, "Split", "Split text by a delimiter into columns", "split delimiter separate columns", { column: true }),

  op("trim", "transform", "clean", "Trim", "Remove leading and trailing spaces", "trim whitespace spaces strip", { column: true }),
  op("replace", "transform", "clean", "Replace", "Exact, contains or regex replacement", "replace substitute map standardise", { column: true }),
  op("fill_blanks", "transform", "clean", "Fill blanks", "Replace empty values with a default", "empty missing null default blank", { column: true }),
  op("change_case", "transform", "clean", "Change case", "UPPER, lower or Title case", "case upper lower title capitalize", { column: true }),

  op("convert_number", "transform", "convert", "Number", "Parse numbers, currency and thousands separators", "convert type number decimal currency amount numeric", { column: true }),
  op("standardise_date", "transform", "convert", "Date", "Convert mixed date formats into one format", "date format convert type iso standardise", { column: true }),

  op("select", "transform", "structure", "Select", "Keep and order the columns you need", "select columns keep drop remove reorder"),
  op("rename", "transform", "structure", "Rename", "Give columns clear names", "rename column name header"),
  op("filter", "transform", "structure", "Filter", "Keep rows matching a condition", "filter where condition rows keep"),
  op("sort", "transform", "structure", "Sort", "Order rows by a column", "sort order ascending descending"),
  op("remove_duplicates", "transform", "structure", "Remove duplicates", "Keep the first row for each key", "duplicate dedupe unique distinct"),

  op("group", "transform", "reshape", "Group", "Summarise rows: sum, average, count, min, max", "group aggregate sum count total summarise"),
  op("pivot", "transform", "reshape", "Pivot", "Turn row values into columns", "pivot wide crosstab"),
  op("unpivot", "transform", "reshape", "Unpivot", "Turn columns into rows", "unpivot melt long"),

  op("join", "transform", "combine", "Join", "Combine two datasets on key columns (every match)", "join merge combine left inner", {
    contract: {
      inputs: [
        { role: "left", label: "Left input", cardinality: "one" },
        { role: "right", label: "Right input", cardinality: "one" },
      ],
      output: "dataset",
    },
    doc: "combine-join",
  }),
  op("lookup", "transform", "combine", "Lookup", "Enrich rows with columns from a reference dataset (first match)", "lookup vlookup enrich reference mapping", {
    contract: {
      inputs: [
        { role: "primary", label: "Primary dataset", cardinality: "one" },
        { role: "reference", label: "Reference dataset", cardinality: "one" },
      ],
      output: "dataset",
    },
    doc: "combine-lookup",
  }),
  op("append", "transform", "combine", "Append", "Stack rows from another dataset below", "append union concat stack combine months", {
    contract: { inputs: [{ role: "datasets", label: "Datasets", cardinality: "many" }], output: "dataset" },
    doc: "combine-append",
  }),

  op("formula", "transform", "calculate", "Formula", "Calculate a new column, e.g. [Amount] * 1.06", "formula calculate expression math compute"),
  op("round", "transform", "calculate", "Round", "Round numbers to a number of decimals", "round decimals precision", { column: true }),

  op("validate", "validate", undefined, "Validation rules", "Not blank, pattern, valid date, numeric bounds, allowed values, unique", "validate rule check quality test not blank pattern valid date bounds allowed unique"),

  op("load", "load", undefined, "Load", "Write rows that pass review to a file (CSV, Excel, JSON) or a database table", "load destination output file csv xlsx json database postgresql table export", {
    contract: { inputs: [{ role: "input", label: "Input", cardinality: "one" }], output: "destination" },
  }),
];

export const operation = (id: OperationId): Operation => OPERATIONS.find((o) => o.id === id)!;

/** The operation a step is an instance of (a join step in lookup mode is a Lookup). */
export function operationOf(step: Step): Operation {
  if (step.type === "join") return operation(step.mode === "lookup" ? "lookup" : "join");
  return operation(step.type);
}

export const categoryOf = (step: Step): ToolCategory => operationOf(step).category;

export const categoryMeta = (id: ToolCategory): CategoryMeta => CATEGORIES.find((c) => c.id === id)!;

export const isCombine = (step: Step): step is Extract<Step, { type: "join" | "append" }> => step.type === "join" || step.type === "append";

/** Breadcrumb for an operation, e.g. "Transform > Convert > Date". */
export function pathOf(o: Operation): string[] {
  const out = [categoryMeta(o.category).title];
  if (o.group) out.push(GROUPS.find((g) => g.id === o.group)!.title);
  out.push(o.title);
  return out;
}

/**
 * Label shown on a canvas node and in inspector headers: the category, except for multi-input
 * operations, which name themselves (JOIN, LOOKUP, APPEND) so their inputs read clearly.
 */
export function nodeLabel(step: Step): string {
  const o = operationOf(step);
  return o.group === "combine" ? o.title : categoryMeta(o.category).title;
}

/** Docs page for a validation rule, a destination, or anything else tied to a category. */
export const docForStep = (step: Step) => operationOf(step).doc;

export interface ToolSearchHit {
  op: Operation;
  path: string[];
  score: number;
}

/**
 * Taxonomy-aware search: every word must match the operation's title, path, description or keywords.
 * "date" finds Extract > Pattern extraction, Transform > Convert > Date and Validate > Validation rules.
 */
export function searchTools(query: string, ops: Operation[] = OPERATIONS): ToolSearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: ToolSearchHit[] = [];
  for (const o of ops) {
    const path = pathOf(o);
    const title = o.title.toLowerCase();
    const hay = `${path.join(" ")} ${o.description} ${o.keywords}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (!hay.includes(w)) {
        score = 0;
        break;
      }
      score += title === w ? 6 : title.startsWith(w) ? 4 : title.includes(w) ? 3 : path.join(" ").toLowerCase().includes(w) ? 2 : 1;
    }
    if (score > 0) hits.push({ op: o, path, score });
  }
  return hits.sort((a, b) => b.score - a.score || OPERATIONS.indexOf(a.op) - OPERATIONS.indexOf(b.op));
}
