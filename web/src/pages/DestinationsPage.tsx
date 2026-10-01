import { useState } from "react";
import { Link } from "react-router-dom";
import { Database, Plus, Trash2, KeyRound, Info, FileSpreadsheet } from "lucide-react";
import { serverClient, useApp } from "@/store/app";
import { useServerHealth } from "@/components/server";
import type { Connection } from "@/store/model";
import { confirmAction, Empty, Modal } from "@/components/ui";
import { fmtAgo } from "@/lib/format";

const TYPES: { value: Connection["type"]; label: string; env: string }[] = [
  { value: "postgresql", label: "PostgreSQL", env: "WAREHOUSE_URL" },
  { value: "mysql", label: "MySQL", env: "MYSQL_URL" },
  { value: "warehouse", label: "Warehouse (SQLAlchemy URL)", env: "WAREHOUSE_URL" },
  { value: "api", label: "API credential", env: "API_TOKEN" },
];

export function DestinationsPage() {
  const connections = useApp((s) => s.connections);
  const pipelines = useApp((s) => s.pipelines);
  const { deleteConnection, toast } = useApp.getState();
  const { health } = useServerHealth();
  const [adding, setAdding] = useState(false);
  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/settings">Settings</Link>/<span className="cur">Destinations &amp; connections</span>
      </div>
      <div className="page-head">
        <div>
          <h1>Destinations &amp; connections</h1>
          <p>Connections are reusable references to external systems. Secrets are never stored in FORMA or written into exported code.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> New connection
          </button>
        </div>
      </div>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <KeyRound size={16} color="var(--muted)" />
            <h3>Connections</h3>
          </div>
          {connections.length === 0 ? (
            <Empty icon={<Database size={22} />} title="No connections yet" action={<button className="btn sm" onClick={() => setAdding(true)}>Add connection</button>}>
              Add a PostgreSQL or warehouse connection to load pipelines into a database table from the exported Python project.
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Environment variable</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b>{c.name}</b>
                      {c.description && <div className="small muted">{c.description}</div>}
                    </td>
                    <td className="small">{TYPES.find((t) => t.value === c.type)?.label}</td>
                    <td>
                      <code>{c.envVar}</code>
                    </td>
                    <td className="small muted">{fmtAgo(c.createdAt)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {health && c.type !== "api" && (
                        <button
                          className="btn sm"
                          onClick={async () => {
                            const r = await serverClient()!.testConnection(c.envVar).catch((e) => ({ ok: false, error: (e as Error).message }));
                            toast(r.ok ? "success" : "error", r.ok ? `${c.name}: connected` : `${c.name}: ${r.error}`);
                          }}
                        >
                          Test
                        </button>
                      )}
                      <button
                        className="btn ghost sm icon"
                        aria-label="Delete connection"
                        onClick={async () => (await confirmAction({ title: "Delete connection?", body: "Pipelines using it will need another destination.", confirmLabel: "Delete", danger: true })) && deleteConnection(c.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <FileSpreadsheet size={16} color="var(--muted)" />
            <h3>Pipeline destinations</h3>
          </div>
          {pipelines.length === 0 ? (
            <div className="empty">No pipelines yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Pipeline</th>
                  <th>Destination</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.map((p) => {
                  const d = p.spec.destination;
                  const conn = d?.type === "database" ? connections.find((c) => c.id === d.connectionId) : undefined;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/pipelines/${p.id}`}>{p.spec.name}</Link>
                      </td>
                      <td className="small">
                        {!d ? <span className="subtle">Not set</span> : d.type === "file" ? `${(d.format ?? "csv").toUpperCase()} file${d.path ? ` · ${d.path}` : ""}` : `${conn?.name ?? "Missing connection"} · ${d.table || "table not set"}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="callout" style={{ margin: 12 }}>
            <Info size={16} />
            <div>In the browser, runs prepare output files you can download. Database writes run from the exported Python project, which reads credentials from environment variables.</div>
          </div>
        </div>
      </div>
      {adding && <AddConnection onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddConnection({ onClose }: { onClose: () => void }) {
  const add = useApp((s) => s.addConnection);
  const [name, setName] = useState("Warehouse");
  const [type, setType] = useState<Connection["type"]>("postgresql");
  const [envVar, setEnvVar] = useState("WAREHOUSE_URL");
  const [description, setDescription] = useState("");
  const valid = name.trim() && /^[A-Z_][A-Z0-9_]*$/.test(envVar);
  return (
    <Modal
      title="New connection"
      onClose={onClose}
      icon={<Database size={18} color="var(--blue)" />}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              add({ name: name.trim(), type, envVar, description: description.trim() || undefined });
              onClose();
            }}
          >
            Add connection
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="field">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Type</label>
          <select
            className="select"
            value={type}
            onChange={(e) => {
              const t = e.target.value as Connection["type"];
              setType(t);
              setEnvVar(TYPES.find((x) => x.value === t)!.env);
            }}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Environment variable</label>
          <input className="input mono" value={envVar} onChange={(e) => setEnvVar(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
          <div className="hint">The exported project reads the connection URL / token from this variable, e.g. <code>postgresql://user:pass@host/db</code>.</div>
        </div>
        <div className="field">
          <label>Description (optional)</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="callout">
          <Info size={16} />
          FORMA never asks for or stores passwords. Only the variable name is saved.
        </div>
      </div>
    </Modal>
  );
}
