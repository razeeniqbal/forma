import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, Upload, Loader2, ArrowRight, Info } from "lucide-react";
import type { AggFn, Dataset, SourceSpec, Step } from "@/engine/types";
import { loadDataset } from "@/engine/load";
import { useApp, defaultSourceSpec } from "@/store/app";
import { ACCEPT, parseFile } from "@/parsers";
import { getSourceFile } from "@/store/db";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import { Seg, Toggle } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { ColumnChecklist, ColumnSelect } from "./StepEditor";

const FNS: { value: AggFn; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "mean", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "count", label: "Count (non-blank)" },
  { value: "count_distinct", label: "Count distinct" },
  { value: "first", label: "First value" },
];

const safeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "value";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const HELD_NOTE = (
  <div className="callout">
    <Info size={16} />
    <div className="small">Rows with open review items are held before this step, so they never distort the result. Corrections you make in review flow into it on the next run.</div>
  </div>
);

export function ReshapeEditor({ step, onChange, before }: { step: Extract<Step, { type: "group" | "pivot" | "unpivot" }>; onChange: (s: Step) => void; before?: Dataset }) {
  if (step.type === "group") {
    return (
      <div className="col" style={{ gap: 12 }}>
        <Field label="Group by" hint="Leave empty to aggregate all rows into one.">
          <ColumnChecklist ds={before} value={step.by} onChange={(by) => onChange({ ...step, by })} max={180} />
        </Field>
        <div className="label">Aggregations</div>
        {step.aggs.map((a, i) => (
          <div key={i} className="card" style={{ padding: 8, display: "grid", gap: 6 }}>
            <div className="row">
              <div style={{ flex: 1.2 }}>
                <ColumnSelect ds={before} value={a.column} onChange={(column) => onChange({ ...step, aggs: step.aggs.map((x, k) => (k === i ? { ...x, column, as: x.as === `${safeName(x.column)}_${x.fn}` ? `${safeName(column)}_${x.fn}` : x.as } : x)) })} />
              </div>
              <select className="select" style={{ flex: 1 }} value={a.fn} aria-label="Function" onChange={(e) => {
                const fn = e.target.value as AggFn;
                onChange({ ...step, aggs: step.aggs.map((x, k) => (k === i ? { ...x, fn, as: x.as === `${safeName(x.column)}_${x.fn}` ? `${safeName(x.column)}_${fn}` : x.as } : x)) });
              }}>
                {FNS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button className="btn ghost xs icon" aria-label="Remove aggregation" onClick={() => onChange({ ...step, aggs: step.aggs.filter((_, k) => k !== i) })}>
                <Trash2 size={13} color="var(--red)" />
              </button>
            </div>
            <div className="row">
              <ArrowRight size={13} color="var(--subtle)" />
              <input className="input sm" value={a.as} aria-label="Output column" placeholder="Output column" onChange={(e) => onChange({ ...step, aggs: step.aggs.map((x, k) => (k === i ? { ...x, as: e.target.value } : x)) })} />
            </div>
          </div>
        ))}
        <button
          className="btn sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            const c = before?.columns.find((x) => !step.by.includes(x)) ?? before?.columns[0] ?? "";
            onChange({ ...step, aggs: [...step.aggs, { column: c, fn: "sum", as: `${safeName(c)}_sum` }] });
          }}
        >
          <Plus size={13} /> Add aggregation
        </button>
        {HELD_NOTE}
      </div>
    );
  }
  if (step.type === "pivot") {
    return (
      <div className="col" style={{ gap: 12 }}>
        <Field label="Rows (keep as keys)">
          <ColumnChecklist ds={before} value={step.index} onChange={(index) => onChange({ ...step, index })} max={160} />
        </Field>
        <Field label="Columns from values of">
          <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
        </Field>
        <div className="row">
          <div className="grow">
            <Field label="Values">
              <ColumnSelect ds={before} value={step.value} onChange={(value) => onChange({ ...step, value })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Aggregate">
              <select className="select" value={step.fn} onChange={(e) => onChange({ ...step, fn: e.target.value as AggFn })}>
                {FNS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        {HELD_NOTE}
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 12 }}>
      <Field label="Keep as identifier columns">
        <ColumnChecklist ds={before} value={step.keep} onChange={(keep) => onChange({ ...step, keep, columns: step.columns.filter((c) => !keep.includes(c)) })} max={150} />
      </Field>
      <Field label="Columns to turn into rows">
        <ColumnChecklist ds={before ? { ...before, columns: before.columns.filter((c) => !step.keep.includes(c)) } : undefined} value={step.columns} onChange={(columns) => onChange({ ...step, columns })} max={150} />
      </Field>
      <div className="row">
        <div className="grow">
          <Field label="Name column">
            <input className="input" value={step.nameColumn} onChange={(e) => onChange({ ...step, nameColumn: e.target.value })} />
          </Field>
        </div>
        <div className="grow">
          <Field label="Value column">
            <input className="input" value={step.valueColumn} onChange={(e) => onChange({ ...step, valueColumn: e.target.value })} />
          </Field>
        </div>
      </div>
      {HELD_NOTE}
    </div>
  );
}

