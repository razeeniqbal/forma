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
import { appendSchema, inputRoles, suggestKeys } from "@/lib/combine";
import { DocLink } from "@/components/DocLink";

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

export function useOther(spec: SourceSpec): Dataset | undefined {
  const { file } = useSourceFile(spec.fileId || undefined);
  return useMemo(() => {
    const sh = sheetOf(file, spec.sheet);
    return sh ? loadDataset(sh, spec) : undefined;
  }, [file, spec]);
}

/**
 * Point a join / lookup / append step at another source. Keys the user already chose are kept when the new
 * source has them; otherwise keys stay empty. FORMA suggests keys in the editor but never picks them silently.
 */
export function withSource<S extends Extract<Step, { type: "join" | "append" }>>(step: S, source: SourceSpec, ds: Dataset, before: Dataset | undefined): S {
  if (step.type === "append") return { ...step, source, mapping: undefined };
  const on = step.on.filter((o) => o.left && ds.columns.includes(o.right));
  const columns = ds.columns.filter((c) => !on.some((o) => o.right === c) && !before?.columns.includes(c));
  return { ...step, source, on, columns };
}

export function CombineEditor({ step, onChange, before }: { step: Extract<Step, { type: "join" | "append" }>; onChange: (s: Step) => void; before?: Dataset }) {
  const other = useOther(step.source);
  const setSource = (source: SourceSpec, ds: Dataset) => onChange(withSource(step, source, ds, before));
  const verb = step.type === "append" ? "Append rows from" : step.mode === "join" ? "Join with" : "Lookup from";
  const [leftRole, rightRole] = inputRoles(step);
  // With explicit connections the second input can be another step's output instead of a file.
  const fromStep = !step.source.fileId && !!step.source.file;
  const picker = (
    <div className="col" style={{ gap: 4 }}>
      {fromStep && (
        <div className="callout">
          <Info size={16} />
          <div className="small">
            The {rightRole.toLowerCase()} is <b>{step.source.file}</b>, connected on the canvas. Choose a project source below to read a file instead.
          </div>
        </div>
      )}
      <SourcePicker value={step.source} onChange={setSource} verb={verb} />
      {other && <div className="hint">{`${rightRole}: ${fmtInt(other.rows.length)} rows, ${other.columns.length} columns`}</div>}
    </div>
  );
  const otherName = step.source.file ? `${step.source.file.replace(/\.[^.]+$/, "")}${step.source.sheet ? ` / ${step.source.sheet}` : ""}` : "Other source";
  if (step.type === "append") return <AppendEditor step={step} onChange={onChange} before={before} other={other} picker={picker} otherName={otherName} />;
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
            <span className="km-src">{leftRole}</span>
            <ColumnSelect ds={before} value={o.left} onChange={(left) => onChange({ ...step, on: step.on.map((x, k) => (k === i ? { ...x, left } : x)) })} />
          </div>
          <ArrowDown size={14} className="km-arrow" aria-label="matches" />
          <div className="km-side">
            <span className="km-src">{rightRole} ({otherName})</span>
            <ColumnSelect ds={otherDs} value={o.right} onChange={(right) => onChange({ ...step, on: step.on.map((x, k) => (k === i ? { ...x, right } : x)) })} />
          </div>
          <button className="btn ghost xs icon km-del" aria-label="Remove key" onClick={() => onChange({ ...step, on: step.on.filter((_, k) => k !== i) })}>
            <Trash2 size={13} color="var(--red)" />
          </button>
        </div>
      ))}
      <KeySuggestions step={step} before={before} other={otherDs} onUse={(k) => onChange({ ...step, on: [...step.on, k], columns: step.columns.filter((c) => c !== k.right) })} />
      <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ ...step, on: [...step.on, { left: before?.columns[0] ?? "", right: otherDs?.columns[0] ?? "" }] })}>
        <Plus size={13} /> Add key
      </button>
      <Field label={step.mode === "lookup" ? "Fields to bring across" : "Columns to bring in"}>
        <ColumnChecklist ds={otherDs} value={step.columns} onChange={(columns) => onChange({ ...step, columns })} max={180} />
      </Field>
      <Field label="Prefix for clashing names" hint="Applied only when a brought column already exists.">
        <input className="input sm" value={step.prefix} onChange={(e) => onChange({ ...step, prefix: e.target.value })} />
      </Field>
      {step.mode === "lookup" && step.how === "left" && (
        <Toggle checked={step.flagUnmatched} onChange={(flagUnmatched) => onChange({ ...step, flagUnmatched })} label="Send rows without a match to review" />
      )}
      {step.mode === "join" && HELD_NOTE}
      <DocLink page={step.mode === "lookup" ? "combine-lookup" : "combine-join"} />
    </div>
  );
}

