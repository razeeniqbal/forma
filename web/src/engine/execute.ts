// Deterministic pipeline executor (PRD §2.3). Every transformation here has a
// generated-Python counterpart in codegen/python.ts; keep them in lock-step.

import type {
  AggFn,
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
import { fingerprint, loadDataset, sideSheetKey } from "./load";
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
  env: Env;
}

/** Execution-wide state shared by steps that create new rows. */
export interface Env {
  /** Raw sheets of additional sources (join / append), by `sideSheetKey`. */
  sheets: Map<string, RawSheet>;
  /** Next row id for rows created by reshaping, appending or joining (unique across the run). */
  nextId: number;
  fingerprints: Map<number, string>;
}

/** Steps that change row identity: the review gate runs before them. */
export function isReshaping(step: Step): boolean {
  return step.type === "group" || step.type === "pivot" || step.type === "unpivot" || (step.type === "join" && step.mode === "join");
}

function newRows(ctx: Ctx, columns: string[], rows: Cell[][]): Dataset {
  const rowIds = rows.map((row) => {
    const id = ctx.env.nextId++;
    ctx.env.fingerprints.set(id, fingerprint(row));
    return id;
  });
  return { columns, rows, rowIds };
}

function sideSource(ctx: Ctx, spec: import("./types").SourceSpec): Dataset {
  const sheet = ctx.env.sheets.get(sideSheetKey(spec.fileId, spec.sheet)) ?? ctx.env.sheets.get(spec.fileId);
  if (!sheet) throw new StepError(ctx.step.id, `Source file "${spec.file}" is not available. Re-upload it in the step settings.`);
  return loadDataset(sheet, spec);
}

/** Aggregate a list of values (mirrors Python `aggregate_values`). */
export function aggregate(values: Cell[], fn: AggFn): Cell {
  if (fn === "first") {
    for (const v of values) if (!isBlank(v)) return v;
    return null;
  }
  if (fn === "count") return values.filter((v) => !isBlank(v)).length;
  if (fn === "count_distinct") return new Set(values.filter((v) => !isBlank(v)).map((v) => toText(v))).size;
  let total = 0;
  let n = 0;
  let lo: number | null = null;
  let hi: number | null = null;
  for (const v of values) {
    const x = toNum(v);
    if (x === null) continue;
    total += x;
    n++;
    if (lo === null || x < lo) lo = x;
    if (hi === null || x > hi) hi = x;
  }
  if (!n) return null;
  if (fn === "sum") return total;
  if (fn === "mean") return total / n;
  if (fn === "min") return lo;
  return hi;
}

