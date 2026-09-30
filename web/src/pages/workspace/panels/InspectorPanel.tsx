import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2, AlertTriangle, XCircle, Pencil, Trash2, CalendarDays, DollarSign, Hash, ScanText, Mail, ChevronRight, Copy,
  Info, Upload, Crosshair, SlidersHorizontal, Eye, Database, FileSpreadsheet, Type,
} from "lucide-react";
import type { Dataset, Destination, Step } from "@/engine/types";
import { describeStep, STAGE_OF, stepColumns, stepTitle, TRANSFORMS } from "@/engine/registry";
import { colLetter, detectRegion } from "@/engine/load";
import { observations, profileColumn, profileDataset, type ColumnProfile } from "@/engine/profile";
import { generateStep } from "@/codegen/python";
import { CodeView } from "@/components/CodeView";
import { Modal, Seg } from "@/components/ui";
import { useApp } from "@/store/app";
import { ACCEPT, parseFile } from "@/parsers";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import { copyText, fmtBytes, fmtInt, fmtPct } from "@/lib/format";
import { useWs, SOURCE } from "../context";
import { PanelFrame } from "./PanelFrame";
import { StepForm } from "../editors/StepEditor";
import { ExtractEditor } from "../editors/ExtractEditor";
import { ValidateEditor } from "../editors/ValidateEditor";
import { BeforeAfterTable } from "./BeforeAfterPanel";

export function InspectorPanel() {
  const ws = useWs();
  let title = "Step Inspector";
  let body: React.ReactNode;
  if (ws.draft) {
    title = ws.draft.isNew ? "New transformation" : "Edit step";
    body = <DraftEditor />;
  } else if (ws.column) {
    title = "Column details";
    body = <ColumnInspector column={ws.column} />;
  } else if (ws.sel === SOURCE) {
    title = "Source";
    body = <SourceInspector />;
  } else if (ws.isLoad) {
    title = "Load";
    body = <LoadInspector />;
  } else {
    body = <StepSummary index={ws.sel} />;
  }
  return (
    <PanelFrame id="inspector" title={title} pad>
      {body}
    </PanelFrame>
  );
}

