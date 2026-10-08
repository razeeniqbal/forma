// Facts about combining two datasets: join / lookup match counts, key suggestions and append schema
// compatibility. Everything here is computed from real data and never changes a step on its own:
// suggestions are shown to the user, who confirms them.
import type { Dataset, Step } from "@/engine/types";
import { isBlank, toText } from "@/engine/values";
import { profileColumn } from "@/engine/profile";

const keyOf = (row: Dataset["rows"][number], idx: number[]) => JSON.stringify(idx.map((i) => toText(row[i])));

export interface MatchStats {
  leftRows: number;
  rightRows: number;
  /** Left rows with at least one match on the right. */
  matched: number;
  unmatched: number;
}

/** How many primary / left rows find a match, using the same rules as the engine (blank keys never match). */
export function matchStats(left: Dataset, right: Dataset, on: { left: string; right: string }[]): MatchStats | null {
  const li = on.map((o) => left.columns.indexOf(o.left));
  const ri = on.map((o) => right.columns.indexOf(o.right));
  if (!on.length || li.some((i) => i < 0) || ri.some((i) => i < 0)) return null;
  const keys = new Set<string>();
  for (const row of right.rows) if (!ri.some((i) => isBlank(row[i]))) keys.add(keyOf(row, ri));
  let matched = 0;
  for (const row of left.rows) if (!li.some((i) => isBlank(row[i])) && keys.has(keyOf(row, li))) matched++;
  return { leftRows: left.rows.length, rightRows: right.rows.length, matched, unmatched: left.rows.length - matched };
}

const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface KeySuggestion {
  left: string;
  right: string;
  /** Share of distinct non-blank left values found on the right (0..1). */
  overlap: number;
}

/**
 * Candidate key pairs, best first: columns with the same or a similar name whose values actually overlap.
 * Never applied automatically.
 */
export function suggestKeys(left: Dataset, right: Dataset, limit = 3): KeySuggestion[] {
  const out: KeySuggestion[] = [];
  for (const l of left.columns) {
    for (const r of right.columns) {
      const a = norm(l);
      const b = norm(r);
      if (!a || !b || !(a === b || (a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a))))) continue;
      const lv = new Set(left.rows.map((row) => toText(row[left.columns.indexOf(l)])).filter((v): v is string => v !== null));
      const rv = new Set(right.rows.map((row) => toText(row[right.columns.indexOf(r)])).filter((v): v is string => v !== null));
      if (!lv.size || !rv.size) continue;
      let hit = 0;
      for (const v of lv) if (rv.has(v)) hit++;
      const overlap = hit / lv.size;
      if (overlap > 0) out.push({ left: l, right: r, overlap });
    }
  }
  return out.sort((x, y) => y.overlap - x.overlap || Number(norm(y.left) === norm(y.right)) - Number(norm(x.left) === norm(x.right))).slice(0, limit);
}

export type ColumnKind = "number" | "date" | "text" | "empty";

function kindOf(ds: Dataset, column: string): ColumnKind {
  const i = ds.columns.indexOf(column);
  if (i < 0) return "empty";
  const p = profileColumn(ds, i);
  if (!p.filled) return "empty";
  return p.type === "number" ? "number" : p.type === "date" ? "date" : "text";
}

export interface AppendSchema {
  /** Pairs that line up (pipeline column ← appended column), by name or by explicit mapping. */
  matched: { target: string; from: string; mapped: boolean; conflict?: { target: ColumnKind; from: ColumnKind } }[];
  /** Pipeline columns nothing is appended into: appended rows get blanks there. */
  missing: string[];
  /** Appended columns with no counterpart: added as new columns. */
  additional: string[];
  /** Possible mappings for additional columns, by similar name. Shown, never applied. */
  suggestions: { from: string; target: string }[];
  /** Mapping entries that point at columns which do not exist (on either side). */
  invalid: string[];
}

/** Schema compatibility of an Append before it runs. */
export function appendSchema(base: Dataset, other: Dataset, mapping: Record<string, string> = {}): AppendSchema {
  const invalid: string[] = [];
  for (const [from, to] of Object.entries(mapping)) {
    if (!to) continue;
    if (!other.columns.includes(from)) invalid.push(`"${from}" is not a column of the appended source`);
    else if (!base.columns.includes(to)) invalid.push(`"${to}" is not a column of the pipeline`);
  }
  const targetOf = (c: string) => (mapping[c] && base.columns.includes(mapping[c]) ? mapping[c] : c);
  const matched: AppendSchema["matched"] = [];
  const additional: string[] = [];
  for (const from of other.columns) {
    const target = targetOf(from);
    if (base.columns.includes(target)) {
      const a = kindOf(base, target);
      const b = kindOf(other, from);
      matched.push({ target, from, mapped: target !== from, conflict: a !== b && a !== "empty" && b !== "empty" ? { target: a, from: b } : undefined });
    } else additional.push(from);
  }
  const used = new Set(matched.map((m) => m.target));
  const missing = base.columns.filter((c) => !used.has(c));
  const suggestions: AppendSchema["suggestions"] = [];
  for (const from of additional) {
    const f = norm(from);
    const target = missing.find((t) => {
      const n = norm(t);
      return n.length > 2 && f.length > 2 && (n.includes(f) || f.includes(n));
    });
    if (target) suggestions.push({ from, target });
  }
  return { matched, missing, additional, suggestions, invalid };
}

/** The step's inputs, named the way its contract names them. */
export function inputRoles(step: Extract<Step, { type: "join" | "append" }>): [string, string] {
  if (step.type === "append") return ["Pipeline rows", "Appended rows"];
  return step.mode === "lookup" ? ["Primary dataset", "Reference dataset"] : ["Left input", "Right input"];
}
