import type { Dataset, Step, StepType, ValidationRule } from "@/engine/types";
import { newId } from "@/engine/registry";
import { profileColumn } from "@/engine/profile";
import { detectDateFormats, toText } from "@/engine/values";

const FIELD_NAME: Record<string, { name: string; type: "text" | "number" | "date" }> = {
  invoice_id: { name: "invoice_no", type: "text" },
  date: { name: "date", type: "date" },
  currency: { name: "amount", type: "number" },
  email: { name: "email", type: "text" },
};

export function suggestExtractFields(ds: Dataset, column: string) {
  const i = ds.columns.indexOf(column);
  if (i < 0) return [];
  const p = profileColumn(ds, i, 500);
  return p.patterns
    .filter((x) => FIELD_NAME[x.id])
    .map((x) => ({ name: FIELD_NAME[x.id].name, type: FIELD_NAME[x.id].type, pattern: x.pattern }));
}

export function suggestKvKeys(ds: Dataset, column: string, pairSep: string, kvSep: string) {
  const i = ds.columns.indexOf(column);
  const keys = new Map<string, number>();
  for (const row of ds.rows.slice(0, 300)) {
    const t = toText(row[i]);
    if (!t) continue;
    for (const part of t.split(pairSep)) {
      const at = part.indexOf(kvSep);
      if (at > 0) {
        const k = part.slice(0, at).trim();
        if (k && k.length < 40) keys.set(k, (keys.get(k) ?? 0) + 1);
      }
    }
  }
  return [...keys.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => ({ key: k, name: k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "value" }));
}

function guessDelimiter(ds: Dataset, column: string): string {
  const i = ds.columns.indexOf(column);
  const counts: Record<string, number> = { ",": 0, "|": 0, ";": 0, " - ": 0, "/": 0, " ": 0 };
  for (const row of ds.rows.slice(0, 200)) {
    const t = toText(row[i]) ?? "";
    for (const d of Object.keys(counts)) if (t.includes(d)) counts[d]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

function uniqueName(ds: Dataset, base: string): string {
  let n = base;
  let k = 2;
  while (ds.columns.includes(n)) n = `${base}_${k++}`;
  return n;
}

export function suggestRules(ds: Dataset, column?: string): ValidationRule[] {
  const cols = column ? [column] : ds.columns.slice(0, 6);
  const rules: ValidationRule[] = [];
  for (const c of cols) {
    const i = ds.columns.indexOf(c);
    if (i < 0) continue;
    const p = profileColumn(ds, i, 1000);
    if (p.completeness > 0.9) rules.push({ id: newId("r"), column: c, kind: "not_blank" });
    if (p.type === "number") rules.push({ id: newId("r"), column: c, kind: "gt", value: 0 });
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.examples[0] ?? "")) rules.push({ id: newId("r"), column: c, kind: "valid_date" });
    if (p.unique <= 6 && p.filled > 20 && p.type === "text") rules.push({ id: newId("r"), column: c, kind: "in_set", values: p.top.map((t) => t.value) });
    if (/^[A-Z]{2,5}-?\d+$/.test(p.examples[0] ?? "")) rules.push({ id: newId("r"), column: c, kind: "matches", pattern: "^[A-Z]{2,5}-?\\d+$", description: "Must match ID pattern" });
    if (p.uniqueness > 0.97 && p.filled > 20 && /id|no|number|code/i.test(c)) rules.push({ id: newId("r"), column: c, kind: "unique" });
  }
  if (!rules.length && ds.columns[0]) rules.push({ id: newId("r"), column: column ?? ds.columns[0], kind: "not_blank" });
  return rules;
}

export function makeStep(type: StepType, ds: Dataset | undefined, column: string | undefined, dateFormat = "YYYY-MM-DD"): Step {
  const id = newId(type.slice(0, 4));
  const cols = ds?.columns ?? [];
  const col = column && cols.includes(column) ? column : cols[0] ?? "";
  const values = ds && col ? ds.rows.slice(0, 2000).map((r) => r[cols.indexOf(col)]) : [];
  switch (type) {
    case "select":
      return { id, type, columns: cols.slice() };
    case "rename":
      return { id, type, mapping: col ? { [col]: col.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") } : {} };
    case "trim":
      return { id, type, columns: col ? [col] : [], collapseSpaces: true };
    case "change_case":
      return { id, type, columns: col ? [col] : [], mode: "title" };
    case "replace":
      return { id, type, column: col, find: "", replace: "", match: "exact" };
    case "fill_blanks":
      return { id, type, column: col, value: "" };
    case "convert_number":
      return { id, type, column: col, decimals: 2 };
    case "standardise_date": {
      const detected = detectDateFormats(values).map((d) => d.format);
      return { id, type, column: col, inputFormats: detected.length ? detected : ["DD/MM/YYYY", "YYYY-MM-DD"], outputFormat: dateFormat };
    }
    case "extract": {
      const fields = ds && col ? suggestExtractFields(ds, col) : [];
      return { id, type, column: col, method: "pattern", fields: fields.length ? fields : [{ name: "field_1", type: "text", pattern: "" }] };
    }
    case "extract_kv": {
      const keys = ds && col ? suggestKvKeys(ds, col, ";", ":") : [];
      return { id, type, column: col, pairSeparator: ";", kvSeparator: ":", keys: keys.length ? keys : [{ key: "key", name: "key" }] };
    }
    case "split": {
      const base = col.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      return { id, type, column: col, delimiter: ds && col ? guessDelimiter(ds, col) : ",", into: [`${base}_1`, `${base}_2`] };
    }
    case "filter":
      return { id, type, column: col, op: "not_blank", value: "" };
    case "sort":
      return { id, type, column: col, direction: "asc" };
    case "remove_duplicates":
      return { id, type, columns: col ? [col] : [] };
    case "formula":
      return { id, type, output: ds ? uniqueName(ds, "new_column") : "new_column", expression: col ? `[${col}] * 1` : "" };
    case "round":
      return { id, type, column: col, decimals: 2 };
    case "validate":
      return { id, type, rules: ds ? suggestRules(ds, column) : [] };
  }
}
