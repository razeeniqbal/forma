import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, Upload, Loader2, ArrowRight, ArrowDown, Info, Sheet } from "lucide-react";
import type { AggFn, Dataset, SourceSpec, Step } from "@/engine/types";
import { loadDataset } from "@/engine/load";
import { useApp, defaultSourceSpec } from "@/store/app";
import { ACCEPT, parseFile } from "@/parsers";
import { getSourceFile } from "@/store/db";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import { FileIcon, Seg, Toggle } from "@/components/ui";
import { useWs } from "../context";
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

/** Pick another project source (a file, or one sheet of a workbook) for join / lookup / append. */
function SourcePicker({ value, onChange, verb = "Lookup from" }: { value: SourceSpec; onChange: (s: SourceSpec, ds: Dataset) => void; verb?: string }) {
  const ws = useWs();
  const projectId = ws.pipeline.projectId;
  const all = useApp((s) => s.sources);
  const sources = all.filter((s) => s.projectId === projectId);
  const addSource = useApp((s) => s.addSource);
  const toast = useApp((s) => s.toast);
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
      const meta = await addSource(parsed.source, projectId);
      toast("success", `${meta.name} added to the project`);
      await choose(meta.id);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mainId = ws.spec.source?.fileId;
  const mainSheet = ws.spec.source?.sheet;
  const isOn = (id: string, sheet?: string) => value.fileId === id && (!sheet || (value.sheet ?? "") === sheet);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="section-title" style={{ margin: 0 }}>
        {verb} · project sources
      </div>
      <div className="src-pick compact" role="radiogroup" aria-label="Project sources">
        {sources.map((s) =>
          s.sheets.length > 1 ? (
            s.sheets.map((sh) => {
              const self = s.id === mainId && sh.name === mainSheet;
              return (
                <button
                  type="button"
                  key={`${s.id}/${sh.name}`}
                  role="radio"
                  aria-checked={isOn(s.id, sh.name)}
                  className={`src-pick-row sheet ${isOn(s.id, sh.name) ? "on" : ""}`}
                  disabled={!sh.rows}
                  onClick={() => choose(s.id, sh.name)}
                  title={self ? "This pipeline's own source" : undefined}
                >
                  <Sheet size={13} color={sh.rows ? "var(--green-text)" : "var(--subtle)"} />
                  <span className="grow clamp-1">
                    {s.name} / {sh.name}
                  </span>
                  <span className="small subtle num">{self ? "this pipeline" : sh.rows ? fmtInt(sh.rows) : "empty"}</span>
                </button>
              );
            })
          ) : (
            <button
              type="button"
              key={s.id}
              role="radio"
              aria-checked={isOn(s.id)}
              className={`src-pick-row ${isOn(s.id) ? "on" : ""}`}
              onClick={() => choose(s.id)}
              title={s.id === mainId ? "This pipeline's own source" : undefined}
            >
              <FileIcon kind={s.kind} />
              <span className="grow clamp-1">{s.name}</span>
              <span className="small subtle num">{s.id === mainId ? "this pipeline" : fmtInt(s.sheets[0]?.rows ?? 0)}</span>
            </button>
          ),
        )}
        <button type="button" className="src-pick-row add" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
          <span className="grow">Add new source…</span>
        </button>
      </div>
      <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
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

/** Point a join / lookup / append step at another source, preselecting keys and columns by matching names. */
export function withSource<S extends Extract<Step, { type: "join" | "append" }>>(step: S, source: SourceSpec, ds: Dataset, before: Dataset | undefined): S {
  if (step.type === "append") return { ...step, source };
  let on = step.on
    .map((o) => ({ left: o.left, right: ds.columns.includes(o.right) ? o.right : ds.columns.includes(o.left) ? o.left : "" }))
    .filter((o) => o.right);
  if (!on.length) {
    const common = before?.columns.find((c) => ds.columns.includes(c));
    on = common ? [{ left: common, right: common }] : [];
  }
  const columns = ds.columns.filter((c) => !on.some((o) => o.right === c) && !before?.columns.includes(c));
  return { ...step, source, on, columns };
}

export function CombineEditor({ step, onChange, before }: { step: Extract<Step, { type: "join" | "append" }>; onChange: (s: Step) => void; before?: Dataset }) {
  const ws = useWs();
  const other = useOther(step.source);
  const setSource = (source: SourceSpec, ds: Dataset) => onChange(withSource(step, source, ds, before));
  const verb = step.type === "append" ? "Append rows from" : step.mode === "join" ? "Join with" : "Lookup from";
  const picker = (
    <div className="col" style={{ gap: 4 }}>
      <SourcePicker value={step.source} onChange={setSource} verb={verb} />
      {other && <div className="hint">{`${fmtInt(other.rows.length)} rows · ${other.columns.length} columns`}</div>}
    </div>
  );
  const otherName = step.source.file ? `${step.source.file.replace(/\.[^.]+$/, "")}${step.source.sheet ? ` / ${step.source.sheet}` : ""}` : "Other source";
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
        <div key={i} className="key-map">
          <div className="km-side">
            <span className="km-src">{ws.spec.name}</span>
            <ColumnSelect ds={before} value={o.left} onChange={(left) => onChange({ ...step, on: step.on.map((x, k) => (k === i ? { ...x, left, right: otherDs?.columns.includes(left) && !x.right ? left : x.right } : x)) })} />
          </div>
          <ArrowDown size={14} className="km-arrow" aria-label="matches" />
          <div className="km-side">
            <span className="km-src">{otherName}</span>
            <ColumnSelect ds={otherDs} value={o.right} onChange={(right) => onChange({ ...step, on: step.on.map((x, k) => (k === i ? { ...x, right } : x)) })} />
          </div>
          <button className="btn ghost xs icon km-del" aria-label="Remove key" onClick={() => onChange({ ...step, on: step.on.filter((_, k) => k !== i) })}>
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
