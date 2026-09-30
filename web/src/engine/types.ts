// FORMA pipeline model (PRD §5, §8). The PipelineSpec is the single source of
// truth: the UI edits it, the engine executes it, the code generator emits it.

export type Cell = string | number | boolean | null;

export interface Dataset {
  columns: string[];
  rows: Cell[][];
  /** Stable source row number (1-based data row) for every row, used by review. */
  rowIds: number[];
}

/** Raw sheet as read from a file, before header/region detection. */
export interface RawSheet {
  name: string;
  cells: Cell[][];
  merged?: string[];
}

export interface SourceFile {
  id: string;
  name: string;
  kind: SourceKind;
  size: number;
  addedAt: number;
  sheets: RawSheet[];
}

export type SourceKind = "csv" | "excel" | "json" | "jsonl" | "text";

export interface SourceSpec {
  type: SourceKind;
  file: string;
  fileId: string;
  sheet?: string;
  /** 0-based row index of header within the raw sheet; -1 = no header. */
  headerRow: number;
  /** 0-based inclusive column bounds of the data region. */
  startCol: number;
  endCol: number;
  /** Rows to skip after the header before data (usually 0). */
  csvDelimiter?: string;
}

export type OutputType = "text" | "number" | "date";

export interface ExtractField {
  name: string;
  type: OutputType;
  pattern: string;
  ignoreCase?: boolean;
}

export type Step =
  | { id: string; type: "select"; label?: string; columns: string[] }
  | { id: string; type: "rename"; label?: string; mapping: Record<string, string> }
  | { id: string; type: "trim"; label?: string; columns: string[]; collapseSpaces: boolean }
  | { id: string; type: "change_case"; label?: string; columns: string[]; mode: "upper" | "lower" | "title" }
  | {
      id: string;
      type: "replace";
      label?: string;
      column: string;
      find: string;
      replace: string;
      match: "exact" | "contains" | "regex";
    }
  | { id: string; type: "fill_blanks"; label?: string; column: string; value: string }
  | { id: string; type: "convert_number"; label?: string; column: string; decimals: number | null }
  | { id: string; type: "standardise_date"; label?: string; column: string; inputFormats: string[]; outputFormat: string }
  | { id: string; type: "extract"; label?: string; column: string; method: "pattern"; fields: ExtractField[] }
  | {
      id: string;
      type: "extract_kv";
      label?: string;
      column: string;
      pairSeparator: string;
      kvSeparator: string;
      keys: { key: string; name: string }[];
    }
  | { id: string; type: "split"; label?: string; column: string; delimiter: string; into: string[] }
  | { id: string; type: "filter"; label?: string; column: string; op: FilterOp; value: string }
  | { id: string; type: "sort"; label?: string; column: string; direction: "asc" | "desc" }
  | { id: string; type: "remove_duplicates"; label?: string; columns: string[] }
  | { id: string; type: "formula"; label?: string; output: string; expression: string }
  | { id: string; type: "round"; label?: string; column: string; decimals: number }
  | { id: string; type: "validate"; label?: string; rules: ValidationRule[] };

export type StepType = Step["type"];

export type FilterOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "is_blank"
  | "not_blank"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type ValidationRule =
  | { id: string; column: string; kind: "not_blank" }
  | { id: string; column: string; kind: "matches"; pattern: string; description?: string }
  | { id: string; column: string; kind: "valid_date" }
  | { id: string; column: string; kind: "gt" | "gte" | "lt" | "lte"; value: number }
  | { id: string; column: string; kind: "in_set"; values: string[] }
  | { id: string; column: string; kind: "unique" };

export type RuleKind = ValidationRule["kind"];

export interface Destination {
  type: "file" | "database";
  /** file: csv | xlsx | json ; database: table name */
  format?: "csv" | "xlsx" | "json";
  path?: string;
  connectionId?: string;
  table?: string;
  ifExists?: "append" | "replace";
}

export type ReviewAction = "correct" | "keep" | "exclude" | "ignore";

export interface ReviewDecision {
  row: number;
  column: string | null;
  action: ReviewAction;
  value?: string;
  decidedAt: number;
  note?: string;
  /** Source-row content the decision was made against; decisions never apply to changed rows. */
  fingerprint?: string;
  /** Issue kind being resolved, for "apply to similar rows" and audit. */
  issueKind?: IssueKind;
}

export interface PipelineSpec {
  name: string;
  source: SourceSpec | null;
  steps: Step[];
  destination: Destination | null;
  reviewDecisions: ReviewDecision[];
}

export type IssueKind =
  | "pattern_mismatch"
  | "invalid_date"
  | "invalid_number"
  | "missing_value"
  | "rule_failed"
  | "other";

export interface Issue {
  row: number;
  column: string;
  stepId: string;
  kind: IssueKind;
  message: string;
  value: Cell;
  ruleId?: string;
}

export interface StepResult {
  stepId: string;
  rowsIn: number;
  rowsOut: number;
  changedCells: number;
  addedColumns: string[];
  removedColumns: string[];
  issues: number;
  durationMs: number;
  summary: string;
  error?: string;
}

export interface RuleResult {
  ruleId: string;
  column: string;
  kind: RuleKind;
  evaluated: number;
  passed: number;
}

export interface ExecutionResult {
  input: Dataset;
  output: Dataset;
  /** Dataset after steps, before review gate (includes rows needing review). */
  beforeGate: Dataset;
  steps: StepResult[];
  issues: Issue[];
  /** Rows sent to review (unresolved issues). */
  reviewRows: number[];
  excludedRows: number[];
  ruleResults: RuleResult[];
  snapshots?: Dataset[];
}
