// Value semantics shared by the TypeScript engine and the generated Python.
// Every function here has a line-for-line counterpart in codegen/runtime.py.ts;
// the parity test suite checks both produce identical output.

import type { Cell } from "./types";

/** Canonical text form of a cell (mirrors Python `_to_text`). */
export function toText(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v) && Math.abs(v) < 1e16) return String(v);
    return pyFloatRepr(v);
  }
  return v;
}

/** Python's repr(float) for non-integers: shortest round-trip, with exponent style differences handled. */
function pyFloatRepr(v: number): string {
  const s = String(v);
  // JS: 1e-7 ; Python: 1e-07. JS: 1.5e+21 ; Python: 1.5e+21
  return s.replace(/e([+-])(\d)$/, "e$10$2");
}

export function isBlank(v: Cell): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

const STRICT_NUM = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

/** Strict numeric coercion used by formulas, filters and rules (mirrors `_to_num`). */
export function toNum(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (!STRICT_NUM.test(v)) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lenient number parsing for "Convert to number": accepts currency prefixes or
 * suffixes (RM, USD, $), thousands separators and signs. Rejects anything
 * ambiguous such as "RM3.1k" or "RM3,OOO".
 */
/** Currency markers accepted around amounts. Only real currency codes, so IDs like "INV-2231" never parse as numbers. */
export const CURRENCY = "USD|EUR|GBP|MYR|SGD|IDR|THB|PHP|VND|INR|CNY|JPY|KRW|HKD|TWD|AUD|NZD|CAD|CHF|AED|SAR|BND|RM|Rm|rm|Rp|Rs|S\\$|US\\$|A\\$|[$€£¥₹]";
export const MONEY_RE = new RegExp(
  `^\\s*([-+])?\\s*(?:(${CURRENCY})\\.?\\s*)?([-+])?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?\\s*(?:${CURRENCY})?\\s*$`,
);

export function parseMoney(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return null;
  const m = MONEY_RE.exec(v);
  if (!m) return null;
  const neg = m[1] === "-" || m[3] === "-";
  const n = parseFloat(m[4].replace(/,/g, "") + (m[5] ?? ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** numpy-compatible round (half to even on the scaled value). */
export function roundHalfEven(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  const y = x * f;
  const r = Math.round(y);
  // Math.round rounds .5 up; correct to even when exactly halfway.
  const rint = Math.abs(y % 1) === 0.5 ? 2 * Math.round(y / 2) : r;
  const out = rint / f;
  return Object.is(out, -0) ? 0 : out;
}

/** Python str.title() equivalent. */
export function titleCase(s: string): string {
  let out = "";
  let prevCased = false;
  for (const ch of s) {
    const isLetter = /\p{L}/u.test(ch);
    if (isLetter) {
      out += prevCased ? ch.toLowerCase() : ch.toUpperCase();
      prevCased = true;
    } else {
      out += ch;
      prevCased = false;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Input date formats: regex + which group holds day / month / year. */
export const DATE_FORMATS: Record<string, { re: string; d: number; m: number; y: number; example: string }> = {
  "DD/MM/YYYY": { re: "^(\\d{1,2})/(\\d{1,2})/(\\d{4})$", d: 1, m: 2, y: 3, example: "15/10/2026" },
  "MM/DD/YYYY": { re: "^(\\d{1,2})/(\\d{1,2})/(\\d{4})$", d: 2, m: 1, y: 3, example: "10/15/2026" },
  "DD/MM/YY": { re: "^(\\d{1,2})/(\\d{1,2})/(\\d{2})$", d: 1, m: 2, y: 3, example: "15/10/26" },
  "DD-MM-YYYY": { re: "^(\\d{1,2})-(\\d{1,2})-(\\d{4})$", d: 1, m: 2, y: 3, example: "15-10-2026" },
  "DD.MM.YYYY": { re: "^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})$", d: 1, m: 2, y: 3, example: "15.10.2026" },
  "YYYY-MM-DD": { re: "^(\\d{4})-(\\d{1,2})-(\\d{1,2})$", d: 3, m: 2, y: 1, example: "2026-10-15" },
  "YYYY/MM/DD": { re: "^(\\d{4})/(\\d{1,2})/(\\d{1,2})$", d: 3, m: 2, y: 1, example: "2026/10/15" },
  "YYYY-MM-DD HH:mm:ss": {
    re: "^(\\d{4})-(\\d{1,2})-(\\d{1,2})[ T]\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?$",
    d: 3, m: 2, y: 1, example: "2026-10-15 00:00:00",
  },
  "MMM DD, YYYY": { re: "^([A-Za-z]{3,9})\\.? (\\d{1,2}),? (\\d{4})$", d: 2, m: 1, y: 3, example: "Oct 15, 2026" },
  "DD MMM YYYY": { re: "^(\\d{1,2}) ([A-Za-z]{3,9})\\.?,? (\\d{4})$", d: 1, m: 2, y: 3, example: "15 Oct 2026" },
};

export const OUTPUT_DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "DD MMM YYYY"] as const;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const compiled = new Map<string, RegExp>();
function dateRe(fmt: string): RegExp {
  let r = compiled.get(fmt);
  if (!r) {
    r = new RegExp(DATE_FORMATS[fmt].re);
    compiled.set(fmt, r);
  }
  return r;
}

export interface YMD {
  y: number;
  m: number;
  d: number;
}

function daysIn(y: number, m: number): number {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function parseDateWith(text: string, fmt: string): YMD | null {
  const spec = DATE_FORMATS[fmt];
  if (!spec) return null;
  const m = dateRe(fmt).exec(text.trim());
  if (!m) return null;
  let month: number;
  const mRaw = m[spec.m];
  if (/^\d+$/.test(mRaw)) month = parseInt(mRaw, 10);
  else {
    const mm = MONTHS[mRaw.toLowerCase()];
    if (!mm) return null;
    month = mm;
  }
  const day = parseInt(m[spec.d], 10);
  let year = parseInt(m[spec.y], 10);
  if (m[spec.y].length === 2) year += year <= 68 ? 2000 : 1900;
  if (month < 1 || month > 12) return null;
  if (year < 1000 || year > 9999) return null;
  if (day < 1 || day > daysIn(year, month)) return null;
  return { y: year, m: month, d: day };
}

/** First matching format wins (mirrors `_parse_date`). */
export function parseDate(v: Cell, formats: string[]): YMD | null {
  const t = toText(v);
  if (t === null) return null;
  for (const f of formats) {
    const r = parseDateWith(t, f);
    if (r) return r;
  }
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatDate(d: YMD, fmt: string): string {
  switch (fmt) {
    case "DD/MM/YYYY":
      return `${pad(d.d)}/${pad(d.m)}/${pad(d.y, 4)}`;
    case "MM/DD/YYYY":
      return `${pad(d.m)}/${pad(d.d)}/${pad(d.y, 4)}`;
    case "DD-MM-YYYY":
      return `${pad(d.d)}-${pad(d.m)}-${pad(d.y, 4)}`;
    case "DD MMM YYYY":
      return `${pad(d.d)} ${MONTH_ABBR[d.m - 1]} ${pad(d.y, 4)}`;
    default:
      return `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`;
  }
}

/**
 * Detect which input formats appear in a column. Returns formats ordered by
 * frequency, resolving DD/MM vs MM/DD ambiguity from values where one part > 12.
 */
export function detectDateFormats(values: Cell[]): { format: string; count: number; example: string }[] {
  const counts = new Map<string, { count: number; example: string }>();
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  const slash = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/;
  for (const v of values) {
    const t = toText(v)?.trim();
    if (!t) continue;
    const sm = slash.exec(t);
    if (sm) {
      const a = parseInt(sm[1], 10);
      const b = parseInt(sm[2], 10);
      if (a > 12 && b <= 12) dayFirstEvidence++;
      if (b > 12 && a <= 12) monthFirstEvidence++;
    }
  }
  const preferMonthFirst = monthFirstEvidence > dayFirstEvidence;
  const order = Object.keys(DATE_FORMATS).filter((f) => (preferMonthFirst ? f !== "DD/MM/YYYY" : f !== "MM/DD/YYYY"));
  for (const v of values) {
    const t = toText(v)?.trim();
    if (!t) continue;
    for (const f of order) {
      if (dateRe(f).test(t)) {
        const c = counts.get(f) ?? { count: 0, example: t };
        c.count++;
        counts.set(f, c);
        break;
      }
    }
  }
  return [...counts.entries()]
    .map(([format, c]) => ({ format, count: c.count, example: c.example }))
    .sort((a, b) => b.count - a.count);
}

export function isValidDateText(v: Cell): boolean {
  return parseDate(v, ["YYYY-MM-DD"]) !== null;
}