/** Suggested key pairs from names and real value overlap. The user confirms each one. */
function KeySuggestions({ step, before, other, onUse }: { step: Extract<Step, { type: "join" }>; before?: Dataset; other?: Dataset; onUse: (k: { left: string; right: string }) => void }) {
  const list = useMemo(() => (before && other ? suggestKeys(before, other) : []), [before, other]);
  const fresh = list.filter((k) => !step.on.some((o) => o.left === k.left && o.right === k.right));
  if (!fresh.length) return step.on.length ? null : <div className="hint">Choose the columns that identify the same record on both sides.</div>;
  return (
    <div className="key-suggest">
      <div className="hint">{step.on.length ? "Other possible keys" : "Suggested keys. FORMA does not pick keys for you: choose one to use it."}</div>
      {fresh.map((k) => (
        <div key={`${k.left}=${k.right}`} className="key-suggest-row">
          <span className="mono">
            {k.left} = {k.right}
          </span>
          <span className="subtle small">{Math.round(k.overlap * 100)}% of values match</span>
          <button className="btn xs" onClick={() => onUse({ left: k.left, right: k.right })}>
            Use
          </button>
        </div>
      ))}
    </div>
  );
}

/** Append: schema compatibility and explicit column mapping. Suggestions are shown, never applied silently. */
function AppendEditor({ step, onChange, before, other, picker, otherName }: { step: Extract<Step, { type: "append" }>; onChange: (s: Step) => void; before?: Dataset; other?: Dataset; picker: React.ReactNode; otherName: string }) {
  const schema = useMemo(() => (before && other ? appendSchema(before, other, step.mapping) : null), [before, other, step.mapping]);
  const setMap = (from: string, to: string) => {
    const mapping = { ...(step.mapping ?? {}) };
    if (to) mapping[from] = to;
    else delete mapping[from];
    onChange({ ...step, mapping: Object.keys(mapping).length ? mapping : undefined });
  };
  const used = new Set(Object.values(step.mapping ?? {}));
  return (
    <div className="col" style={{ gap: 12 }}>
      {picker}
      {schema && other && before && (
        <>
          <div className="label">Schema mapping</div>
          <table className="table compact schema-map">
            <thead>
              <tr>
                <th>Pipeline column</th>
                <th aria-label="from" />
                <th>{otherName}</th>
              </tr>
            </thead>
            <tbody>
              {other.columns.map((from) => {
                const m = schema.matched.find((x) => x.from === from);
                const target = step.mapping?.[from] ?? (before.columns.includes(from) ? from : "");
                const suggestion = schema.suggestions.find((x) => x.from === from);
                return (
                  <tr key={from}>
                    <td>
                      <select className="select sm" value={target} onChange={(e) => setMap(from, e.target.value === from && before.columns.includes(from) ? "" : e.target.value)} aria-label={`Map ${from}`}>
                        <option value="">Add as a new column</option>
                        {before.columns.map((c) => (
                          <option key={c} value={c} disabled={c !== target && (used.has(c) || (c !== from && schema.matched.some((x) => x.target === c && !x.mapped)))}>
                            {c}
                          </option>
                        ))}
                      </select>
                      {m?.conflict && <div className="hint amber">Type conflict: {m.conflict.target} and {m.conflict.from}</div>}
                    </td>
                    <td className="subtle">&larr;</td>
                    <td>
                      <span className="mono">{from}</span>
                      {suggestion && !m && (
                        <div className="hint">
                          Maybe {suggestion.target}?{" "}
                          <button className="link" onClick={() => setMap(from, suggestion.target)}>
                            Map it
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="callout">
            <Info size={16} />
            <div className="small">
              {schema.matched.length} matched{schema.missing.length ? `, ${schema.missing.length} pipeline column${schema.missing.length === 1 ? "" : "s"} left blank for appended rows (${schema.missing.slice(0, 4).join(", ")}${schema.missing.length > 4 ? ", ..." : ""})` : ""}
              {schema.additional.length ? `, ${schema.additional.length} added as new column${schema.additional.length === 1 ? "" : "s"}` : ""}. Appended rows get new row numbers.
            </div>
          </div>
          {schema.invalid.length > 0 && <div className="callout red small">{schema.invalid.join(". ")}</div>}
        </>
      )}
      <DocLink page="combine-append" />
    </div>
  );
}
