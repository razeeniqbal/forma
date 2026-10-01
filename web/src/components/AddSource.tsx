import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp, Database, Network, Loader2, FlaskConical } from "lucide-react";
import { useApp } from "@/store/app";
import { ACCEPT, parseFile } from "@/parsers";
import { ServerSourceModal, useServerHealth } from "@/components/server";
import { loadSampleFile } from "@/lib/samples";
import type { SourceMeta } from "@/store/model";

/** Adding data to a project: file upload, database / API through the FORMA server, or the sample files. */
export function useAddSource(projectId: string, onAdded: (metas: SourceMeta[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [server, setServer] = useState<"database" | "api" | null>(null);
  const { health } = useServerHealth();
  const toast = useApp((s) => s.toast);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    const added: SourceMeta[] = [];
    try {
      for (const f of list) {
        setBusy(`Reading ${f.name}…`);
        added.push(await useApp.getState().addSource((await parseFile(f)).source, projectId));
      }
      toast("success", added.length === 1 ? `Added ${added[0].name}` : `Added ${added.length} sources`);
      onAdded(added);
    } catch (e) {
      toast("error", (e as Error).message);
      if (added.length) onAdded(added);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const sample = async () => {
    setBusy("Loading sample data…");
    try {
      const a = await loadSampleFile("invoices.xlsx", projectId);
      const b = await loadSampleFile("customers.csv", projectId);
      onAdded([a, b]);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const node: ReactNode = (
    <>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden data-testid="source-file-input" onChange={(e) => e.target.files && upload(e.target.files)} />
      {server && <ServerSourceModal projectId={projectId} initialKind={server} onClose={() => setServer(null)} onAdded={(m) => onAdded([m])} />}
    </>
  );

  return { browse: () => inputRef.current?.click(), upload, sample, openServer: (k: "database" | "api") => setServer(k), serverReady: !!health, busy, node };
}

/** The three ways to bring data into a project, shown on an empty project and in Sources. */
export function AddSourceOptions({ add, compact }: { add: ReturnType<typeof useAddSource>; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const nav = useNavigate();
  const needs = !add.serverReady;
  // Without a server the options stay visible and lead to Settings, where one is connected.
  const server = (k: "database" | "api") => (needs ? nav("/settings") : add.openServer(k));
  return (
    <div className={`add-source ${compact ? "compact" : ""}`}>
      <button
        className={`add-option drop ${over ? "over" : ""}`}
        onClick={add.browse}
        disabled={!!add.busy}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add.upload(e.dataTransfer.files);
        }}
      >
        {add.busy ? <Loader2 size={18} className="spin" /> : <FileUp size={18} />}
        <span className="t">{add.busy ?? "Upload file"}</span>
        <span className="d">CSV · Excel · JSON · JSONL · Text, or drop files here</span>
      </button>
      <button className={`add-option ${needs ? "needs" : ""}`} onClick={() => server("database")} title={needs ? "Connect a FORMA server in Settings to read databases" : undefined}>
        <Database size={18} />
        <span className="t">Database</span>
        <span className="d">PostgreSQL, MySQL, SQLite (SQL query)</span>
        {needs && <ServerHint />}
      </button>
      <button className={`add-option ${needs ? "needs" : ""}`} onClick={() => server("api")} title={needs ? "Connect a FORMA server in Settings to read APIs" : undefined}>
        <Network size={18} />
        <span className="t">API</span>
        <span className="d">REST JSON / CSV, Google Sheets by link</span>
        {needs && <ServerHint />}
      </button>
      {!compact && (
        <button className="btn ghost sm add-sample" onClick={add.sample} disabled={!!add.busy}>
          <FlaskConical size={14} /> Explore with sample data
        </button>
      )}
    </div>
  );
}

function ServerHint() {
  return <span className="add-hint">Needs FORMA server · Settings</span>;
}
