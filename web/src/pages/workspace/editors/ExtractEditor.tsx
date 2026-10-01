import { useMemo, useState, type ReactNode } from "react";
import { Trash2, Plus, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Wand2, ArrowRight, Info, Loader2 } from "lucide-react";
import { useServerHealth } from "@/components/server";
import { serverClient, useApp } from "@/store/app";
import type { Cell, Dataset, ExtractField, Step } from "@/engine/types";
import { ANY_DATE_FORMATS, compileRegex, extractValue } from "@/engine/execute";
import { formatDate, parseDate, parseMoney, toText } from "@/engine/values";
import { newId } from "@/engine/registry";
import { suggestExtractFields, suggestKvKeys } from "@/lib/stepDefaults";
import { Seg } from "@/components/ui";
import { fmtInt, fmtPct } from "@/lib/format";
import { ColumnSelect, NameList } from "./StepEditor";

type ExtractStep = Extract<Step, { type: "extract" | "extract_kv" | "split" }>;

const PRESETS: { label: string; pattern: string; type: ExtractField["type"] }[] = [
  { label: "Invoice ID (INV-123)", pattern: "INV-?\\d+", type: "text" },
  { label: "Date (dd/mm/yyyy, yyyy-mm-dd…)", pattern: "(\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}-\\d{1,2}-\\d{4})", type: "date" },
  { label: "Currency amount (RM, $, USD)", pattern: "(?:RM|USD|MYR|\\$)\\s*(-?[\\d,.]+\\w*)", type: "number" },
  { label: "Email address", pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.-]+", type: "text" },
  { label: "Number", pattern: "(-?\\d+(?:\\.\\d+)?)", type: "number" },
  { label: "Text after “Label:”", pattern: "Label:\\s*([^,;|]+)", type: "text" },
];

const COLORS = ["m0", "m1", "m2", "m3"];
const DOT = ["var(--blue)", "var(--green)", "var(--amber)", "var(--purple)"];

function fieldValue(text: string | null, f: ExtractField): { raw: string | null; value: Cell; ok: boolean } {
  let raw: string | null;
  try {
    raw = f.pattern ? extractValue(text, f.pattern, f.ignoreCase) : null;
  } catch {
    return { raw: null, value: null, ok: false };
  }
  if (raw === null) return { raw, value: null, ok: false };
  if (f.type === "number") {
    const n = parseMoney(raw);
    return { raw, value: n, ok: n !== null };
  }
  if (f.type === "date") {
    const d = parseDate(raw, ANY_DATE_FORMATS);
    return { raw, value: d ? formatDate(d, "YYYY-MM-DD") : null, ok: !!d };
  }
  return { raw, value: raw, ok: true };
}

function highlight(text: string, fields: ExtractField[]): ReactNode {
  const spans: { s: number; e: number; k: number }[] = [];
  fields.forEach((f, k) => {
    if (!f.pattern) return;
    try {
      const re = compileRegex(f.pattern, f.ignoreCase ? "di" : "d");
      const m = re.exec(text) as (RegExpExecArray & { indices?: [number, number][] }) | null;
      if (!m) return;
      const [s, e] = m.indices?.[1] ?? m.indices?.[0] ?? [m.index, m.index + m[0].length];
      if (s !== undefined) spans.push({ s, e, k });
    } catch {
      /* invalid pattern */
    }
  });
  spans.sort((a, b) => a.s - b.s);
  const out: ReactNode[] = [];
  let at = 0;
  for (const sp of spans) {
    if (sp.s < at) continue;
    out.push(text.slice(at, sp.s));
    out.push(
      <mark key={sp.s} className={COLORS[sp.k % 4]}>
        {text.slice(sp.s, sp.e)}
      </mark>,
    );
    at = sp.e;
  }
  out.push(text.slice(at));
  return out;
}

