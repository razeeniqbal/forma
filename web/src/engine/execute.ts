// Deterministic pipeline executor (PRD §2.3). Every transformation here has a
// generated-Python counterpart in codegen/python.ts; keep them in lock-step.

import type {
  Cell,
  Dataset,
  ExecutionResult,
  Issue,
  IssueKind,
  PipelineSpec,
  RawSheet,
  ReviewDecision,
  RuleResult,
  Step,
  StepResult,
  ValidationRule,
} from "./types";
import { fingerprint, loadDataset } from "./load";
import { evalFormula, parseFormula } from "./formula";
import {
  DATE_FORMATS,
  formatDate,
  isBlank,
  parseDate,
  parseMoney,
  roundHalfEven,
  titleCase,
  toNum,
  toText,
} from "./values";

/** Date formats used when an extracted field or rule needs "any valid date" (day-first). */
export const ANY_DATE_FORMATS = Object.keys(DATE_FORMATS).filter((f) => f !== "MM/DD/YYYY");

export class StepError extends Error {
  constructor(
    public stepId: string,
    message: string,
  ) {
    super(message);
  }
}

interface Ctx {
  issues: Issue[];
  step: Step;
}

function colIndex(ds: Dataset, name: string, step: Step): number {
  const i = ds.columns.indexOf(name);
  if (i < 0) throw new StepError(step.id, `Column "${name}" not found`);
  return i;
}

function mapColumn(ds: Dataset, idx: number, fn: (v: Cell, r: number) => Cell): Dataset {
  return {
    columns: ds.columns,
    rowIds: ds.rowIds,
    rows: ds.rows.map((row, r) => {
      const next = row.slice();
      next[idx] = fn(row[idx], r);
      return next;
    }),
  };
}

function addColumns(ds: Dataset, names: string[], values: (r: number) => Cell[]): Dataset {
  const existing = names.map((n) => ds.columns.indexOf(n));
  const columns = ds.columns.slice();
  names.forEach((n, i) => {
    if (existing[i] < 0) columns.push(n);
  });
  const rows = ds.rows.map((row, r) => {
    const next = row.slice();
    const vals = values(r);
    names.forEach((_, i) => {
      if (existing[i] >= 0) next[existing[i]] = vals[i];
      else next.push(vals[i]);
    });
    return next;
  });
  return { columns, rows, rowIds: ds.rowIds };
}

function issue(ctx: Ctx, ds: Dataset, r: number, column: string, kind: IssueKind, message: string, value: Cell, ruleId?: string) {
  ctx.issues.push({ row: ds.rowIds[r], column, stepId: ctx.step.id, kind, message, value, ruleId });
}

const regexCache = new Map<string, RegExp>();
export function compileRegex(pattern: string, flags = ""): RegExp {
  const key = flags + "\u0000" + pattern;
  let re = regexCache.get(key);
  if (!re) {
    re = new RegExp(pattern, flags);
    regexCache.set(key, re);
  }
  return re;
}

export function extractValue(text: string | null, pattern: string, ignoreCase = false): string | null {
  if (text === null) return null;
  const m = compileRegex(pattern, ignoreCase ? "i" : "").exec(text);
  if (!m) return null;
  const v = m.length > 1 ? m[1] : m[0];
  return v === undefined ? null : v;
}

function matchesFilter(v: Cell, op: Step & { type: "filter" } extends { op: infer O } ? O : never, value: string): boolean {
  const t = toText(v);
  switch (op) {
    case "equals":
      return t === value;
    case "not_equals":
      return t !== value;
    case "contains":
      return t !== null && t.includes(value);
    case "not_contains":
      return t === null || !t.includes(value);
    case "is_blank":
      return isBlank(v);
    case "not_blank":
      return !isBlank(v);
    default: {
      const a = toNum(v);
      const b = toNum(value);
      if (a === null || b === null) return false;
      if (op === "gt") return a > b;
      if (op === "gte") return a >= b;
      if (op === "lt") return a < b;
      return a <= b;
    }
  }
}

