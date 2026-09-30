// Column profiling and advisory detection (PRD §6.2, §6.3). Detection never
// changes data; it only informs suggestions until the user applies a step.
import type { Cell, Dataset, RuleResult } from "./types";
import { detectDateFormats, DATE_FORMATS, isBlank, MONEY_RE, parseMoney, toNum, toText } from "./values";

export type InferredType = "text" | "number" | "date" | "bool" | "mixed" | "empty";

export interface ColumnProfile {
  name: string;
  index: number;
  type: InferredType;
  total: number;
  filled: number;
  blank: number;
  unique: number;
  completeness: number;
  uniqueness: number;
  examples: string[];
  min?: string;
  max?: string;
  numericMin?: number;
  numericMax?: number;
  histogram?: number[];
  top: { value: string; count: number }[];
  dateFormats: { format: string; count: number; example: string }[];
  patterns: DetectedPattern[];
  moneyLike: number;
  paddedText: number;
  caseVariants: number;
}

export interface DetectedPattern {
  id: "invoice_id" | "date" | "currency" | "email" | "key_value" | "delimited";
  label: string;
  example: string;
  pattern: string;
  count: number;
}

const DATE_ANY = new RegExp(Object.values(DATE_FORMATS).map((f) => f.re.replace(/^\^|\$$/g, "")).join("|"));

const PATTERN_DETECTORS: { id: DetectedPattern["id"]; label: string; re: RegExp; pattern: string }[] = [
  { id: "invoice_id", label: "Invoice ID", re: /\b[A-Z]{2,5}-?\d{3,}\b/, pattern: "[A-Z]{2,5}-?\\d+" },
  { id: "date", label: "Date", re: /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/, pattern: "(\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}-\\d{1,2}-\\d{4})" },
  { id: "currency", label: "Currency amount", re: /(RM|USD|MYR|SGD|\$|€|£)\s*-?[\d,]+(\.\d+)?/, pattern: "(?:RM|USD|MYR|SGD|\\$|€|£)\\s*(-?[\\d,.]+\\w*)" },
  { id: "email", label: "Email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/, pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.-]+" },
  { id: "key_value", label: "Key-value pairs", re: /\w[\w ]*:\s*[^;|]+[;|]\s*\w[\w ]*:/, pattern: "" },
];

export function profileColumn(ds: Dataset, index: number, sampleLimit = 5000): ColumnProfile {
  const total = ds.rows.length;
  const values: Cell[] = [];
  for (let r = 0; r < total; r++) values.push(ds.rows[r][index]);
  let filled = 0;
  let nums = 0;
  let bools = 0;
  let dates = 0;
  let texts = 0;
  let moneyLike = 0;
  let paddedText = 0;
  const counts = new Map<string, number>();
  const lowerVariants = new Map<string, Set<string>>();
  let nmin = Infinity;
  let nmax = -Infinity;
  const numeric: number[] = [];
  let smin: string | undefined;
  let smax: string | undefined;
  const patternCounts = new Map<string, { count: number; example: string }>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isBlank(v)) continue;
    filled++;
    const t = toText(v)!;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (typeof v === "string") {
      if (v !== v.trim() || /\s{2,}/.test(v)) paddedText++;
      const lower = v.trim().toLowerCase();
      const set = lowerVariants.get(lower) ?? new Set();
      set.add(v.trim());
      lowerVariants.set(lower, set);
    }
    if (typeof v === "boolean") bools++;
    else if (typeof v === "number" || toNum(v) !== null) {
      nums++;
      const n = typeof v === "number" ? v : toNum(v)!;
      numeric.push(n);
      if (n < nmin) nmin = n;
      if (n > nmax) nmax = n;
    } else if (DATE_ANY.test(t.trim()) && /^[\dA-Za-z ,./:-]{6,24}$/.test(t.trim())) dates++;
    else {
      texts++;
      if (MONEY_RE.test(t) && parseMoney(t) !== null) moneyLike++;
    }
    if (smin === undefined || t < smin) smin = t;
    if (smax === undefined || t > smax) smax = t;
    if (i < sampleLimit && typeof v === "string" && v.length > 6) {
      for (const d of PATTERN_DETECTORS) {
        const m = d.re.exec(v);
        if (m) {
          const c = patternCounts.get(d.id) ?? { count: 0, example: m[0] };
          c.count++;
          patternCounts.set(d.id, c);
        }
      }
    }
  }
  let type: InferredType = "empty";
  if (filled) {
    const major = Math.max(nums, dates, texts, bools);
    if (major / filled < 0.8) type = "mixed";
    else if (major === nums) type = "number";
    else if (major === dates) type = "date";
    else if (major === bools) type = "bool";
    else type = moneyLike / filled > 0.8 ? "number" : "text";
  }
  let histogram: number[] | undefined;
  if (numeric.length > 1 && nmax > nmin) {
    histogram = new Array(24).fill(0);
    for (const n of numeric) histogram[Math.min(23, Math.floor(((n - nmin) / (nmax - nmin)) * 24))]++;
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count }));
  const sampledValues = values.slice(0, sampleLimit);
  const patterns: DetectedPattern[] = PATTERN_DETECTORS.filter((d) => (patternCounts.get(d.id)?.count ?? 0) >= Math.max(1, Math.min(filled, sampleLimit) * 0.3)).map((d) => ({
    id: d.id,
    label: d.label,
    pattern: d.pattern,
    example: patternCounts.get(d.id)!.example,
    count: patternCounts.get(d.id)!.count,
  }));
  return {
    name: ds.columns[index],
    index,
    type,
    total,
    filled,
    blank: total - filled,
    unique: counts.size,
    completeness: total ? filled / total : 1,
    uniqueness: filled ? counts.size / filled : 1,
    examples: [...counts.keys()].slice(0, 3),
    min: type === "number" ? undefined : smin,
    max: type === "number" ? undefined : smax,
    numericMin: numeric.length ? nmin : undefined,
    numericMax: numeric.length ? nmax : undefined,
    histogram,
    top,
    dateFormats: type === "date" || dates > 0 ? detectDateFormats(sampledValues) : [],
    patterns,
    moneyLike,
    paddedText,
    caseVariants: [...lowerVariants.values()].filter((s) => s.size > 1).length,
  };
}