/** Pick a second source (existing upload or a new file) and its sheet. */
function SourcePicker({ value, onChange }: { value: SourceSpec; onChange: (s: SourceSpec, ds: Dataset) => void }) {
  const sources = useApp((s) => s.sources);
  const addSource = useApp((s) => s.addSource);
  const toast = useApp((s) => s.toast);
  const { file } = useSourceFile(value.fileId || undefined);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const choose = async (id: string, sheet?: string) => {
    const f = await getSourceFile(id);
    if (!f) return;
    const spec = defaultSourceSpec(f, sheet);
    onChange(spec, loadDataset(sheetOf(f, spec.sheet)!, spec));
  };
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const parsed = await parseFile(f);
      const meta = await addSource(parsed.source);
      await choose(meta.id);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row">
        <select className="select" value={value.fileId} onChange={(e) => e.target.value && choose(e.target.value)} aria-label="Other source">
          <option value="">Choose a source file…</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => ref.current?.click()} disabled={busy} title="Upload a file">
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
        </button>
        <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {file && file.sheets.length > 1 && (
        <select className="select sm" value={value.sheet ?? file.sheets[0].name} onChange={(e) => choose(file.id, e.target.value)} aria-label="Sheet">
          {file.sheets.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function useOther(spec: SourceSpec): Dataset | undefined {
  const { file } = useSourceFile(spec.fileId || undefined);
  return useMemo(() => {
    const sh = sheetOf(file, spec.sheet);
    return sh ? loadDataset(sh, spec) : undefined;
  }, [file, spec]);
}

export function CombineEditor({ step, onChange, before }: { step: Extract<Step, { type: "join" | "append" }>; onChange: (s: Step) => void; before?: Dataset }) {
  const other = useOther(step.source);
  const setSource = (source: SourceSpec, ds: Dataset) => {
    if (step.type === "append") return onChange({ ...step, source });
    // Preselect keys and columns by matching names.
    let on = step.on
      .map((o) => ({ left: o.left, right: ds.columns.includes(o.right) ? o.right : ds.columns.includes(o.left) ? o.left : "" }))
      .filter((o) => o.right);
    if (!on.length) {
      const common = before?.columns.find((c) => ds.columns.includes(c));
      on = common ? [{ left: common, right: common }] : [];
    }
    const columns = ds.columns.filter((c) => !on.some((o) => o.right === c) && !before?.columns.includes(c));
    onChange({ ...step, source, on, columns });
  };
  const picker = (
    <Field label={step.type === "append" ? "Rows from" : "Other source"} hint={other ? `${fmtInt(other.rows.length)} rows · ${other.columns.length} columns` : undefined}>
      <SourcePicker value={step.source} onChange={setSource} />
    </Field>
  );
  if (step.type === "append") {
    const shared = other && before ? other.columns.filter((c) => before.columns.includes(c)) : [];
    const added = other && before ? other.columns.filter((c) => !before.columns.includes(c)) : [];
    return (
      <div className="col" style={{ gap: 12 }}>
        {picker}
        {other && (
          <div className="callout">
            <Info size={16} />
            <div className="small">
              Columns are matched by name: {shared.length} shared{added.length ? `, ${added.length} new (${added.slice(0, 4).join(", ")}${added.length > 4 ? "…" : ""})` : ""}. Missing values are left blank. Appended rows get new row numbers.
            </div>
          </div>
        )}
      </div>
    );
  }
  const otherDs = other;
  return (
    <div className="col" style={{ gap: 12 }}>
      {picker}
      <Field label="Match">
        <Seg
          value={step.mode}
          onChange={(mode) => onChange({ ...step, mode, flagUnmatched: mode === "lookup" ? step.flagUnmatched : false })}
          options={[
            { value: "lookup", label: "Lookup (first match)" },
            { value: "join", label: "Join (every match)" },
          ]}
        />
      </Field>
      <Field label="Rows without a match" hint={step.how === "left" ? "Kept; brought columns stay blank." : "Dropped from the output."}>
        <Seg value={step.how} onChange={(how) => onChange({ ...step, how })} options={[{ value: "left", label: "Keep (left)" }, { value: "inner", label: "Drop (inner)" }]} />
      </Field>
      <div className="label">Match on</div>
      {step.on.map((o, i) => (
        <div key={i} className="row">
          <div className="grow">
            <ColumnSelect ds={before} value={o.left} onChange={(left) => onChange({ ...step, on: step.on.map((x, k) => (k === i ? { ...x, left, right: otherDs?.columns.includes(left) && !x.right ? left : x.right } : x)) })} />
          </div>
          <span className="muted">=</span>
          <div className="grow">
            <ColumnSelect ds={otherDs} value={o.right} onChange={(right) => onChange({ ...step, on: step.on.map((x, k) => (k === i ? { ...x, right } : x)) })} />
          </div>
          <button className="btn ghost xs icon" aria-label="Remove key" onClick={() => onChange({ ...step, on: step.on.filter((_, k) => k !== i) })}>
            <Trash2 size={13} color="var(--red)" />
          </button>
        </div>
      ))}
      <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ ...step, on: [...step.on, { left: before?.columns[0] ?? "", right: otherDs?.columns[0] ?? "" }] })}>
        <Plus size={13} /> Add key
      </button>
      <Field label="Columns to bring in">
        <ColumnChecklist ds={otherDs} value={step.columns} onChange={(columns) => onChange({ ...step, columns })} max={180} />
      </Field>
      <Field label="Prefix for clashing names" hint="Applied only when a brought column already exists.">
        <input className="input sm" value={step.prefix} onChange={(e) => onChange({ ...step, prefix: e.target.value })} />
      </Field>
      {step.mode === "lookup" && step.how === "left" && (
        <Toggle checked={step.flagUnmatched} onChange={(flagUnmatched) => onChange({ ...step, flagUnmatched })} label="Send rows without a match to review" />
      )}
      {step.mode === "join" && HELD_NOTE}
    </div>
  );
}