function sortKey(v: Cell): [number, number | string] {
  if (typeof v === "number") return [0, v];
  const t = toText(v);
  return [1, t ?? ""];
}

function cmpKeys(a: [number, number | string], b: [number, number | string]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] < b[1]) return -1;
  if (a[1] > b[1]) return 1;
  return 0;
}

export function ruleLabel(rule: ValidationRule): string {
  switch (rule.kind) {
    case "not_blank":
      return "Cannot be blank";
    case "matches":
      return rule.description || `Must match ${rule.pattern}`;
    case "valid_date":
      return "Must be a valid date";
    case "gt":
      return `Must be > ${rule.value}`;
    case "gte":
      return `Must be ≥ ${rule.value}`;
    case "lt":
      return `Must be < ${rule.value}`;
    case "lte":
      return `Must be ≤ ${rule.value}`;
    case "in_set":
      return `Must be one of ${rule.values.join(", ")}`;
    case "unique":
      return "Must be unique";
  }
}

function applyStep(ds: Dataset, step: Step, ctx: Ctx, ruleResults: RuleResult[]): Dataset {
  switch (step.type) {
    case "select": {
      const idx = step.columns.map((c) => colIndex(ds, c, step));
      return { columns: step.columns.slice(), rowIds: ds.rowIds, rows: ds.rows.map((row) => idx.map((i) => row[i])) };
    }
    case "rename": {
      for (const k of Object.keys(step.mapping)) colIndex(ds, k, step);
      const columns = ds.columns.map((c) => step.mapping[c] || c);
      if (new Set(columns).size !== columns.length) throw new StepError(step.id, "Rename would create duplicate column names");
      return { columns, rows: ds.rows, rowIds: ds.rowIds };
    }
    case "trim": {
      let out = ds;
      for (const c of step.columns) {
        out = mapColumn(out, colIndex(out, c, step), (v) => {
          if (typeof v !== "string") return v;
          const t = v.trim();
          return step.collapseSpaces ? t.replace(/\s+/g, " ") : t;
        });
      }
      return out;
    }
    case "change_case": {
      let out = ds;
      for (const c of step.columns) {
        out = mapColumn(out, colIndex(out, c, step), (v) => {
          if (typeof v !== "string") return v;
          if (step.mode === "upper") return v.toUpperCase();
          if (step.mode === "lower") return v.toLowerCase();
          return titleCase(v);
        });
      }
      return out;
    }
    case "replace": {
      const i = colIndex(ds, step.column, step);
      const re = step.match === "regex" ? compileRegex(step.find, "g") : null;
      return mapColumn(ds, i, (v) => {
        const t = toText(v);
        if (step.match === "exact") return t === step.find ? step.replace : v;
        if (t === null) return v;
        if (step.match === "contains") return step.find === "" ? v : t.split(step.find).join(step.replace);
        re!.lastIndex = 0;
        return t.replace(re!, step.replace);
      });
    }
    case "fill_blanks": {
      const i = colIndex(ds, step.column, step);
      return mapColumn(ds, i, (v) => (isBlank(v) ? step.value : v));
    }
    case "convert_number": {
      const i = colIndex(ds, step.column, step);
      return mapColumn(ds, i, (v, r) => {
        if (isBlank(v)) return null;
        const n = parseMoney(v);
        if (n === null) {
          issue(ctx, ds, r, step.column, "invalid_number", `"${toText(v)}" is not a valid number`, v);
          return null;
        }
        return step.decimals === null ? n : roundHalfEven(n, step.decimals);
      });
    }
    case "standardise_date": {
      const i = colIndex(ds, step.column, step);
      return mapColumn(ds, i, (v, r) => {
        if (isBlank(v)) return null;
        const d = parseDate(v, step.inputFormats);
        if (!d) {
          issue(ctx, ds, r, step.column, "invalid_date", `Date value "${toText(v)}" is not valid`, v);
          return null;
        }
        return formatDate(d, step.outputFormat);
      });
    }
    case "extract": {
      const i = colIndex(ds, step.column, step);
      for (const f of step.fields) {
        try {
          compileRegex(f.pattern, f.ignoreCase ? "i" : "");
        } catch {
          throw new StepError(step.id, `Invalid pattern for ${f.name}`);
        }
      }
      const names = step.fields.map((f) => f.name);
      return addColumns(ds, names, (r) => {
        const src = toText(ds.rows[r][i]);
        return step.fields.map((f) => {
          const raw = extractValue(src, f.pattern, f.ignoreCase);
          if (raw === null) {
            issue(ctx, ds, r, f.name, src === null ? "missing_value" : "pattern_mismatch", `Could not extract ${f.name} from "${src ?? ""}"`, src);
            return null;
          }
          if (f.type === "number") {
            const n = parseMoney(raw);
            if (n === null) issue(ctx, ds, r, f.name, "invalid_number", `"${raw}" is not a valid number`, raw);
            return n;
          }
          if (f.type === "date") {
            const d = parseDate(raw, ANY_DATE_FORMATS);
            if (!d) {
              issue(ctx, ds, r, f.name, "invalid_date", `Date value "${raw}" is not valid`, raw);
              return null;
            }
            return formatDate(d, "YYYY-MM-DD");
          }
          return raw;
        });
      });
    }
    case "extract_kv": {
      const i = colIndex(ds, step.column, step);
      const names = step.keys.map((k) => k.name);
      return addColumns(ds, names, (r) => {
        const src = toText(ds.rows[r][i]);
        const found = new Map<string, string>();
        if (src !== null && step.pairSeparator && step.kvSeparator) {
          for (const part of src.split(step.pairSeparator)) {
            const at = part.indexOf(step.kvSeparator);
            if (at < 0) continue;
            const k = part.slice(0, at).trim().toLowerCase();
            if (!found.has(k)) found.set(k, part.slice(at + step.kvSeparator.length).trim());
          }
        }
        return step.keys.map((k) => {
          const v = found.get(k.key.trim().toLowerCase());
          if (v === undefined) {
            issue(ctx, ds, r, k.name, "missing_value", `Key "${k.key}" not found`, src);
            return null;
          }
          return v;
        });
      });
    }
    case "split": {
      const i = colIndex(ds, step.column, step);
      if (!step.delimiter) throw new StepError(step.id, "Delimiter is required");
      const n = step.into.length;
      return addColumns(ds, step.into, (r) => {
        const t = toText(ds.rows[r][i]);
        const out: Cell[] = new Array(n).fill(null);
        if (t === null) return out;
        const parts = t.split(step.delimiter);
        for (let k = 0; k < n; k++) {
          const piece = k === n - 1 ? parts.slice(k).join(step.delimiter) : parts[k];
          if (piece === undefined || k >= parts.length) break;
          const tr = piece.trim();
          out[k] = tr === "" ? null : tr;
        }
        return out;
      });
    }
    case "filter": {
      const i = colIndex(ds, step.column, step);
      const rows: Cell[][] = [];
      const rowIds: number[] = [];
      ds.rows.forEach((row, r) => {
        if (matchesFilter(row[i], step.op, step.value)) {
          rows.push(row);
          rowIds.push(ds.rowIds[r]);
        }
      });
      return { columns: ds.columns, rows, rowIds };
    }
    case "sort": {
      const i = colIndex(ds, step.column, step);
      const order = ds.rows.map((_, r) => r);
      const nonNull = order.filter((r) => !isBlank(ds.rows[r][i]));
      const nulls = order.filter((r) => isBlank(ds.rows[r][i]));
      const dir = step.direction === "desc" ? -1 : 1;
      nonNull.sort((a, b) => dir * cmpKeys(sortKey(ds.rows[a][i]), sortKey(ds.rows[b][i])));
      const all = nonNull.concat(nulls);
      return { columns: ds.columns, rows: all.map((r) => ds.rows[r]), rowIds: all.map((r) => ds.rowIds[r]) };
    }
    case "remove_duplicates": {
      const idx = (step.columns.length ? step.columns : ds.columns).map((c) => colIndex(ds, c, step));
      const seen = new Set<string>();
      const rows: Cell[][] = [];
      const rowIds: number[] = [];
      ds.rows.forEach((row, r) => {
        const key = JSON.stringify(idx.map((i) => toText(row[i])));
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
        rowIds.push(ds.rowIds[r]);
      });
      return { columns: ds.columns, rows, rowIds };
    }
    case "formula": {
      if (!step.output.trim()) throw new StepError(step.id, "Output column name is required");
      let expr;
      try {
        expr = parseFormula(step.expression);
      } catch (e) {
        throw new StepError(step.id, `Formula error: ${(e as Error).message}`);
      }
      const lookup = new Map(ds.columns.map((c, i) => [c, i]));
      const check = (name: string) => {
        if (!lookup.has(name)) throw new StepError(step.id, `Column "${name}" not found`);
      };
      const visit = (x: typeof expr): void => {
        if (x.k === "col") check(x.name);
        else if (x.k === "neg") visit(x.e);
        else if (x.k === "bin") {
          visit(x.a);
          visit(x.b);
        } else if (x.k === "call") x.args.forEach(visit);
      };
      visit(expr);
      return addColumns(ds, [step.output], (r) => [evalFormula(expr, (c) => ds.rows[r][lookup.get(c)!])]);
    }
    case "round": {
      const i = colIndex(ds, step.column, step);
      return mapColumn(ds, i, (v) => {
        const n = toNum(v);
        return n === null ? v : roundHalfEven(n, step.decimals);
      });
    }
    case "validate": {
      for (const rule of step.rules) {
        const i = colIndex(ds, rule.column, step);
        let evaluated = 0;
        let passed = 0;
        const seen = new Set<string>();
        let re: RegExp | null = null;
        if (rule.kind === "matches") {
          try {
            re = compileRegex(rule.pattern);
          } catch {
            throw new StepError(step.id, `Invalid pattern in rule for ${rule.column}`);
          }
        }
        ds.rows.forEach((row, r) => {
          const v = row[i];
          let ok: boolean;
          if (rule.kind === "not_blank") {
            ok = !isBlank(v);
          } else {
            if (isBlank(v)) return;
            const t = toText(v)!;
            switch (rule.kind) {
              case "matches":
                ok = re!.test(t);
                break;
              case "valid_date":
                ok = parseDate(v, ANY_DATE_FORMATS) !== null;
                break;
              case "in_set":
                ok = rule.values.includes(t);
                break;
              case "unique":
                ok = !seen.has(t);
                seen.add(t);
                break;
              default: {
                const n = toNum(v);
                ok =
                  n !== null &&
                  (rule.kind === "gt" ? n > rule.value : rule.kind === "gte" ? n >= rule.value : rule.kind === "lt" ? n < rule.value : n <= rule.value);
              }
            }
          }
          evaluated++;
          if (ok) passed++;
          else
            issue(
              ctx,
              ds,
              r,
              rule.column,
              rule.kind === "not_blank" ? "missing_value" : rule.kind === "valid_date" ? "invalid_date" : rule.kind === "matches" ? "pattern_mismatch" : "rule_failed",
              `${ruleLabel(rule)} (value: ${toText(v) ?? "blank"})`,
              v,
              rule.id,
            );
        });
        ruleResults.push({ ruleId: rule.id, column: rule.column, kind: rule.kind, evaluated, passed });
      }
      return ds;
    }
  }
}