export function ExtractEditor({ step, onChange, before }: { step: ExtractStep; onChange: (s: Step) => void; before?: Dataset }) {
  const [rowAt, setRowAt] = useState(0);
  const [showFailed, setShowFailed] = useState(false);
  const { health } = useServerHealth();
  const toast = useApp((s) => s.toast);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const colIdx = before?.columns.indexOf(step.column) ?? -1;
  const texts = useMemo(() => (before && colIdx >= 0 ? before.rows.map((r) => toText(r[colIdx])) : []), [before, colIdx]);

  const method = step.type === "extract" ? "pattern" : step.type === "extract_kv" ? "kv" : "split";
  const switchMethod = (m: string) => {
    if (m === method) return;
    const base = { id: step.id, label: step.label, column: step.column };
    if (m === "pattern") onChange({ ...base, type: "extract", method: "pattern", fields: before ? suggestExtractFields(before, step.column) : [] });
    else if (m === "kv") onChange({ ...base, type: "extract_kv", pairSeparator: ";", kvSeparator: ":", keys: before ? suggestKvKeys(before, step.column, ";", ":") : [] });
    else onChange({ ...base, type: "split", delimiter: ",", into: [`${step.column.toLowerCase()}_1`, `${step.column.toLowerCase()}_2`] });
  };

  const stats = useMemo(() => {
    if (step.type !== "extract") return null;
    const perField = step.fields.map(() => 0);
    const failed: number[] = [];
    texts.forEach((t, r) => {
      let all = true;
      step.fields.forEach((f, k) => {
        if (fieldValue(t, f).ok) perField[k]++;
        else all = false;
      });
      if (!all) failed.push(r);
    });
    return { perField, failed };
  }, [step, texts]);

  const current = texts[Math.min(rowAt, texts.length - 1)] ?? null;
  const setField = (k: number, f: Partial<ExtractField>) => step.type === "extract" && onChange({ ...step, fields: step.fields.map((x, i) => (i === k ? { ...x, ...f } : x)) });

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="field">
        <label>Source column</label>
        <ColumnSelect ds={before} value={step.column} onChange={(column) => onChange({ ...step, column })} />
      </div>
      <div className="field">
        <label>Method</label>
        <Seg
          value={method}
          onChange={switchMethod}
          options={[
            { value: "pattern", label: "Pattern" },
            { value: "kv", label: "Key-value" },
            { value: "split", label: "Split" },
          ]}
        />
      </div>

      {step.type === "extract" && (
        <>
          <div className="row">
            <span className="label grow">Fields</span>
            {health?.features.ai && (
              <button className="btn xs soft" disabled={aiBusy} title="Ask Claude (via your FORMA server) to propose patterns. You review them before applying." onClick={async () => {
                const hint = window.prompt("What should be extracted? (optional — e.g. invoice number, due date and total)") ?? undefined;
                setAiBusy(true);
                try {
                  const failing = stats ? stats.failed.map((r) => texts[r]).filter(Boolean) : [];
                  const samples = [...new Set([...failing.slice(0, 20), ...texts.filter(Boolean).slice(0, 60)])].slice(0, 60) as string[];
                  const r = await serverClient()!.suggestPatterns(samples, hint || undefined);
                  onChange({ ...step, fields: r.fields.map((f) => ({ name: f.name, type: f.type, pattern: f.pattern })) });
                  setAiNote(`AI suggestion: ${r.fields.length} pattern${r.fields.length === 1 ? "" : "s"} (shown below with match rates on the preview). Nothing changes until you apply; the step runs as plain regex.`);
                } catch (e) {
                  toast("error", (e as Error).message);
                } finally {
                  setAiBusy(false);
                }
              }}>
                {aiBusy && <Loader2 size={12} className="spin" />} Suggest with AI
              </button>
            )}
            <button
              className="btn xs"
              title="Infer fields from detected patterns (deterministic; no data leaves your browser)"
              onClick={() => before && onChange({ ...step, fields: suggestExtractFields(before, step.column).length ? suggestExtractFields(before, step.column) : step.fields })}
            >
              <Wand2 size={12} /> Suggest fields
            </button>
          </div>
          {aiNote && (
            <div className="callout small" style={{ padding: "8px 10px" }}>
              <Info size={14} /> {aiNote}
            </div>
          )}
          {step.fields.map((f, k) => {
            let bad = false;
            try {
              if (f.pattern) new RegExp(f.pattern);
            } catch {
              bad = true;
            }
            const rate = stats && texts.length ? stats.perField[k] / texts.length : 0;
            return (
              <div key={k} className="card" style={{ padding: 8, display: "grid", gap: 6 }}>
                <div className="row">
                  <span className="dot" style={{ background: DOT[k % 4] }} />
                  <input className="input sm" style={{ flex: 1.2 }} value={f.name} aria-label="Field name" onChange={(e) => setField(k, { name: e.target.value.replace(/\s+/g, "_") })} />
                  <select className="select sm" style={{ width: 92 }} value={f.type} aria-label="Output type" onChange={(e) => setField(k, { type: e.target.value as ExtractField["type"] })}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>
                  <span className="num small" style={{ width: 48, textAlign: "right", fontWeight: 650, color: rate >= 0.95 ? "var(--green-text)" : rate >= 0.8 ? "var(--amber-text)" : "var(--red-text)" }}>
                    {fmtPct(stats?.perField[k] ?? 0, texts.length)}
                  </span>
                  <button className="btn ghost xs icon" aria-label={`Remove ${f.name}`} onClick={() => onChange({ ...step, fields: step.fields.filter((_, i) => i !== k) })}>
                    <Trash2 size={13} color="var(--red)" />
                  </button>
                </div>
                <div className="row">
                  <input className={`input sm mono ${bad ? "invalid" : ""}`} value={f.pattern} placeholder="Regular expression (group 1 is used when present)" aria-label="Pattern" onChange={(e) => setField(k, { pattern: e.target.value })} />
                  <select className="select sm" style={{ width: 30, paddingRight: 18 }} value="" aria-label="Pattern presets" onChange={(e) => {
                    const p = PRESETS[Number(e.target.value)];
                    if (p) setField(k, { pattern: p.pattern, type: p.type });
                  }}>
                    <option value="">Presets…</option>
                    {PRESETS.map((p, i) => (
                      <option key={p.label} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ ...step, fields: [...step.fields, { name: `field_${step.fields.length + 1}`, type: "text", pattern: "" }] })}>
            <Plus size={13} /> Add field
          </button>
        </>
      )}

      {step.type === "extract_kv" && (
        <>
          <div className="row">
            <div className="field grow">
              <label>Pair separator</label>
              <input className="input mono" value={step.pairSeparator} onChange={(e) => onChange({ ...step, pairSeparator: e.target.value })} />
            </div>
            <div className="field grow">
              <label>Key/value separator</label>
              <input className="input mono" value={step.kvSeparator} onChange={(e) => onChange({ ...step, kvSeparator: e.target.value })} />
            </div>
          </div>
          <div className="row">
            <span className="label grow">Keys → columns</span>
            <button className="btn xs" onClick={() => before && onChange({ ...step, keys: suggestKvKeys(before, step.column, step.pairSeparator, step.kvSeparator) })}>
              <Wand2 size={12} /> Detect keys
            </button>
          </div>
          {step.keys.map((k, i) => (
            <div key={i} className="row">
              <input className="input sm" value={k.key} aria-label="Key" onChange={(e) => onChange({ ...step, keys: step.keys.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
              <ArrowRight size={13} color="var(--subtle)" style={{ flex: "none" }} />
              <input className="input sm" value={k.name} aria-label="Column name" onChange={(e) => onChange({ ...step, keys: step.keys.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <button className="btn ghost xs icon" aria-label="Remove key" onClick={() => onChange({ ...step, keys: step.keys.filter((_, j) => j !== i) })}>
                <Trash2 size={13} color="var(--red)" />
              </button>
            </div>
          ))}
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ ...step, keys: [...step.keys, { key: "", name: `key_${step.keys.length + 1}` }] })}>
            <Plus size={13} /> Add key
          </button>
        </>
      )}

      {step.type === "split" && (
        <>
          <div className="field">
            <label>Delimiter</label>
            <input className="input mono" value={step.delimiter} onChange={(e) => onChange({ ...step, delimiter: e.target.value })} />
          </div>
          <div className="field">
            <label>Into columns</label>
            <NameList names={step.into} onChange={(into) => onChange({ ...step, into })} />
          </div>
        </>
      )}

      {step.type === "extract" && texts.length > 0 && (
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="label grow">
              Preview <span className="muted">(row {before?.rowIds[rowAt]})</span>
            </span>
            <button className="btn ghost xs icon" aria-label="Previous row" disabled={rowAt === 0} onClick={() => setRowAt((r) => r - 1)}>
              <ChevronLeft size={14} />
            </button>
            <button className="btn ghost xs icon" aria-label="Next row" disabled={rowAt >= texts.length - 1} onClick={() => setRowAt((r) => r + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="card mono" style={{ padding: 10, fontSize: 12, lineHeight: 1.7, background: "var(--surface-2)" }}>
            {current ? highlight(current, step.fields) : <span className="subtle">(blank)</span>}
          </div>
          <table className="table compact" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {step.fields.map((f, k) => {
                const r = fieldValue(current, f);
                return (
                  <tr key={k}>
                    <td>
                      <span className="row">
                        <span className="dot" style={{ background: DOT[k % 4] }} />
                        {f.name}
                      </span>
                    </td>
                    <td className="mono" style={{ color: r.ok ? undefined : "var(--red-text)" }}>
                      {r.ok ? toText(r.value) : r.raw === null ? "Not detected" : `Invalid ${f.type}: ${r.raw}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {stats && texts.length > 0 && (
        <div className="card" style={{ padding: 10 }}>
          <div className="row" style={{ gap: 14 }}>
            <div className="row">
              <CheckCircle2 size={20} color="var(--green)" />
              <div>
                <b className="num">
                  {fmtInt(texts.length - stats.failed.length)} / {fmtInt(texts.length)}
                </b>{" "}
                rows matched
                <div className="small muted">{fmtPct(texts.length - stats.failed.length, texts.length)} success</div>
              </div>
            </div>
            {stats.failed.length > 0 && (
              <div className="row">
                <AlertTriangle size={20} color="var(--amber)" />
                <div>
                  <b className="num" style={{ color: "var(--amber-text)" }}>
                    {fmtInt(stats.failed.length)}
                  </b>{" "}
                  need review
                  <div className="small muted">Could not extract every field</div>
                </div>
              </div>
            )}
          </div>
          {stats.failed.length > 0 && (
            <>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setShowFailed((v) => !v)}>
                {showFailed ? "Hide" : "View"} failed rows
              </button>
              {showFailed && (
                <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>
                  <table className="table compact">
                    <tbody>
                      {stats.failed.slice(0, 200).map((r) => (
                        <tr key={r} className="clickable" onClick={() => setRowAt(r)}>
                          <td className="num subtle" style={{ width: 50 }}>
                            {before?.rowIds[r]}
                          </td>
                          <td className="mono small">{texts[r] ? highlight(texts[r]!, step.type === "extract" ? step.fields : []) : <span className="subtle">(blank)</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function newExtractField(): ExtractField {
  return { name: `field_${newId("f").slice(-3)}`, type: "text", pattern: "" };
}