function DraftEditor() {
  const ws = useWs();
  const d = ws.draft!;
  const before = ws.datasetBefore(d.index);
  const res = ws.preview.result?.steps[d.index];
  const [showAll, setShowAll] = useState(false);
  const meta = TRANSFORMS.find((t) => t.type === d.step.type);
  const results = ws.preview.result?.ruleResults ?? [];
  const onChange = (s: Step) => ws.updateDraft(s);
  let form: React.ReactNode;
  if (d.step.type === "extract" || d.step.type === "extract_kv" || d.step.type === "split") form = <ExtractEditor step={d.step} onChange={onChange} before={before} />;
  else if (d.step.type === "validate") form = <ValidateEditor step={d.step} onChange={onChange} before={before} results={results} />;
  else form = <StepForm step={d.step} onChange={onChange} before={before} />;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div>
        <div className="row">
          <h2 style={{ fontSize: 16 }} className="grow">
            {stepTitle(d.step)}
          </h2>
          <span className="badge">{STAGE_OF[d.step.type]}</span>
        </div>
        <div className="muted small">{meta?.description}</div>
      </div>
      <div className="field">
        <label>Step label (optional)</label>
        <input className="input sm" placeholder={describeStep(d.step).title} value={d.step.label ?? ""} onChange={(e) => onChange({ ...d.step, label: e.target.value || undefined })} />
      </div>
      {form}
      <div className="hr" style={{ margin: "4px 0" }} />
      <div className="section-title">Preview changes {ws.preview.sampled && <span className="badge sm">sample</span>}</div>
      {res?.error ? (
        <div className="callout red">
          <XCircle size={16} />
          {res.error}
        </div>
      ) : res ? (
        <>
          <div className="grid-3" style={{ gap: 8 }}>
            <MiniStat k="Rows" v={`${fmtInt(res.rowsIn)} → ${fmtInt(res.rowsOut)}`} />
            <MiniStat k="Cells changed" v={fmtInt(res.changedCells)} />
            <MiniStat k="Flagged" v={fmtInt(res.issues)} tone={res.issues ? "amber" : undefined} />
          </div>
          <div className={`callout ${res.issues ? "amber" : "green"}`}>
            {res.issues ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <div>
              <b>{fmtInt(res.rowsOut)} rows affected</b>
              <div className="small">{res.issues ? `${fmtInt(res.issues)} values could not be converted and will go to review` : "0 conversion failures"}</div>
            </div>
          </div>
        </>
      ) : null}
      <div className="row">
        <button className="btn block" onClick={() => setShowAll(true)}>
          <Eye size={15} /> Preview all rows
        </button>
        <button className="btn primary block" onClick={ws.applyDraft} disabled={!!res?.error}>
          {d.isNew ? "Apply transformation" : "Save changes"}
        </button>
      </div>
      <button className="btn ghost sm" onClick={ws.discardDraft}>
        Cancel
      </button>
      {showAll && (
        <Modal title={`Before / After — ${stepTitle(d.step)}`} size="xl" onClose={() => setShowAll(false)}>
          <div style={{ height: "62vh" }}>
            <BeforeAfterTable index={d.index} initialView="all" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function MiniStat({ k, v, tone }: { k: string; v: string; tone?: "amber" }) {
  return (
    <div className="card" style={{ padding: "8px 10px" }}>
      <div className="tiny muted">{k}</div>
      <div className="num" style={{ fontWeight: 700, color: tone === "amber" ? "var(--amber-text)" : "var(--ink)" }}>
        {v}
      </div>
    </div>
  );
}

function StepSummary({ index }: { index: number }) {
  const ws = useWs();
  const step = ws.spec.steps[index];
  const res = ws.preview.result?.steps[index];
  const code = useMemo(() => (step ? generateStep(step, index) : ""), [step, index]);
  if (!step) return <div className="muted">Select a step.</div>;
  const issues = ws.issuesFor(step.id);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div>
        <div className="row">
          <span className="badge blue">{String(index + 2).padStart(2, "0")}</span>
          <h2 style={{ fontSize: 16 }} className="grow">
            {stepTitle(step)}
          </h2>
        </div>
        <div className="muted small" style={{ marginTop: 4 }}>
          {describeStep(step).detail}
        </div>
      </div>
      <div className="kv">
        <div>Stage</div>
        <div>{STAGE_OF[step.type]}</div>
        <div>Affects</div>
        <div>{stepColumns(step).join(", ") || "—"}</div>
        <div>Position</div>
        <div>
          Step {index + 2} of {ws.spec.steps.length + 2} (after Source)
        </div>
        {res && (
          <>
            <div>Rows</div>
            <div className="num">
              {fmtInt(res.rowsIn)} → {fmtInt(res.rowsOut)}
            </div>
            <div>Changes</div>
            <div>{res.summary}</div>
          </>
        )}
      </div>
      {res?.error && (
        <div className="callout red">
          <XCircle size={16} /> {res.error}
        </div>
      )}
      {issues.length > 0 && (
        <div className="callout amber">
          <AlertTriangle size={16} />
          <div>
            <b>{fmtInt(issues.length)} values flagged</b> in the preview.
            <div className="small">e.g. {issues[0].message}</div>
          </div>
        </div>
      )}
      <div className="row">
        <button className="btn primary grow" onClick={() => ws.editStep(index)}>
          <Pencil size={14} /> Edit step
        </button>
        <button className="btn danger" onClick={() => ws.removeStep(index)} aria-label="Delete step">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="section-title">
        Generated Python
        <button className="btn ghost xs" style={{ marginLeft: "auto" }} onClick={() => copyText(code).then(() => useApp.getState().toast("success", "Copied step code"))}>
          <Copy size={12} /> Copy
        </button>
      </div>
      <div className="card" style={{ overflow: "auto", maxHeight: 320 }}>
        <CodeView code={code} />
      </div>
    </div>
  );
}

const PATTERN_ICON: Record<string, React.ReactNode> = {
  invoice_id: <ScanText size={16} />,
  date: <CalendarDays size={16} />,
  currency: <DollarSign size={16} />,
  email: <Mail size={16} />,
  key_value: <SlidersHorizontal size={16} />,
};

function ColumnInspector({ column }: { column: string }) {
  const ws = useWs();
  const ds = ws.datasetAfter(Math.min(ws.sel, ws.effective.steps.length));
  const p = useMemo(() => {
    if (!ds) return undefined;
    const i = ds.columns.indexOf(column);
    return i >= 0 ? profileColumn(ds, i) : undefined;
  }, [ds, column]);
  if (!p || !ds) return <div className="muted">Column “{column}” is not present at this step.</div>;
  const suggestions = suggestionsFor(p);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <div className="icon-wrap" style={{ width: 40, height: 40, borderRadius: 8, background: "var(--grey-bg)", display: "grid", placeItems: "center", fontWeight: 700, color: "var(--muted)" }}>
          {p.type === "number" ? <Hash size={18} /> : p.type === "date" ? <CalendarDays size={18} /> : <Type size={18} />}
        </div>
        <div className="grow">
          <h2 style={{ fontSize: 16 }}>{column}</h2>
          <div className="small muted">Column {ds.columns.indexOf(column) + 1}</div>
        </div>
        <button className="btn ghost sm" onClick={() => ws.setColumn(null)}>
          Close
        </button>
      </div>
      <div className="kv">
        <div>Type</div>
        <div style={{ textTransform: "capitalize" }}>{p.type}</div>
        <div>Filled</div>
        <div className="num">
          {fmtPct(p.filled, p.total)} ({fmtInt(p.filled)} / {fmtInt(p.total)})
        </div>
        <div>Unique</div>
        <div className="num">{fmtInt(p.unique)}</div>
        <div>Empty</div>
        <div className="num">{fmtInt(p.blank)}</div>
        {p.numericMin !== undefined && (
          <>
            <div>Min / Max</div>
            <div className="num">
              {p.numericMin.toLocaleString()} / {p.numericMax!.toLocaleString()}
            </div>
          </>
        )}
      </div>
      {p.examples[0] && (
        <div>
          <div className="label" style={{ marginBottom: 4 }}>
            Example
          </div>
          <div className="card mono small" style={{ padding: 8, background: "var(--surface-2)", wordBreak: "break-word" }}>
            {p.examples[0]}
          </div>
        </div>
      )}
      {(p.patterns.length > 0 || p.dateFormats.length > 0) && (
        <div>
          <div className="section-title">Detected patterns</div>
          <div className="col" style={{ gap: 8 }}>
            {p.patterns.map((x) => (
              <div key={x.id} className="row">
                <div style={{ width: 30, height: 30, borderRadius: 7, background: "var(--green-bg)", color: "var(--green-text)", display: "grid", placeItems: "center" }}>{PATTERN_ICON[x.id]}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{x.label}</div>
                  <div className="small muted">e.g. {x.example}</div>
                </div>
              </div>
            ))}
            {p.dateFormats.length > 0 && (
              <div className="row">
                <div style={{ width: 30, height: 30, borderRadius: 7, background: "var(--blue-50)", color: "var(--blue)", display: "grid", placeItems: "center" }}>
                  <CalendarDays size={16} />
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>Date formats ({p.dateFormats.length})</div>
                  <div className="small muted">e.g. {p.dateFormats.map((d) => d.example).join(", ")}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {p.top.length > 0 && p.unique <= 12 && (
        <div>
          <div className="section-title">Values</div>
          {p.top.map((t) => (
            <div key={t.value} className="row small" style={{ gap: 8, marginBottom: 4 }}>
              <span className="ellipsis" style={{ width: 90 }}>
                {t.value}
              </span>
              <div className="grow">
                <div className="bar blue">
                  <span style={{ width: `${(t.count / p.filled) * 100}%` }} />
                </div>
              </div>
              <span className="num muted" style={{ width: 44, textAlign: "right" }}>
                {fmtPct(t.count, p.filled, 0)}
              </span>
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div>
          <div className="section-title">Suggested actions</div>
          <div className="col" style={{ gap: 6 }}>
            {suggestions.map((s) => (
              <button key={s.type + s.title} className="option" style={{ padding: 10, textAlign: "left" }} onClick={() => ws.addStep(s.type, column)}>
                <div style={{ color: "var(--blue)" }}>{s.icon}</div>
                <div className="grow">
                  <div className="t">{s.title}</div>
                  <div className="d">{s.detail}</div>
                </div>
                <ChevronRight size={15} color="var(--subtle)" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function suggestionsFor(p: ColumnProfile): { type: Step["type"]; title: string; detail: string; icon: React.ReactNode }[] {
  const out: { type: Step["type"]; title: string; detail: string; icon: React.ReactNode }[] = [];
  const pat = p.patterns.map((x) => x.id);
  if (pat.length >= 2 || (pat.length && p.type === "text" && (p.examples[0]?.length ?? 0) > 20))
    out.push({ type: "extract", title: "Extract structured fields", detail: `Extract ${p.patterns.map((x) => x.label.toLowerCase()).join(", ")}`, icon: <ScanText size={18} /> });
  if (pat.includes("key_value")) out.push({ type: "extract_kv", title: "Parse key-value pairs", detail: "Turn key: value text into columns", icon: <SlidersHorizontal size={18} /> });
  if (p.dateFormats.length > 0 && p.type === "date") out.push({ type: "standardise_date", title: "Standardise date", detail: "Convert to a consistent date format", icon: <CalendarDays size={18} /> });
  if (p.moneyLike > 0 || p.type === "mixed" || (p.type === "number" && p.moneyLike)) out.push({ type: "convert_number", title: "Convert amount", detail: "Convert to number and standardise currency", icon: <DollarSign size={18} /> });
  if (p.paddedText > 0) out.push({ type: "trim", title: "Trim whitespace", detail: `${fmtInt(p.paddedText)} values have extra spaces`, icon: <Type size={18} /> });
  if (p.caseVariants > 0) out.push({ type: "change_case", title: "Standardise case", detail: `${p.caseVariants} values differ only by case`, icon: <Type size={18} /> });
  if (p.blank > 0) out.push({ type: "fill_blanks", title: "Fill blanks", detail: `${fmtInt(p.blank)} empty values`, icon: <SlidersHorizontal size={18} /> });
  return out.slice(0, 4);
}

function SourceInspector() {
  const ws = useWs();
  const src = ws.spec.source;
  const { file } = useSourceFile(src?.fileId);
  const sheet = sheetOf(file, src?.sheet);
  const input = ws.preview.result?.input;
  const detection = useMemo(() => (sheet ? detectRegion(sheet) : null), [sheet]);
  const obs = useMemo(() => (input ? observations(input, profileDataset(input)) : []), [input]);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);
  if (!src || !file || !sheet)
    return (
      <div className="muted">
        <FileSpreadsheet size={18} /> Loading source…
      </div>
    );
  const width = sheet.cells.reduce((m, r) => Math.max(m, r.length), 0);
  const isDetected = detection && detection.headerRow === src.headerRow && detection.startCol === src.startCol && detection.endCol === src.endCol;

  const replace = async (f: File) => {
    try {
      const parsed = await parseFile(f);
      const meta = await useApp.getState().addSource(parsed.source);
      const sh = parsed.source.sheets.find((s) => s.name === src.sheet) ?? parsed.source.sheets[0];
      const r = detectRegion(sh);
      ws.update((s) => ({ ...s, source: { ...s.source!, type: parsed.source.kind, file: meta.name, fileId: meta.id, sheet: parsed.source.kind === "excel" ? sh.name : undefined, headerRow: r.headerRow, startCol: r.startCol, endCol: r.endCol, csvDelimiter: parsed.source.delimiter } }));
      toast("success", `Source replaced with ${meta.name}. The original file is kept unchanged.`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <div className={`file-ic ${file.kind}`}>{file.kind === "excel" ? "XLS" : file.kind.toUpperCase().slice(0, 4)}</div>
        <div className="grow">
          <h2 style={{ fontSize: 15 }}>{file.name}</h2>
          <div className="small muted">
            {fmtBytes(file.size)} · imported {new Date(file.addedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div className="kv">
        <div>Type</div>
        <div>{{ excel: "Excel workbook", csv: "CSV", json: "JSON", jsonl: "JSON Lines", text: "Text" }[file.kind]}</div>
        {file.kind === "excel" && (
          <>
            <div>Sheets</div>
            <div>{file.sheets.length}</div>
          </>
        )}
        <div>Rows detected</div>
        <div className="num">{fmtInt(input?.rows.length ?? detection?.dataRows ?? 0)}</div>
        <div>Columns detected</div>
        <div>{src.endCol - src.startCol + 1}</div>
        <div>Header detected</div>
        <div>{detection && detection.headerRow >= 0 ? `Row ${detection.headerRow + 1}` : "None"}</div>
        <div>Data region</div>
        <div className="mono">
          {colLetter(src.startCol)}
          {src.headerRow + 2}:{colLetter(src.endCol)}
          {sheet.cells.length}
        </div>
        {detection && detection.mergedCells > 0 && (
          <>
            <div>Merged cells</div>
            <div>{detection.mergedCells} (outside the data region)</div>
          </>
        )}
      </div>

      <div>
        <div className="section-title">
          Quality observations
          <span title="Detection is advisory. Nothing changes until you apply a transformation or rule.">
            <Info size={13} color="var(--subtle)" />
          </span>
        </div>
        {obs.length === 0 && <div className="small muted">No issues detected in the preview sample.</div>}
        <div className="col" style={{ gap: 6 }}>
          {obs.slice(0, 6).map((o, i) => (
            <button key={i} className="option" style={{ padding: 10, textAlign: "left" }} onClick={() => o.column && ws.setColumn(o.column)}>
              {o.level === "warning" ? <AlertTriangle size={17} color="var(--amber)" /> : <Info size={17} color="var(--blue)" />}
              <div className="grow">
                <div className="t" style={{ fontSize: 12.5 }}>
                  {o.title}
                </div>
                <div className="d">{o.detail}</div>
              </div>
              <ChevronRight size={14} color="var(--subtle)" />
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title">Data region</div>
        <div className="grid-3" style={{ gap: 8 }}>
          <div className="field">
            <label className="tiny">Header row</label>
            <input
              className="input sm"
              type="number"
              min={0}
              value={src.headerRow + 1}
              onChange={(e) => ws.update((s) => ({ ...s, source: { ...s.source!, headerRow: Math.max(-1, Math.min(sheet.cells.length - 1, Number(e.target.value) - 1)) } }), "header")}
            />
          </div>
          <div className="field">
            <label className="tiny">First column</label>
            <select className="select sm" value={src.startCol} onChange={(e) => ws.update((s) => ({ ...s, source: { ...s.source!, startCol: Math.min(Number(e.target.value), s.source!.endCol) } }))}>
              {Array.from({ length: width }, (_, c) => (
                <option key={c} value={c}>
                  {colLetter(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="tiny">Last column</label>
            <select className="select sm" value={src.endCol} onChange={(e) => ws.update((s) => ({ ...s, source: { ...s.source!, endCol: Math.max(Number(e.target.value), s.source!.startCol) } }))}>
              {Array.from({ length: width }, (_, c) => (
                <option key={c} value={c}>
                  {colLetter(c)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          Header row 0 means the file has no header.
        </div>
      </div>
      <button
        className="btn primary"
        disabled={!!isDetected}
        onClick={() => detection && ws.update((s) => ({ ...s, source: { ...s.source!, headerRow: detection.headerRow, startCol: detection.startCol, endCol: detection.endCol } }))}
      >
        <Crosshair size={15} /> {isDetected ? "Using detected region" : "Use detected region"}
      </button>
      <button className="btn" onClick={() => inputRef.current?.click()}>
        <Upload size={15} /> Replace with a compatible file
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])} />
    </div>
  );
}

function LoadInspector() {
  const ws = useWs();
  const connections = useApp((s) => s.connections);
  const d: Destination = ws.spec.destination ?? { type: "file", format: "csv", path: "" };
  const set = (patch: Partial<Destination>) => ws.update((s) => ({ ...s, destination: { ...d, ...patch } }), "dest");
  const res = ws.preview.result;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <Database size={18} color="var(--blue)" />
        <h2 style={{ fontSize: 16 }}>Destination</h2>
      </div>
      {res && (
        <div className="grid-3" style={{ gap: 8 }}>
          <MiniStat k="To load" v={fmtInt(res.output.rows.length)} />
          <MiniStat k="Review" v={fmtInt(res.reviewRows.length)} tone={res.reviewRows.length ? "amber" : undefined} />
          <MiniStat k="Excluded" v={fmtInt(res.excludedRows.length)} />
        </div>
      )}
      <Seg value={d.type} onChange={(type) => set({ type })} options={[{ value: "file", label: "File" }, { value: "database", label: "Database" }]} />
      {d.type === "file" ? (
        <>
          <div className="field">
            <label>Format</label>
            <select className="select" value={d.format ?? "csv"} onChange={(e) => set({ format: e.target.value as Destination["format"] })}>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div className="field">
            <label>Output path (exported project)</label>
            <input className="input mono" placeholder={`output/${ws.spec.name.toLowerCase().replace(/\W+/g, "_")}.${d.format ?? "csv"}`} value={d.path ?? ""} onChange={(e) => set({ path: e.target.value })} />
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Connection</label>
            <select className="select" value={d.connectionId ?? ""} onChange={(e) => set({ connectionId: e.target.value })}>
              <option value="">Choose connection…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.envVar})
                </option>
              ))}
            </select>
            {connections.length === 0 && <div className="hint">Add a connection under Destinations first.</div>}
          </div>
          <div className="field">
            <label>Table</label>
            <input className="input mono" placeholder="warehouse.fact_invoices" value={d.table ?? ""} onChange={(e) => set({ table: e.target.value })} />
          </div>
          <div className="field">
            <label>If table exists</label>
            <Seg value={d.ifExists ?? "append"} onChange={(ifExists) => set({ ifExists })} options={[{ value: "append", label: "Append" }, { value: "replace", label: "Replace" }]} />
          </div>
          <div className="callout">
            <Info size={16} />
            <div>Credentials are never stored in FORMA or written into generated code. The exported project reads the connection URL from an environment variable.</div>
          </div>
        </>
      )}
      <div className="callout amber">
        <AlertTriangle size={16} />
        <div>Rows with unresolved review items are held back and never loaded silently.</div>
      </div>
    </div>
  );
}

export type { Dataset };