/** Keep issue bookkeeping aligned with column renames / drops and removed rows. */
function reconcileIssues(issues: Issue[], step: Step, out: Dataset): Issue[] {
  let next = issues;
  if (step.type === "rename") {
    next = next.map((i) => (step.mapping[i.column] ? { ...i, column: step.mapping[i.column] } : i));
  }
  if (step.type === "select" || step.type === "filter" || step.type === "remove_duplicates") {
    const cols = new Set(out.columns);
    const rows = new Set(out.rowIds);
    next = next.filter((i) => cols.has(i.column) && rows.has(i.row));
  }
  return next;
}

function countChanges(before: Dataset, after: Dataset): number {
  if (before.rowIds !== after.rowIds && before.rows.length !== after.rows.length) return 0;
  let n = 0;
  const shared = after.columns.map((c) => before.columns.indexOf(c));
  for (let r = 0; r < after.rows.length; r++) {
    const a = after.rows[r];
    const b = before.rows[r];
    if (a === b || !b) continue;
    for (let c = 0; c < shared.length; c++) {
      const bi = shared[c];
      if (bi < 0) continue;
      if (a[c] !== b[bi]) n++;
    }
  }
  return n;
}

export function summarizeStep(step: Step, before: Dataset, after: Dataset, changed: number, issues: number): string {
  const added = after.columns.filter((c) => !before.columns.includes(c));
  const removedRows = before.rows.length - after.rows.length;
  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} column${added.length > 1 ? "s" : ""} added`);
  if (step.type === "select") parts.push(`${after.columns.length} columns selected`);
  if (step.type === "rename") parts.push(`${Object.keys(step.mapping).length} columns renamed`);
  if (changed && !added.length) parts.push(`${changed.toLocaleString()} cells changed`);
  if (removedRows > 0) parts.push(`${removedRows.toLocaleString()} rows removed`);
  if (issues) parts.push(`${issues.toLocaleString()} flagged`);
  return parts.join(" · ") || "No changes";
}

function coerceCorrection(ds: Dataset, colIdx: number, value: string): Cell {
  const numericColumn = ds.rows.some((row) => typeof row[colIdx] === "number");
  if (numericColumn) {
    const n = toNum(value);
    if (n !== null) return n;
  }
  return value;
}

export interface ExecuteOptions {
  limit?: number;
  keepSnapshots?: boolean;
  /** Execute only steps up to and including this index (for step previews). */
  uptoStep?: number;
}

export function execute(spec: PipelineSpec, sheet: RawSheet, opts: ExecuteOptions = {}): ExecutionResult {
  if (!spec.source) throw new Error("Pipeline has no source");
  let input = loadDataset(sheet, spec.source);
  if (opts.limit !== undefined && input.rows.length > opts.limit) {
    input = { columns: input.columns, rows: input.rows.slice(0, opts.limit), rowIds: input.rowIds.slice(0, opts.limit) };
  }
  const fingerprints = new Map<number, string>();
  input.rows.forEach((row, r) => fingerprints.set(input.rowIds[r], fingerprint(row)));

  let ds = input;
  let issues: Issue[] = [];
  const results: StepResult[] = [];
  const ruleResults: RuleResult[] = [];
  const snapshots: Dataset[] = [];
  const last = opts.uptoStep ?? spec.steps.length - 1;
  let failed = false;

  for (let s = 0; s <= last && s < spec.steps.length; s++) {
    const step = spec.steps[s];
    const t0 = performance.now();
    const before = ds;
    const ctx: Ctx = { issues: [], step };
    if (failed) {
      results.push({
        stepId: step.id, rowsIn: 0, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [],
        issues: 0, durationMs: 0, summary: "Skipped", error: "Skipped (previous step failed)",
      });
      if (opts.keepSnapshots) snapshots.push(ds);
      continue;
    }
    try {
      ds = applyStep(ds, step, ctx, ruleResults);
      issues = reconcileIssues(issues, step, ds).concat(ctx.issues);
      const changed = countChanges(before, ds);
      results.push({
        stepId: step.id,
        rowsIn: before.rows.length,
        rowsOut: ds.rows.length,
        changedCells: changed,
        addedColumns: ds.columns.filter((c) => !before.columns.includes(c)),
        removedColumns: before.columns.filter((c) => !ds.columns.includes(c)),
        issues: ctx.issues.length,
        durationMs: performance.now() - t0,
        summary: summarizeStep(step, before, ds, changed, ctx.issues.length),
      });
    } catch (e) {
      failed = true;
      results.push({
        stepId: step.id, rowsIn: before.rows.length, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [],
        issues: 0, durationMs: performance.now() - t0, summary: "Failed", error: (e as Error).message,
      });
    }
    if (opts.keepSnapshots) snapshots.push(ds);
  }

  const gate = applyReviewGate(ds, issues, spec.reviewDecisions, fingerprints);
  return {
    input,
    beforeGate: ds,
    output: gate.output,
    steps: results,
    issues,
    reviewRows: gate.reviewRows,
    excludedRows: gate.excludedRows,
    ruleResults,
    snapshots: opts.keepSnapshots ? snapshots : undefined,
  };
}

/**
 * Review gate (PRD §6.9). Rows with unresolved issues are held for review and
 * not loaded. Decisions only apply when the row content still matches the
 * content the decision was made against (fingerprint), so a rerun on a new
 * file never silently reuses stale corrections.
 */
export function applyReviewGate(
  ds: Dataset,
  issues: Issue[],
  decisions: (ReviewDecision & { fingerprint?: string })[],
  fingerprints: Map<number, string>,
): { output: Dataset; reviewRows: number[]; excludedRows: number[] } {
  const byRow = new Map<number, Issue[]>();
  for (const i of issues) {
    const list = byRow.get(i.row);
    if (list) list.push(i);
    else byRow.set(i.row, [i]);
  }
  const decByRow = new Map<number, (ReviewDecision & { fingerprint?: string })[]>();
  for (const d of decisions) {
    if (d.fingerprint !== undefined && fingerprints.get(d.row) !== d.fingerprint) continue;
    const list = decByRow.get(d.row);
    if (list) list.push(d);
    else decByRow.set(d.row, [d]);
  }
  const colIdx = new Map(ds.columns.map((c, i) => [c, i]));
  const rows: Cell[][] = [];
  const rowIds: number[] = [];
  const reviewRows: number[] = [];
  const excludedRows: number[] = [];
  ds.rows.forEach((row, r) => {
    const id = ds.rowIds[r];
    const decs = decByRow.get(id) ?? [];
    if (decs.some((d) => d.action === "exclude")) {
      excludedRows.push(id);
      return;
    }
    const rowIssues = byRow.get(id);
    let next = row;
    for (const d of decs) {
      if (d.column === null || !colIdx.has(d.column)) continue;
      const ci = colIdx.get(d.column)!;
      if (d.action === "correct" && d.value !== undefined) {
        if (next === row) next = row.slice();
        next[ci] = coerceCorrection(ds, ci, d.value);
      } else if (d.action === "keep") {
        const orig = rowIssues?.find((i) => i.column === d.column);
        if (orig) {
          if (next === row) next = row.slice();
          next[ci] = orig.value;
        }
      }
    }
    if (rowIssues) {
      const resolved = new Set(decs.filter((d) => d.column !== null).map((d) => d.column));
      if (decs.some((d) => d.column === null && d.action === "ignore")) {
        // row-level "ignore all warnings"
      } else if (rowIssues.some((i) => !resolved.has(i.column))) {
        reviewRows.push(id);
        return;
      }
    }
    rows.push(next);
    rowIds.push(id);
  });
  return { output: { columns: ds.columns, rows, rowIds }, reviewRows, excludedRows };
}
