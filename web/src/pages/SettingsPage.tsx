import { useState } from "react";
import { Server } from "lucide-react";
import { useApp } from "@/store/app";
import { useServerHealth } from "@/components/server";
import { PRESET_LABEL, PRESET_ORDER } from "@/store/layouts";
import type { PresetId } from "@/store/model";
import { OUTPUT_DATE_FORMATS } from "@/engine/values";
import { confirmAction } from "@/components/ui";
import { stepTitle } from "@/engine/registry";
import { Trash2 } from "lucide-react";
import { MOD } from "@/lib/format";

export const SHORTCUTS: [string, string][] = [
  [`${MOD} K`, "Global command & search"],
  [`${MOD} Z`, "Undo"],
  [`${MOD} Shift Z`, "Redo"],
  [`${MOD} S`, "Save pipeline version"],
  ["Delete", "Remove selected step (undoable)"],
  ["Arrow keys", "Navigate the data grid"],
  ["Enter", "Inspect selected cell's column"],
  ["Esc", "Close dialog or clear selection"],
];

export function SettingsPage() {
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const reset = useApp((x) => x.resetAll);
  const toast = useApp((x) => x.toast);
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Preferences are stored locally in this browser.</p>
        </div>
      </div>
      <div className="col" style={{ gap: 16 }}>
        <div className="card card-pad col" style={{ gap: 14 }}>
          <h3>Profile</h3>
          <div className="field" style={{ maxWidth: 360 }}>
            <label>Display name</label>
            <input className="input" value={s.userName} onChange={(e) => update({ userName: e.target.value })} />
            <div className="hint">Shown as “Triggered by” on runs and in review decisions.</div>
          </div>
        </div>
        <div className="card card-pad col" style={{ gap: 14 }}>
          <h3>Workbench</h3>
          <div className="grid-2">
            <div className="field">
              <label>Default workspace preset</label>
              <select className="select" value={s.defaultPreset} onChange={(e) => update({ defaultPreset: e.target.value as PresetId })}>
                {PRESET_ORDER.filter((p) => p !== "custom").map((p) => (
                  <option key={p} value={p}>
                    {PRESET_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Default date output format</label>
              <select className="select" value={s.defaultDateFormat} onChange={(e) => update({ defaultDateFormat: e.target.value })}>
                {OUTPUT_DATE_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Preview sample size (rows)</label>
              <input className="input" type="number" min={100} max={50000} step={100} value={s.previewRows} onChange={(e) => update({ previewRows: Math.max(100, Math.min(50000, Number(e.target.value) || 2000)) })} />
              <div className="hint">Transformations preview on this many rows; runs always process every row.</div>
            </div>
            <div className="field">
              <label>Test run size (rows)</label>
              <input className="input" type="number" min={10} max={50000} step={10} value={s.testRunRows} onChange={(e) => update({ testRunRows: Math.max(10, Math.min(50000, Number(e.target.value) || 200)) })} />
            </div>
          </div>
        </div>
        <ServerCard />
        <PresetsCard />
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>Keyboard shortcuts</h3>
          <table className="table compact">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <td style={{ width: 180 }}>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-pad col" style={{ gap: 10 }}>
          <h3>Data &amp; storage</h3>
          <div className="muted">Pipelines, sources, runs and layouts are stored in this browser's IndexedDB. Nothing is uploaded to a server.</div>
          <div>
            <button
              className="btn danger"
              onClick={async () => {
                if (await confirmAction({ title: "Delete all local data?", body: "All pipelines, sources, runs, connections and layouts in this browser are permanently removed. Export anything you need first.", confirmLabel: "Delete everything", danger: true })) {
                  await reset();
                  toast("success", "Local data cleared");
                }
              }}
            >
              Delete all local data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetsCard() {
  const presets = useApp((x) => x.presets);
  const del = useApp((x) => x.deletePreset);
  return (
    <div className="card card-pad">
      <h3 style={{ marginBottom: 4 }}>Transformation presets</h3>
      <div className="muted small" style={{ marginBottom: 10 }}>
        Save a step (step menu → Save as preset) or a whole pipeline (More → Save steps as preset) and reuse it from the transformation picker.
      </div>
      {presets.length === 0 ? (
        <div className="subtle small">No presets yet.</div>
      ) : (
        <table className="table compact">
          <tbody>
            {presets.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td className="small muted">{p.description || p.steps.map((s) => stepTitle(s)).join(" → ")}</td>
                <td style={{ width: 40 }}>
                  <button className="btn ghost sm icon" aria-label={`Delete ${p.name}`} onClick={() => del(p.id)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ServerCard() {
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const { health, error, checking, recheck } = useServerHealth();
  const [url, setUrl] = useState(s.serverUrl ?? "");
  const [token, setToken] = useState(s.serverToken ?? "");
  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row">
        <Server size={16} color="var(--muted)" />
        <h3 className="grow">FORMA server</h3>
        {s.serverUrl && (checking ? <span className="badge">Checking…</span> : health ? <span className="badge green">Connected · v{health.version}</span> : <span className="badge red">Not reachable</span>)}
      </div>
      <div className="muted small">
        Optional Python backend for large files, scheduled runs, database/API sources and AI-assisted extraction. Start it with <code>python -m forma_server</code> (see <code>server/README.md</code>).
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Server URL</label>
          <input className="input mono" placeholder="http://localhost:8787" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field">
          <label>API token (optional)</label>
          <input className="input mono" type="password" placeholder="FORMA_API_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            update({ serverUrl: url.trim() || undefined, serverToken: token.trim() || undefined });
            setTimeout(recheck, 0);
          }}
        >
          Save &amp; test
        </button>
        {s.serverUrl && (
          <button className="btn" onClick={() => { update({ serverUrl: undefined, serverToken: undefined }); setUrl(""); setToken(""); }}>
            Disconnect
          </button>
        )}
        {health && (
          <span className="small muted">
            AI assist {health.features.ai ? "on" : "off (set ANTHROPIC_API_KEY on the server)"} · schedules on · database &amp; API sources on
          </span>
        )}
      </div>
      {error && <div className="callout red small">{error}</div>}
    </div>
  );
}
