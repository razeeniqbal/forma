import { Fragment, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderInput, Upload, Eye, Download, Plus, Trash2, Loader2, MoreHorizontal, Database, Sheet, CornerDownRight } from "lucide-react";
import { ServerSourceModal, useServerHealth } from "@/components/server";
import { useApp } from "@/store/app";
import { getRawFile } from "@/store/db";
import { ACCEPT, parseFile } from "@/parsers";
import { confirmAction, Empty, FileIcon, Modal, useMenu } from "@/components/ui";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { colLetter } from "@/engine/load";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import { download, fmtAgo, fmtBytes, fmtInt } from "@/lib/format";
import type { SourceMeta } from "@/store/model";
import { SheetChooser } from "@/components/SheetChooser";

export function SourcesPage() {
  const sources = useApp((s) => s.sources);
  const pipelines = useApp((s) => s.pipelines);
  const { addSource, deleteSource, createPipeline, toast } = useApp.getState();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ meta: SourceMeta; sheet?: string } | null>(null);
  const [choose, setChoose] = useState<SourceMeta | null>(null);

  const newPipeline = async (s: SourceMeta, sheet?: string) => {
    setChoose(null);
    const base = s.name.replace(/\.[^.]+$/, "");
    const name = sheet && s.sheets.length > 1 ? `${base} – ${sheet}` : base;
    nav(`/pipelines/${(await createPipeline(name, s, useApp.getState().settings.defaultPreset, null, sheet)).id}`);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const menu = useMenu();
  const { health } = useServerHealth();
  const [serverSource, setServerSource] = useState(false);

  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of files) await addSource((await parseFile(f)).source);
      toast("success", `${files.length} source${files.length > 1 ? "s" : ""} added`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sources</h1>
          <p>Uploaded files are stored immutably in your browser. Pipelines derive new data; originals never change.</p>
        </div>
        <div className="actions">
          {health && (
            <button className="btn" onClick={() => setServerSource(true)}>
              <Database size={15} /> Database / API source
            </button>
          )}
          <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Upload files
          </button>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
      </div>
      <div className="card">
        {sources.length === 0 ? (
          <Empty icon={<FolderInput size={22} />} title="No sources yet">
            Upload CSV, Excel, JSON, JSONL or text files. Database, API and Google Sheets connectors are planned.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Sheets</th>
                <th style={{ textAlign: "right" }}>Rows</th>
                <th style={{ textAlign: "right" }}>Size</th>
                <th>Used by</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const used = pipelines.filter((p) => p.spec.source?.fileId === s.id);
                const multi = s.sheets.length > 1;
                return (
                  <Fragment key={s.id}>
                  <tr>
                    <td>
                      <div className="row">
                        <FileIcon kind={s.kind} />
                        <b style={{ color: "var(--ink)" }}>{s.name}</b>
                      </div>
                    </td>
                    <td className="muted">{s.kind.toUpperCase()}</td>
                    <td className="small">{multi ? `${s.sheets.length} sheets` : s.sheets[0]?.name}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {fmtInt(s.sheets.reduce((n, x) => n + x.rows, 0))}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {fmtBytes(s.size)}
                    </td>
                    <td className="small">{used.length ? used.map((p) => p.spec.name).join(", ") : <span className="subtle">—</span>}</td>
                    <td className="muted small">{fmtAgo(s.addedAt)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn sm" onClick={() => setPreview({ meta: s })}>
                        <Eye size={13} /> Preview
                      </button>{" "}
                      <button
                        className="btn ghost sm icon"
                        aria-label="More"
                        onClick={(e) =>
                          menu.open(e.currentTarget.getBoundingClientRect(), [
                            { label: "New pipeline from source", icon: <Plus size={15} />, onClick: () => (multi ? setChoose(s) : void newPipeline(s)) },
                            {
                              label: "Download original",
                              icon: <Download size={15} />,
                              onClick: async () => {
                                const raw = await getRawFile(s.id);
                                if (raw) download(s.name, raw, raw.type);
                                else toast("warning", "The original file bytes are not available for this source.");
                              },
                            },
                            { separator: true, label: "" },
                            {
                              label: "Delete",
                              icon: <Trash2 size={15} />,
                              danger: true,
                              onClick: async () => {
                                const ok = await confirmAction({
                                  title: "Delete source?",
                                  body: used.length ? `${used.length} pipeline(s) use this file and will need a new source before they can run.` : "The stored file will be removed from this browser.",
                                  confirmLabel: "Delete",
                                  danger: true,
                                });
                                if (ok) await deleteSource(s.id);
                              },
                            },
                          ])
                        }
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </td>
                  </tr>
                  {multi &&
                    s.sheets.map((sh) => {
                      const usedBy = used.filter((p) => (p.spec.source?.sheet ?? s.sheets[0].name) === sh.name);
                      return (
                        <tr key={sh.name} className="sub-row">
                          <td>
                            <div className="row" style={{ paddingLeft: 14 }}>
                              <CornerDownRight size={14} color="var(--subtle)" />
                              <Sheet size={15} color="var(--green-text)" />
                              <span style={{ color: "var(--ink)" }}>{sh.name}</span>
                            </div>
                          </td>
                          <td className="muted small">Sheet</td>
                          <td className="small muted">{sh.cols} columns</td>
                          <td className="num" style={{ textAlign: "right" }}>
                            {sh.rows ? fmtInt(sh.rows) : <span className="subtle">empty</span>}
                          </td>
                          <td />
                          <td className="small">{usedBy.length ? usedBy.map((p) => p.spec.name).join(", ") : <span className="subtle">—</span>}</td>
                          <td />
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <button className="btn ghost sm" onClick={() => setPreview({ meta: s, sheet: sh.name })}>
                              <Eye size={13} /> Preview
                            </button>{" "}
                            <button className="btn ghost sm" disabled={!sh.rows} onClick={() => void newPipeline(s, sh.name)} aria-label={`New pipeline from ${sh.name}`}>
                              <Plus size={13} /> New pipeline
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {preview && <SourcePreview meta={preview.meta} initialSheet={preview.sheet} onClose={() => setPreview(null)} />}
      {choose && <SheetChooser meta={choose} onPick={(sh) => void newPipeline(choose, sh)} onClose={() => setChoose(null)} />}
      {serverSource && <ServerSourceModal onClose={() => setServerSource(false)} onAdded={() => toast("success", "Source added")} />}
      {menu.node}
    </div>
  );
}

function SourcePreview({ meta, initialSheet, onClose }: { meta: SourceMeta; initialSheet?: string; onClose: () => void }) {
  const { file } = useSourceFile(meta.id);
  const [sheetName, setSheetName] = useState<string | undefined>(initialSheet);
  const sheet = sheetOf(file, sheetName);
  const width = sheet?.cells.reduce((m, r) => Math.max(m, r.length), 0) ?? 0;
  const cols: GridColumn[] = Array.from({ length: width }, (_, c) => ({ name: colLetter(c), width: 140 }));
  return (
    <Modal title={meta.name} size="xl" onClose={onClose}>
      {file && file.sheets.length > 1 && (
        <div className="tabs sm" style={{ marginBottom: 8 }}>
          {file.sheets.map((s) => (
            <button key={s.name} className={s.name === sheet?.name ? "on" : ""} onClick={() => setSheetName(s.name)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ height: "60vh", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {sheet ? <DataGrid columns={cols} rowCount={sheet.cells.length} getCell={(r, c) => sheet.cells[r][c] ?? null} /> : <div className="skeleton" style={{ height: "100%" }} />}
      </div>
    </Modal>
  );
}