export function profileDataset(ds: Dataset): ColumnProfile[] {
  return ds.columns.map((_, i) => profileColumn(ds, i));
}

export interface Observation {
  level: "warning" | "info";
  title: string;
  detail: string;
  column?: string;
  suggestion?: string;
}

export function observations(ds: Dataset, profiles: ColumnProfile[]): Observation[] {
  const out: Observation[] = [];
  for (const p of profiles) {
    if (p.dateFormats.length > 1)
      out.push({
        level: "warning",
        title: `${p.dateFormats.length} mixed date formats in ${p.name}`,
        detail: `e.g. ${p.dateFormats.map((d) => d.example).join(", ")}`,
        column: p.name,
        suggestion: "standardise_date",
      });
    if (p.blank > 0 && p.blank < p.total)
      out.push({ level: p.blank / p.total > 0.05 ? "warning" : "info", title: `${p.blank.toLocaleString()} blank ${p.name}`, detail: `${p.blank.toLocaleString()} out of ${p.total.toLocaleString()} rows`, column: p.name, suggestion: "fill_blanks" });
    if (p.type === "mixed") out.push({ level: "warning", title: `Mixed types in ${p.name}`, detail: "Numbers and text appear in the same column", column: p.name, suggestion: "convert_number" });
    if (p.paddedText > 0) out.push({ level: "info", title: `${p.paddedText.toLocaleString()} values with extra spaces in ${p.name}`, detail: "Leading, trailing or repeated whitespace", column: p.name, suggestion: "trim" });
    if (p.caseVariants > 0 && p.unique < 30) out.push({ level: "info", title: `Inconsistent casing in ${p.name}`, detail: `${p.caseVariants} values appear with different capitalisation`, column: p.name, suggestion: "change_case" });
    const idPattern = p.patterns.find((x) => x.id === "invoice_id");
    if (idPattern) {
      const ids = new Map<string, number>();
      for (const row of ds.rows) {
        const m = /\b[A-Z]{2,5}-?\d{3,}\b/.exec(toText(row[p.index]) ?? "");
        if (m) ids.set(m[0].replace("-", ""), (ids.get(m[0].replace("-", "")) ?? 0) + 1);
      }
      const dups = [...ids.values()].filter((n) => n > 1).length;
      if (dups) out.push({ level: "info", title: `${dups} possible duplicate${dups > 1 ? "s" : ""}`, detail: `Duplicate ${idPattern.label.toLowerCase()} detected in ${p.name}`, column: p.name, suggestion: "remove_duplicates" });
    }
  }
  const seen = new Set<string>();
  let dupRows = 0;
  for (const row of ds.rows) {
    const k = JSON.stringify(row.map(toText));
    if (seen.has(k)) dupRows++;
    seen.add(k);
  }
  if (dupRows) out.push({ level: "info", title: `${dupRows} duplicate row${dupRows > 1 ? "s" : ""}`, detail: "Identical across every column", suggestion: "remove_duplicates" });
  return out;
}

/** Validation health: share of evaluated values that passed configured rules. */
export function validationHealth(results: RuleResult[]) {
  const evaluated = results.reduce((a, r) => a + r.evaluated, 0);
  const passed = results.reduce((a, r) => a + r.passed, 0);
  const dims: Record<string, { evaluated: number; passed: number }> = {
    completeness: { evaluated: 0, passed: 0 },
    validity: { evaluated: 0, passed: 0 },
    uniqueness: { evaluated: 0, passed: 0 },
    consistency: { evaluated: 0, passed: 0 },
  };
  for (const r of results) {
    const d = r.kind === "not_blank" ? "completeness" : r.kind === "unique" ? "uniqueness" : r.kind === "in_set" ? "consistency" : "validity";
    dims[d].evaluated += r.evaluated;
    dims[d].passed += r.passed;
  }
  return { evaluated, passed, ratio: evaluated ? passed / evaluated : 1, dims };
}