const keyOf = (row: Cell[], idx: number[]) => JSON.stringify(idx.map((i) => toText(row[i])));

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
    case "group": {
      if (!step.aggs.length) throw new StepError(step.id, "Add at least one aggregation");
      const by = step.by.map((c) => colIndex(ds, c, step));
      const aggIdx = step.aggs.map((a) => colIndex(ds, a.column, step));
      const names = [...step.by, ...step.aggs.map((a) => a.as || `${a.column}_${a.fn}`)];
      if (new Set(names).size !== names.length) throw new StepError(step.id, "Output column names must be unique");
      const groups = new Map<string, number[]>();
      ds.rows.forEach((row, r) => {
        const k = keyOf(row, by);
        const g = groups.get(k);
        if (g) g.push(r);
        else groups.set(k, [r]);
      });
      const rows = [...groups.values()].map((members) => [
        ...by.map((i) => ds.rows[members[0]][i]),
        ...step.aggs.map((a, k) => aggregate(members.map((r) => ds.rows[r][aggIdx[k]]), a.fn)),
      ]);
      return newRows(ctx, names, rows);
    }
    case "pivot": {
      const idx = step.index.map((c) => colIndex(ds, c, step));
      const pc = colIndex(ds, step.column, step);
      const vc = colIndex(ds, step.value, step);
      const pivotValues: string[] = [];
      const seenP = new Set<string>();
      const groups = new Map<string, { first: number; cells: Map<string, Cell[]> }>();
      ds.rows.forEach((row, r) => {
        const p = toText(row[pc]) ?? "(blank)";
        if (!seenP.has(p)) {
          seenP.add(p);
          pivotValues.push(p);
        }
        const k = keyOf(row, idx);
        let g = groups.get(k);
        if (!g) {
          g = { first: r, cells: new Map() };
          groups.set(k, g);
        }
        const list = g.cells.get(p);
        if (list) list.push(row[vc]);
        else g.cells.set(p, [row[vc]]);
      });
      const colNames = pivotValues.map((p) => (step.index.includes(p) ? `${p}_${step.column}` : p));
      const rows = [...groups.values()].map((g) => [
        ...idx.map((i) => ds.rows[g.first][i]),
        ...pivotValues.map((p) => (g.cells.has(p) ? aggregate(g.cells.get(p)!, step.fn) : null)),
      ]);
      return newRows(ctx, [...step.index, ...colNames], rows);
    }
    case "unpivot": {
      if (!step.columns.length) throw new StepError(step.id, "Choose the columns to unpivot");
      const keep = step.keep.map((c) => colIndex(ds, c, step));
      const cols = step.columns.map((c) => colIndex(ds, c, step));
      const names = [...step.keep, step.nameColumn || "variable", step.valueColumn || "value"];
      if (new Set(names).size !== names.length) throw new StepError(step.id, "Output column names must be unique");
      const rows: Cell[][] = [];
      for (const row of ds.rows) cols.forEach((ci, k) => rows.push([...keep.map((i) => row[i]), step.columns[k], row[ci]]));
      return newRows(ctx, names, rows);
    }
    case "join": {
      if (!step.on.length) throw new StepError(step.id, "Choose at least one key column");
      const right = sideSource(ctx, step.source);
      const li = step.on.map((o) => colIndex(ds, o.left, step));
      const ri = step.on.map((o) => {
        const i = right.columns.indexOf(o.right);
        if (i < 0) throw new StepError(step.id, `Column "${o.right}" not found in ${step.source.file}`);
        return i;
      });
      const bring = step.columns.map((c) => {
        const i = right.columns.indexOf(c);
        if (i < 0) throw new StepError(step.id, `Column "${c}" not found in ${step.source.file}`);
        return i;
      });
      const outNames = step.columns.map((c) => (ds.columns.includes(c) ? `${step.prefix}${c}` : c));
      const columns = [...ds.columns, ...outNames];
      if (new Set(columns).size !== columns.length) throw new StepError(step.id, "Joined column names clash; change the prefix");
      const index = new Map<string, number[]>();
      right.rows.forEach((row, r) => {
        if (ri.some((i) => isBlank(row[i]))) return; // blank keys never match
        const k = keyOf(row, ri);
        const list = index.get(k);
        if (list) list.push(r);
        else index.set(k, [r]);
      });
      const blank = () => bring.map(() => null as Cell);
      const pick = (r: number) => bring.map((i) => right.rows[r][i]);
      if (step.mode === "lookup") {
        const rows: Cell[][] = [];
        const rowIds: number[] = [];
        ds.rows.forEach((row, r) => {
          const hit = li.some((i) => isBlank(row[i])) ? undefined : index.get(keyOf(row, li))?.[0];
          if (hit === undefined) {
            if (step.how === "inner") return;
            if (step.flagUnmatched) issue(ctx, ds, r, step.on[0].left, "missing_value", `No match in ${step.source.file} for ${step.on.map((o) => toText(row[ds.columns.indexOf(o.left)]) ?? "blank").join(", ")}`, row[li[0]]);
          }
          rows.push([...row, ...(hit === undefined ? blank() : pick(hit))]);
          rowIds.push(ds.rowIds[r]);
        });
        return { columns, rows, rowIds };
      }
      const rows: Cell[][] = [];
      ds.rows.forEach((row) => {
        const hits = li.some((i) => isBlank(row[i])) ? undefined : index.get(keyOf(row, li));
        if (!hits) {
          if (step.how === "left") rows.push([...row, ...blank()]);
          return;
        }
        for (const h of hits) rows.push([...row, ...pick(h)]);
      });
      return newRows(ctx, columns, rows);
    }
    case "append": {
      const other = sideSource(ctx, step.source);
      const columns = [...ds.columns, ...other.columns.filter((c) => !ds.columns.includes(c))];
      const pad = columns.length - ds.columns.length;
      const map = columns.map((c) => other.columns.indexOf(c));
      const extra = newRows(ctx, columns, other.rows.map((row) => map.map((i) => (i < 0 ? null : row[i]))));
      return {
        columns,
        rows: [...ds.rows.map((row) => (pad ? [...row, ...new Array(pad).fill(null)] : row)), ...extra.rows],
        rowIds: [...ds.rowIds, ...extra.rowIds],
      };
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

/**
 * Keep issue bookkeeping aligned with column renames / drops and removed rows.
 * Only rows present before the step are affected, so issues of rows already
 * held for review at an earlier gate are kept.
 */
function reconcileIssues(issues: Issue[], step: Step, before: Dataset, out: Dataset): Issue[] {
  let next = issues;
  if (step.type === "rename") {
    next = next.map((i) => (step.mapping[i.column] ? { ...i, column: step.mapping[i.column] } : i));
  }
  if (step.type === "select" || step.type === "filter" || step.type === "remove_duplicates" || (step.type === "join" && step.how === "inner")) {
    const cols = new Set(out.columns);
    const kept = new Set(out.rowIds);
    const present = new Set(before.rowIds);
    next = next.filter((i) => !present.has(i.row) || (kept.has(i.row) && cols.has(i.column)));
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
  /** Raw sheets for join / append sources, by `sideSheetKey` (or file id). */
  sheets?: Map<string, RawSheet> | Record<string, RawSheet>;
}

export function execute(spec: PipelineSpec, sheet: RawSheet, opts: ExecuteOptions = {}): ExecutionResult {
  if (!spec.source) throw new Error("Pipeline has no source");
  let input = loadDataset(sheet, spec.source);
  if (opts.limit !== undefined && input.rows.length > opts.limit) {
    input = { columns: input.columns, rows: input.rows.slice(0, opts.limit), rowIds: input.rowIds.slice(0, opts.limit) };
  }
  const fingerprints = new Map<number, string>();
  input.rows.forEach((row, r) => fingerprints.set(input.rowIds[r], fingerprint(row)));

  const env: Env = {
    sheets: opts.sheets instanceof Map ? opts.sheets : new Map(Object.entries(opts.sheets ?? {})),
    nextId: (input.rowIds.length ? Math.max(...input.rowIds) : 0) + 1,
    fingerprints,
  };
  const gated: Dataset[] = [];
  const held: number[] = [];
  const excluded: number[] = [];

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
    const ctx: Ctx = { issues: [], step, env };
    if (failed) {
      results.push({
        stepId: step.id, rowsIn: 0, rowsOut: 0, changedCells: 0, addedColumns: [], removedColumns: [],
        issues: 0, durationMs: 0, summary: "Skipped", error: "Skipped (previous step failed)",
      });
      if (opts.keepSnapshots) snapshots.push(ds);
      continue;
    }
    if (!failed && isReshaping(step)) {
      // Hold rows with unresolved issues (and apply decisions) before row identity changes.
      gated.push(ds);
      const g = applyReviewGate(ds, issues, spec.reviewDecisions, fingerprints);
      held.push(...g.reviewRows);
      excluded.push(...g.excludedRows);
      ds = g.output;
    }
    const before = ds;
    try {
      ds = applyStep(ds, step, ctx, ruleResults);
      issues = reconcileIssues(issues, step, before, ds).concat(ctx.issues);
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

  gated.push(ds);
  const gate = applyReviewGate(ds, issues, spec.reviewDecisions, fingerprints);
  return {
    input,
    beforeGate: ds,
    output: gate.output,
    steps: results,
    issues,
    reviewRows: [...held, ...gate.reviewRows],
    excludedRows: [...excluded, ...gate.excludedRows],
    ruleResults,
    snapshots: opts.keepSnapshots ? snapshots : undefined,
    gated,
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
