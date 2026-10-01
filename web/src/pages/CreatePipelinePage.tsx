import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FileUp, FolderOpen, FileText, Info, Database, Network, Sheet, Cloud, Loader2, Sparkles } from "lucide-react";
import { useApp } from "@/store/app";
import { ACCEPT, parseFile } from "@/parsers";
import type { PresetId, SourceMeta } from "@/store/model";
import { PRESET_LABEL, PRESET_ORDER } from "@/store/layouts";
import { FileIcon } from "@/components/ui";
import { fmtAgo, fmtBytes, fmtInt } from "@/lib/format";
import { loadSampleSource } from "@/lib/samples";
import { ServerSourceModal, useServerHealth } from "@/components/server";
import { SheetChooser } from "@/components/SheetChooser";

export function CreatePipelinePage() {
  const nav = useNavigate();
  const sources = useApp((s) => s.sources);
  const connections = useApp((s) => s.connections);
  const settings = useApp((s) => s.settings);
  const { addSource, createPipeline, toast } = useApp.getState();
  const [name, setName] = useState("Untitled Pipeline");
  const [preset, setPreset] = useState<PresetId>(settings.defaultPreset);
  const [dest, setDest] = useState("later");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { health } = useServerHealth();
  const [serverSource, setServerSource] = useState(false);
  const [choose, setChoose] = useState<SourceMeta | null>(null);

  const destination = () => {
    if (dest === "later") return null;
    if (dest.startsWith("file:")) return { type: "file" as const, format: dest.slice(5) as "csv", path: "" };
    return { type: "database" as const, connectionId: dest.slice(3), table: "", ifExists: "append" as const };
  };

  const nameFor = (meta: SourceMeta, sheet?: string) => {
    const base =
      name.trim() === "Untitled Pipeline"
        ? meta.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : name.trim() || "Untitled Pipeline";
    return sheet ? `${base} – ${sheet}` : base;
  };

  const create = async (meta: SourceMeta, sheet?: string) => {
    setChoose(null);
    // Name the pipeline after its sheet unless it reads the workbook's first sheet.
    const p = await createPipeline(nameFor(meta, sheet && sheet !== meta.sheets[0]?.name ? sheet : undefined), meta, preset, destination(), sheet);
    nav(`/pipelines/${p.id}`);
  };

  const createEach = async (meta: SourceMeta, sheets: string[]) => {
    setChoose(null);
    for (const sh of sheets) await createPipeline(nameFor(meta, sh), meta, preset, destination(), sh);
    toast("success", `Created ${sheets.length} pipelines — one per sheet of ${meta.name}`);
    nav("/pipelines");
  };

  /** A workbook with several sheets asks which sheet to read; everything else starts straight away. */
  const start = async (meta: SourceMeta) => {
    if (meta.sheets.filter((s) => s.rows > 0).length > 1) setChoose(meta);
    else await create(meta);
  };

  const onFiles = async (files: FileList | File[]) => {
    const file = [...files][0];
    if (!file) return;
    setBusy(`Inspecting ${file.name}…`);
    try {
      const parsed = await parseFile(file);
      const meta = await addSource(parsed.source);
      await start(meta);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const useSample = async () => {
    setBusy("Loading sample…");
    try {
      await create(await loadSampleSource(), "Invoices");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/pipelines" className="row">
          <ArrowLeft size={15} />
        </Link>
        <span className="cur">New pipeline</span>
      </div>
      <div className="page-head">
        <div>
          <h1>Create pipeline</h1>
          <p>Start with the data you want to work with.</p>
        </div>
      </div>
      <div className="split wide-side">
        <div className="col" style={{ gap: 16 }}>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void onFiles(e.dataTransfer.files);
            }}
          >
            <div className="big-icon">{busy ? <Loader2 size={26} className="spin" /> : <FileUp size={26} />}</div>
            <h2 style={{ fontSize: 20 }}>{busy ?? "Drop files here"}</h2>
            <div className="muted">CSV · Excel · JSON · JSONL · Text</div>
            <div className="or">or</div>
            <div className="row">
              <button className="btn primary lg" onClick={() => inputRef.current?.click()} disabled={!!busy}>
                <FolderOpen size={17} /> Browse files
              </button>
              <button className="btn lg" onClick={useSample} disabled={!!busy}>
                <Sparkles size={16} /> Use sample invoices
              </button>
            </div>
            <div className="hint">Files stay in your browser. The original upload is never modified. Maximum 500 MB per file.</div>
            <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Recent sources</h3>
              <Link to="/sources" className="small">
                View all
              </Link>
            </div>
            {sources.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <FileText size={20} />
                No sources yet — uploaded files appear here for reuse.
              </div>
            ) : (
              <table className="table">
                <tbody>
                  {sources.slice(0, 5).map((s) => (
                    <tr key={s.id}>
                      <td style={{ width: 48 }}>
                        <FileIcon kind={s.kind} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{s.name}</div>
                        <div className="small muted">
                          {s.kind.toUpperCase()} · {s.sheets.length > 1 ? `${s.sheets.length} sheets` : `${fmtInt(s.sheets[0]?.rows ?? 0)} rows`} · {fmtBytes(s.size)} · Used{" "}
                          {fmtAgo(s.lastUsedAt)}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn sm" onClick={() => start(s)}>
                          Use this source
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 style={{ marginBottom: 10 }}>Other sources</h3>
            <div className="grid-4">
              {[
                { icon: <Database size={20} />, t: "Database", d: "PostgreSQL, MySQL, SQLite (SQL query)" },
                { icon: <Network size={20} />, t: "API", d: "JSON or CSV over HTTP" },
                { icon: <Sheet size={20} />, t: "Google Sheets", d: "Sheets shared by link" },
                { icon: <Cloud size={20} />, t: "Cloud storage", d: "Public or pre-signed file URL" },
              ].map((o) => (
                <button
                  key={o.t}
                  className={`option ${health ? "" : "disabled"}`}
                  style={{ textAlign: "left" }}
                  title={health ? undefined : "Connect a FORMA server in Settings to use this source"}
                  onClick={() => (health ? setServerSource(true) : nav("/settings"))}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--blue-50)", color: "var(--blue)", display: "grid", placeItems: "center", flex: "none" }}>{o.icon}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t">{o.t}</div>
                    <div className="d">{o.d}</div>
                  </div>
                  {!health && <span className="badge sm">Needs server</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card card-pad col" style={{ gap: 14 }}>
          <div className="row">
            <FileText size={18} color="var(--muted)" />
            <h3>Pipeline setup</h3>
          </div>
          <div className="field">
            <label htmlFor="pname">Name</label>
            <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          </div>
          <div className="field">
            <label htmlFor="pws">Workspace</label>
            <select id="pws" className="select" value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
              {PRESET_ORDER.filter((p) => p !== "custom").map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pdest">Destination</label>
            <select id="pdest" className="select" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="later">Choose later</option>
              <option value="file:csv">CSV file</option>
              <option value="file:xlsx">Excel file</option>
              <option value="file:json">JSON file</option>
              {connections.map((c) => (
                <option key={c.id} value={`db:${c.id}`}>
                  {c.name} (database)
                </option>
              ))}
            </select>
          </div>
          <div className="callout">
            <Info size={16} />
            You can change the source, workspace and destination later.
          </div>
        </div>
      </div>
      {choose && <SheetChooser meta={choose} onPick={(sh) => void create(choose, sh)} onEach={(sheets) => void createEach(choose, sheets)} onClose={() => setChoose(null)} />}
      {serverSource && <ServerSourceModal onClose={() => setServerSource(false)} onAdded={(meta) => void start(meta)} />}
    </div>
  );
}
