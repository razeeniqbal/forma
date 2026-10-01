import { useEffect, useState } from "react";
import { create } from "zustand";
import { Database, Network, Loader2, Info } from "lucide-react";
import { useApp, serverClient } from "@/store/app";
import type { ServerHealth } from "@/lib/server";
import type { SourceFile, SourceOrigin } from "@/engine/types";
import { newId } from "@/engine/registry";
import type { SourceMeta } from "@/store/model";
import { DataGrid } from "@/components/DataGrid";
import { Modal, Seg } from "@/components/ui";
import { colLetter } from "@/engine/load";
import { fmtInt } from "@/lib/format";

const useHealthStore = create<{ url?: string; health?: ServerHealth; error?: string; checking: boolean }>(() => ({ checking: false }));

/** Cached server health for the configured server (null when no server is set). */
export function useServerHealth(): { configured: boolean; health?: ServerHealth; error?: string; checking: boolean; recheck: () => void } {
  const url = useApp((s) => s.settings.serverUrl);
  const token = useApp((s) => s.settings.serverToken);
  const st = useHealthStore();
  const recheck = () => {
    const server = serverClient();
    // Read the URL at call time: settings may have changed since this render.
    const current = useApp.getState().settings.serverUrl;
    if (!server || !current) return;
    useHealthStore.setState({ url: current, checking: true, error: undefined });
    server
      .health()
      .then((health) => useApp.getState().settings.serverUrl === current && useHealthStore.setState({ url: current, health, checking: false }))
      .catch((e) => useApp.getState().settings.serverUrl === current && useHealthStore.setState({ url: current, health: undefined, error: (e as Error).message, checking: false }));
  };
  useEffect(() => {
    if (url && st.url !== url) recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token]);
  return { configured: !!url, health: st.url === url ? st.health : undefined, error: st.url === url ? st.error : undefined, checking: st.checking, recheck };
}

/** Add a database query or API / Google Sheets source through the FORMA server. */
export function ServerSourceModal({ projectId, initialKind = "database", onClose, onAdded }: { projectId: string; initialKind?: "database" | "api"; onClose: () => void; onAdded: (meta: SourceMeta) => void }) {
  const connections = useApp((s) => s.connections);
  const addSource = useApp((s) => s.addSource);
  const [kind, setKind] = useState<"database" | "api">(initialKind);
  const [urlEnv, setUrlEnv] = useState(connections.find((c) => c.type !== "api")?.envVar ?? "WAREHOUSE_URL");
  const [query, setQuery] = useState("select * from invoices");
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [tokenEnv, setTokenEnv] = useState("");
  const [name, setName] = useState("");
  const [grid, setGrid] = useState<(string | number | boolean | null)[][] | null>(null);
  const [resolved, setResolved] = useState<{ url: string; format: "json" | "csv" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGrid = async () => {
    const server = serverClient();
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      const r =
        kind === "database"
          ? await server.querySource({ kind, url_env: urlEnv.trim(), query })
          : await server.querySource({ kind, url: url.trim(), format, ...(tokenEnv.trim() ? { token_env: tokenEnv.trim() } : {}) });
      setGrid(r.grid);
      setResolved(kind === "api" ? { url: r.url ?? url.trim(), format: r.format ?? format } : null);
    } catch (e) {
      setError((e as Error).message);
      setGrid(null);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!grid) return;
    const origin: SourceOrigin =
      kind === "database" ? { kind, urlEnv: urlEnv.trim(), query } : { kind, url: resolved?.url ?? url.trim(), format: resolved?.format ?? format, ...(tokenEnv.trim() ? { tokenEnv: tokenEnv.trim() } : {}) };
    const label = name.trim() || (kind === "database" ? `${urlEnv} query` : new URL(origin.kind === "api" ? origin.url : "http://x").hostname);
    const file: SourceFile = {
      id: newId("src"),
      name: label,
      kind,
      size: JSON.stringify(grid).length,
      addedAt: Date.now(),
      sheets: [{ name: kind === "database" ? "query" : "records", cells: grid }],
      origin,
    };
    onAdded(await addSource(file, projectId));
    onClose();
  };

  const width = grid?.[0]?.length ?? 0;
  return (
    <Modal
      title="Add a database or API source"
      size="xl"
      icon={kind === "database" ? <Database size={18} color="var(--blue)" /> : <Network size={18} color="var(--blue)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!grid} onClick={save}>
            Use this source
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Seg
          value={kind}
          onChange={(k) => {
            setKind(k);
            setGrid(null);
          }}
          options={[
            { value: "database", label: "Database (SQL)" },
            { value: "api", label: "API / URL / Google Sheets" },
          ]}
        />
        {kind === "database" ? (
          <>
            <div className="field">
              <label>Connection (environment variable on the server)</label>
              <input className="input mono" list="forma-conn-envs" value={urlEnv} onChange={(e) => setUrlEnv(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
              <datalist id="forma-conn-envs">
                {connections.map((c) => (
                  <option key={c.id} value={c.envVar}>
                    {c.name}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>SQL query</label>
              <textarea className="input mono" rows={4} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>URL</label>
              <input className="input mono" placeholder="https://api.example.com/orders  or a Google Sheets link" value={url} onChange={(e) => setUrl(e.target.value)} />
              <div className="hint">Google Sheets links are converted to their CSV export (the sheet must be shared by link).</div>
            </div>
            <div className="row">
              <div className="field grow">
                <label>Format</label>
                <Seg value={format} onChange={setFormat} options={[{ value: "json", label: "JSON" }, { value: "csv", label: "CSV" }]} />
              </div>
              <div className="field grow">
                <label>Bearer token variable (optional)</label>
                <input className="input mono" placeholder="API_TOKEN" value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
              </div>
            </div>
          </>
        )}
        <div className="row">
          <input className="input" style={{ maxWidth: 320 }} placeholder="Source name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn soft" onClick={fetchGrid} disabled={busy || (kind === "database" ? !query.trim() : !url.trim())}>
            {busy && <Loader2 size={14} className="spin" />} Fetch preview
          </button>
          {grid && <span className="small muted">{fmtInt(Math.max(0, grid.length - 1))} rows · {width} columns</span>}
        </div>
        {error && <div className="callout red">{error}</div>}
        {grid && (
          <div style={{ height: 260, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <DataGrid columns={Array.from({ length: width }, (_, c) => ({ name: colLetter(c), width: 140 }))} rowCount={Math.min(grid.length, 500)} getCell={(r, c) => grid[r][c] ?? null} />
          </div>
        )}
        <div className="callout">
          <Info size={16} />
          <div className="small">
            The server fetches a snapshot for you to build with. Credentials stay in the server's environment. Runs and exported code re-read the source live.
          </div>
        </div>
      </div>
    </Modal>
  );
}
