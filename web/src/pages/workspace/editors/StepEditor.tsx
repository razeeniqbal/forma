import { useMemo } from "react";
import { ArrowRight, ChevronUp, ChevronDown, X, Plus } from "lucide-react";
import type { Dataset, FilterOp, Step } from "@/engine/types";
import { DATE_FORMATS, OUTPUT_DATE_FORMATS, detectDateFormats, formatDate, parseDate, toText } from "@/engine/values";
import { parseFormula } from "@/engine/formula";
import { Bar, Seg, Toggle } from "@/components/ui";
import { fmtPct } from "@/lib/format";

export function ColumnSelect({ ds, value, onChange, id }: { ds?: Dataset; value: string; onChange: (v: string) => void; id?: string }) {
  const cols = ds?.columns ?? [];
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {!cols.includes(value) && <option value={value}>{value || "Choose column"}</option>}
      {cols.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}

export function ColumnChecklist({ ds, value, onChange, max = 240 }: { ds?: Dataset; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const cols = ds?.columns ?? [];
  const set = new Set(value);
  return (
    <div className="card" style={{ maxHeight: max, overflow: "auto", padding: 4 }}>
      <div className="row" style={{ padding: "4px 6px", gap: 10 }}>
        <button className="btn xs ghost" onClick={() => onChange(cols.slice())}>
          All
        </button>
        <button className="btn xs ghost" onClick={() => onChange([])}>
          None
        </button>
        <span className="subtle tiny" style={{ marginLeft: "auto" }}>
          {value.length} selected
        </span>
      </div>
      {cols.map((c) => (
        <label key={c} className="row" style={{ padding: "4px 6px", cursor: "pointer", borderRadius: 5 }}>
          <input type="checkbox" checked={set.has(c)} onChange={(e) => onChange(e.target.checked ? cols.filter((x) => set.has(x) || x === c) : value.filter((x) => x !== c))} />
          <span className="ellipsis">{c}</span>
        </label>
      ))}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "is_blank", label: "is blank" },
  { value: "not_blank", label: "is not blank" },
  { value: "gt", label: "> (number)" },
  { value: "gte", label: "≥ (number)" },
  { value: "lt", label: "< (number)" },
  { value: "lte", label: "≤ (number)" },
];

export function StepForm({ step, onChange, before }: { step: Step; onChange: (s: Step) => void; before?: Dataset }) {
  const colValues = (c: string) => {
    const i = before?.columns.indexOf(c) ?? -1;
    return i >= 0 && before ? before.rows.slice(0, 3000).map((r) => r[i]) : [];
  };
  switch (step.type) {
    case "select": {
      const cols = step.columns;
      const avail = (before?.columns ?? []).filter((c) => !cols.includes(c));
      return (
        <div className="col">
          <div className="hint">Keep these columns, in this order. Others are dropped.</div>
          <div className="card" style={{ padding: 4 }}>
            {cols.map((c, i) => (
              <div key={c} className="row" style={{ padding: "3px 6px" }}>
                <span className="subtle tiny num" style={{ width: 18 }}>
                  {i + 1}
                </span>
                <span className="grow ellipsis" style={{ color: before?.columns.includes(c) ? undefined : "var(--red-text)" }}>
                  {c}
                </span>
                <button className="btn ghost xs icon" aria-label="Move up" disabled={i === 0} onClick={() => onChange({ ...step, columns: swap(cols, i, i - 1) })}>
                  <ChevronUp size={13} />
                </button>
                <button className="btn ghost xs icon" aria-label="Move down" disabled={i === cols.length - 1} onClick={() => onChange({ ...step, columns: swap(cols, i, i + 1) })}>
                  <ChevronDown size={13} />
                </button>
                <button className="btn ghost xs icon" aria-label={`Remove ${c}`} onClick={() => onChange({ ...step, columns: cols.filter((x) => x !== c) })}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          {avail.length > 0 && (
            <select className="select sm" value="" onChange={(e) => e.target.value && onChange({ ...step, columns: [...cols, e.target.value] })}>
              <option value="">+ Add column…</option>
              {avail.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
      );
    }
    case "rename":
      return (
        <div className="col">
          <div className="hint">Leave blank to keep the current name.</div>
          {(before?.columns ?? Object.keys(step.mapping)).map((c) => (
            <div key={c} className="row">
              <span className="ellipsis" style={{ width: "42%" }} title={c}>
                {c}
              </span>
              <ArrowRight size={13} color="var(--subtle)" />
              <input
                className="input sm"
                value={step.mapping[c] ?? ""}
                placeholder={c}
                onChange={(e) => {
                  const mapping = { ...step.mapping };
                  if (e.target.value.trim()) mapping[c] = e.target.value;
                  else delete mapping[c];
                  onChange({ ...step, mapping });
                }}
              />
            </div>
          ))}
        </div>
      );
    case "trim":
      return (
        <div className="col">
          <Field label="Columns">
            <ColumnChecklist ds={before} value={step.columns} onChange={(columns) => onChange({ ...step, columns })} />
          </Field>
          <Toggle checked={step.collapseSpaces} onChange={(collapseSpaces) => onChange({ ...step, collapseSpaces })} label="Also collapse repeated spaces" />
        </div>
      );
    case "change_case":
      return (
        <div className="col">
          <Field label="Case">
            <Seg value={step.mode} onChange={(mode) => onChange({ ...step, mode })} options={[{ value: "title", label: "Title Case" }, { value: "upper", label: "UPPER" }, { value: "lower", label: "lower" }]} />
          </Field>
          <Field label="Columns">
            <ColumnChecklist ds={before} value={step.columns} onChange={(columns) => onChange({ ...step, columns })} />
          </Field>
        </div>
      );
    case "replace": {
      let bad = false;
      if (step.match === "regex")
        try {
          new RegExp(step.find);
        } catch {
          bad = true;
        }
      const top = topValues(colValues(step.column));
      return (
        <div className="col">
          <Field label="Column">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <Field label="Match">
            <Seg value={step.match} onChange={(match) => onChange({ ...step, match })} options={[{ value: "exact", label: "Whole value" }, { value: "contains", label: "Contains" }, { value: "regex", label: "Regex" }]} />
          </Field>
          <Field label="Find" hint={bad ? <span style={{ color: "var(--red-text)" }}>Invalid regular expression</span> : undefined}>
            <input className={`input ${step.match === "regex" ? "mono" : ""} ${bad ? "invalid" : ""}`} value={step.find} onChange={(e) => onChange({ ...step, find: e.target.value })} />
          </Field>
          <Field label="Replace with" hint={step.match === "regex" ? "Use $1, $2 for capture groups." : undefined}>
            <input className="input" value={step.replace} onChange={(e) => onChange({ ...step, replace: e.target.value })} />
          </Field>
          {top.length > 0 && step.match === "exact" && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Common values
              </div>
              <div className="chips">
                {top.map((t) => (
                  <button key={t.v} className={`chip ${t.v === step.find ? "on" : ""}`} onClick={() => onChange({ ...step, find: t.v })}>
                    {t.v === "" ? "(empty)" : t.v} <span className="count">{t.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    case "fill_blanks":
      return (
        <div className="col">
          <Field label="Column">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <Field label="Fill with">
            <input className="input" value={step.value} placeholder="e.g. Unknown, 0, -" onChange={(e) => onChange({ ...step, value: e.target.value })} />
          </Field>
        </div>
      );
    case "convert_number":
      return (
        <div className="col">
          <Field label="Column">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <Field label="Decimals" hint="Currency prefixes/suffixes (RM, USD, $) and thousands separators are removed. Ambiguous values such as “RM3.1k” are sent to review.">
            <select className="select" value={step.decimals ?? "keep"} onChange={(e) => onChange({ ...step, decimals: e.target.value === "keep" ? null : Number(e.target.value) })}>
              <option value="keep">Keep precision</option>
              {[0, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  Round to {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );
    case "standardise_date":
      return <DateForm step={step} onChange={onChange} before={before} values={colValues(step.column)} />;
    case "split":
      return (
        <div className="col">
          <Field label="Column">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <Field label="Delimiter">
            <input className="input mono" value={step.delimiter} onChange={(e) => onChange({ ...step, delimiter: e.target.value })} />
          </Field>
          <Field label="Into columns" hint="Any remaining text goes into the last column.">
            <NameList names={step.into} onChange={(into) => onChange({ ...step, into })} />
          </Field>
        </div>
      );
    case "filter":
      return (
        <div className="col">
          <Field label="Keep rows where">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <select className="select" value={step.op} onChange={(e) => onChange({ ...step, op: e.target.value as FilterOp })}>
            {FILTER_OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {step.op !== "is_blank" && step.op !== "not_blank" && <input className="input" value={step.value} placeholder="Value" onChange={(e) => onChange({ ...step, value: e.target.value })} />}
        </div>
      );
    case "sort":
      return (
        <div className="col">
          <Field label="Sort by">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <Seg value={step.direction} onChange={(direction) => onChange({ ...step, direction })} options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} />
          <div className="hint">Numbers sort before text; blanks always go last. Ties keep their original order.</div>
        </div>
      );
    case "remove_duplicates":
      return (
        <Field label="Duplicate when these columns match" hint="Leave all unchecked to compare every column. The first occurrence is kept.">
          <ColumnChecklist ds={before} value={step.columns} onChange={(columns) => onChange({ ...step, columns })} />
        </Field>
      );
    case "formula": {
      let err: string | null = null;
      try {
        if (step.expression.trim()) parseFormula(step.expression);
      } catch (e) {
        err = (e as Error).message;
      }
      return (
        <div className="col">
          <Field label="New column">
            <input className="input" value={step.output} onChange={(e) => onChange({ ...step, output: e.target.value })} />
          </Field>
          <Field label="Formula" hint={err ? <span style={{ color: "var(--red-text)" }}>{err}</span> : "Columns in [brackets]. + − × ÷, round(x, n), abs(x), min(a, b), max(a, b). Blank inputs give blank results."}>
            <textarea className={`input mono ${err ? "invalid" : ""}`} rows={3} value={step.expression} onChange={(e) => onChange({ ...step, expression: e.target.value })} />
          </Field>
          <div className="chips">
            {(before?.columns ?? []).slice(0, 12).map((c) => (
              <button key={c} className="chip" onClick={() => onChange({ ...step, expression: `${step.expression}${step.expression && !/\s$/.test(step.expression) ? " " : ""}[${c}]` })}>
                [{c}]
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "round":
      return (
        <div className="col">
          <Field label="Column">
            <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
          </Field>
          <Field label="Decimals" hint="Uses banker's rounding (round half to even), identical to pandas.">
            <input className="input" type="number" min={0} max={10} value={step.decimals} onChange={(e) => onChange({ ...step, decimals: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} />
          </Field>
        </div>
      );
    default:
      return null;
  }
}

function DateForm({ step, onChange, before, values }: { step: Extract<Step, { type: "standardise_date" }>; onChange: (s: Step) => void; before?: Dataset; values: ReturnType<Dataset["rows"][number]["slice"]> }) {
  const detected = useMemo(() => detectDateFormats(values), [values]);
  const filled = values.filter((v) => toText(v)?.trim()).length;
  const example = values.find((v) => toText(v)?.trim());
  const parsed = example !== undefined ? parseDate(example, step.inputFormats) : null;
  const toggle = (f: string) => onChange({ ...step, inputFormats: step.inputFormats.includes(f) ? step.inputFormats.filter((x) => x !== f) : [...step.inputFormats, f] });
  return (
    <div className="col">
      <Field label="Column">
        <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
      </Field>
      <div className="section-title">Detected formats</div>
      {detected.length === 0 && <div className="hint">No known date formats detected in the preview sample.</div>}
      {detected.map((d) => (
        <div key={d.format} className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={step.inputFormats.includes(d.format)} onChange={() => toggle(d.format)} aria-label={d.format} />
          <span className="mono" style={{ width: 110 }}>
            {d.example}
          </span>
          <span className="num small" style={{ width: 44, textAlign: "right" }}>
            {fmtPct(d.count, filled, 0)}
          </span>
          <div className="grow">
            <Bar value={filled ? d.count / filled : 0} tone="blue" />
          </div>
        </div>
      ))}
      <Field label="Accepted input formats (in order)">
        <div className="chips">
          {Object.keys(DATE_FORMATS).map((f) => (
            <button key={f} className={`chip ${step.inputFormats.includes(f) ? "on" : ""}`} onClick={() => toggle(f)}>
              {f}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Output format">
        <select className="select" value={step.outputFormat} onChange={(e) => onChange({ ...step, outputFormat: e.target.value })}>
          {OUTPUT_DATE_FORMATS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
      {example !== undefined && (
        <div className="row" style={{ gap: 10 }}>
          <div className="input row" style={{ height: 36 }}>
            {toText(example)}
          </div>
          <ArrowRight size={16} color="var(--subtle)" style={{ flex: "none" }} />
          <div className="input row" style={{ height: 36, color: parsed ? undefined : "var(--red-text)" }}>
            {parsed ? formatDate(parsed, step.outputFormat) : "Not a valid date"}
          </div>
        </div>
      )}
    </div>
  );
}

export function NameList({ names, onChange }: { names: string[]; onChange: (n: string[]) => void }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      {names.map((n, i) => (
        <div key={i} className="row">
          <input className="input sm" value={n} onChange={(e) => onChange(names.map((x, k) => (k === i ? e.target.value : x)))} />
          <button className="btn ghost xs icon" aria-label="Remove" disabled={names.length <= 1} onClick={() => onChange(names.filter((_, k) => k !== i))}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...names, `part_${names.length + 1}`])}>
        <Plus size={13} /> Add column
      </button>
    </div>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = a.slice();
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}

function topValues(values: unknown[]): { v: string; n: number }[] {
  const m = new Map<string, number>();
  for (const v of values) {
    const t = toText(v as never) ?? "";
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  if (m.size > 40) return [];
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([v, n]) => ({ v, n }));
}
