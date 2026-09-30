import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderInput, Upload, Eye, Download, Plus, Trash2, Loader2, MoreHorizontal, Database } from "lucide-react";
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

export function SourcesPage() {
  const sources = useApp((s) => s.sources);
  const pipelines = useApp((s) => s.pipelines);
  const { addSource, deleteSource, createPipeline, toast } = useApp.getState();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SourceMeta | null>(null);
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
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="row">
                        <FileIcon kind={s.kind} />
                        <b style={{ color: "var(--ink)" }}>{s.name}</b>
                      </div>
                    </td>
                    <td className="muted">{s.kind.toUpperCase()}</td>
                    <td className="small">{s.sheets.map((x) => x.name).join(", ")}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {fmtInt(s.sheets[0]?.rows ?? 0)}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {fmtBytes(s.size)}
                    </td>
                    <td className="small">{used.length ? used.map((p) => p.spec.name).join(", ") : <span className="subtle">—</span>}</td>
                    <td className="muted small">{fmtAgo(s.addedAt)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn sm" onClick={() => setPreview(s)}>
                        <Eye size={13} /> Preview
                      </button>{" "}
                      <button
                        className="btn ghost sm icon"
                        aria-label="More"
                        onClick={(e) =>
                          menu.open(e.currentTarget.getBoundingClientRect(), [
                            { label: "New pipeline from source", icon: <Plus size={15} />, onClick: async () => nav(`/pipelines/${(await createPipeline(s.name.replace(/\.[^.]+$/, ""), s, useApp.getState().settings.defaultPreset)).id}`) },
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {preview && <SourcePreview meta={preview} onClose={() => setPreview(null)} />}
      {serverSource && <ServerSourceModal onClose={() => setServerSource(false)} onAdded={() => toast("success", "Source added")} />}
      {menu.node}
    </div>
  );
}

function SourcePreview({ meta, onClose }: { meta: SourceMeta; onClose: () => void }) {
  const { file } = useSourceFile(meta.id);
  const [sheetName, setSheetName] = useState<string | undefined>();
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
