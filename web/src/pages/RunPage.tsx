import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Check, AlertTriangle, X, Clock, Database, Upload, XCircle, Play, FileText, GitCompare, RefreshCw, Copy, Minus, Loader2, History,
} from "lucide-react";
import { useApp } from "@/store/app";
import { getRunOutput } from "@/store/db";
import type { Run } from "@/store/model";
import type { Dataset } from "@/engine/types";
import { DataGrid, estimateWidths } from "@/components/DataGrid";
import { CodeView } from "@/components/CodeView";
import { Empty, Modal, StatusBadge, StatusIcon, ProjectCrumbs } from "@/components/ui";
import { generateConfigYaml, generatePipelineJson } from "@/codegen/python";
import { toCsv } from "@/lib/exporters";
import { copyText, download, fmtDateTime, fmtDuration, fmtInt, fmtPct, fmtTime } from "@/lib/format";

export function RunPage() {
  const { runId } = useParams();
  const run = useApp((s) => s.runs.find((r) => r.id === runId));
  const runs = useApp((s) => s.runs);
  const pipeline = useApp((s) => s.pipelines.find((p) => p.id === run?.pipelineId));
  const nav = useNavigate();
  const [level, setLevel] = useState<"all" | "info" | "success" | "warning" | "error">("all");
  const [modal, setModal] = useState<null | "output" | "compare" | "spec" | "config">(null);
  const [rerunning, setRerunning] = useState(false);
  const refreshServerRun = useApp((s) => s.refreshServerRun);
  useEffect(() => {
    if (!run?.remoteId) return;
    if (run.status !== "running" && run.steps.length) return;
    let alive = true;
    const tick = () => refreshServerRun(run.id).catch(() => undefined).finally(() => alive && setTimeout(tick, 1500));
    tick();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status, run?.steps.length]);

  if (!run)
    return (
      <div className="page">
        <Empty icon={<History size={22} />} title="Run not found" action={<Link className="btn" to="/projects">Projects</Link>} />
      </div>
    );

  const prev = runs.find((r) => r.pipelineId === run.pipelineId && r.startedAt < run.startedAt && r.mode === run.mode && r.status !== "running");
  const version = pipeline?.versions.find((v) => v.version === run.version);
  const duration = run.finishedAt ? run.finishedAt - run.startedAt : Date.now() - run.startedAt;
  const logs = run.logs.filter((l) => level === "all" || l.level === level);
  const count = (l: string) => run.logs.filter((x) => x.level === l).length;
  const rerun = async () => {
    setRerunning(true);
    const r = await useApp.getState().runPipeline(run.pipelineId, run.mode);
    setRerunning(false);
    if (r) nav(`/runs/${r.id}`);
  };

  return (
    <div className="page wide">
      <div className="crumbs">
        <ProjectCrumbs projectId={run.projectId} section="Runs" sectionPath="runs" /><Link to={`/pipelines/${run.pipelineId}`}>{run.pipelineName}</Link>/<span className="cur">{fmtDateTime(run.startedAt)}</span>
      </div>
      <div className="page-head" style={{ alignItems: "center" }}>
        <div>
          <div className="row">
            <h1 style={{ fontSize: 24 }}>{run.pipelineName}</h1>
            {run.mode === "test" ? <span className="badge">Test run · draft</span> : <span className="badge outline">v{run.version}</span>}
            {run.remoteId && <span className="badge blue">FORMA server{run.trigger === "schedule" ? " · scheduled" : ""}</span>}
          </div>
          <div className="row small muted" style={{ marginTop: 6, gap: 14 }}>
            <span>
              Run ID <span className="mono">{run.id}</span>
            </span>
            <span>{fmtDateTime(run.startedAt)}</span>
            <StatusBadge status={run.status} />
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={rerun} disabled={rerunning || !pipeline}>
            {rerunning ? <Loader2 size={15} className="spin" /> : <Play size={15} />} Rerun
          </button>
          {run.reviewCount > 0 && (
            <Link className="btn warn" to={`/runs/${run.id}/review`}>
              <AlertTriangle size={15} /> Review {fmtInt(run.reviewCount)} rows
            </Link>
          )}
          <button className="btn soft" onClick={() => setModal("output")} disabled={run.status === "failed" || run.status === "running"}>
            <FileText size={15} /> View output
          </button>
        </div>
      </div>

      <div className="split wide-side">
        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>Execution timeline</h3>
            <div className="timeline">
              <TlStep n={1} t="Source" d={run.sourceName} status={run.rowsIn ? "ok" : run.status === "failed" ? "err" : "skip"} time={run.steps.length ? undefined : undefined} />
              {run.steps.map((s, i) => (
                <TlStep key={s.stepId} n={i + 2} t={s.stage} d={s.title} status={s.error ? (s.error.startsWith("Skipped") ? "skip" : "err") : s.issues ? "warn" : "ok"} time={fmtDuration(s.durationMs)} />
              ))}
              <TlStep n={run.steps.length + 2} t="Load" d={run.destinationLabel} status={run.status === "failed" ? "skip" : run.status === "running" ? "skip" : "ok"} />
            </div>
          </div>

          <div>
            <h3 style={{ marginBottom: 10 }}>Run summary</h3>
            <div className="grid-5">
              <Stat icon={<Clock size={18} />} k="Duration" v={fmtDuration(duration)} />
              <Stat icon={<Database size={18} />} k="Input rows" v={fmtInt(run.rowsIn)} />
              <Stat icon={<Upload size={18} />} k="Loaded rows" v={fmtInt(run.rowsOut)} pct={fmtPct(run.rowsOut, run.rowsIn)} tone="green" />
              <Stat icon={<AlertTriangle size={18} />} k="Review rows" v={fmtInt(run.reviewCount)} pct={fmtPct(run.reviewCount, run.rowsIn)} tone="amber" />
              <Stat icon={<XCircle size={18} />} k={run.excludedCount ? "Excluded / failed" : "Failed rows"} v={run.excludedCount ? `${fmtInt(run.excludedCount)} / ${fmtInt(run.failedCount)}` : fmtInt(run.failedCount)} pct={fmtPct(run.failedCount, run.rowsIn)} tone="red" />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Step details</h3>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th style={{ textAlign: "right" }}>Duration</th>
                  <th style={{ textAlign: "right" }}>Rows in</th>
                  <th style={{ textAlign: "right" }}>Rows out</th>
                  <th>Changes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="badge blue sm">01</span> Source
                  </td>
                  <td />
                  <td />
                  <td className="num" style={{ textAlign: "right" }}>{fmtInt(run.rowsIn)}</td>
                  <td className="small muted">Read {run.sourceName}</td>
                  <td>{run.rowsIn ? <span className="row small"><StatusIcon status="success" size={14} /> Success</span> : <span className="small muted">-</span>}</td>
                </tr>
                {run.steps.map((s, i) => (
                  <tr key={s.stepId}>
                    <td>
                      <span className="badge blue sm">{String(i + 2).padStart(2, "0")}</span> <b>{s.stage}</b> <span className="muted">· {s.title}</span>
                    </td>
                    <td className="num small" style={{ textAlign: "right" }}>{fmtDuration(s.durationMs)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmtInt(s.rowsIn)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmtInt(s.rowsOut)}</td>
                    <td className="small">{s.error ?? s.summary}</td>
                    <td>
                      <span className="row small">
                        <StatusIcon status={s.error ? (s.error.startsWith("Skipped") ? "cancelled" : "failed") : s.issues ? "review" : "success"} size={14} />
                        {s.error ? (s.error.startsWith("Skipped") ? "Skipped" : "Failed") : s.issues ? "Review" : "Success"}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <span className="badge blue sm">{String(run.steps.length + 2).padStart(2, "0")}</span> Load
                  </td>
                  <td />
                  <td className="num" style={{ textAlign: "right" }}>{fmtInt(run.rowsOut + run.reviewCount)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmtInt(run.rowsOut)}</td>
                  <td className="small">{run.status === "failed" ? "Not loaded" : `${fmtInt(run.rowsOut)} rows · ${run.destinationLabel}`}</td>
                  <td>{run.status !== "failed" && run.status !== "running" && <span className="row small"><StatusIcon status="success" size={14} /> Success</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Run log</h3>
              <div className="chips">
                {(["all", "info", "success", "warning", "error"] as const).map((l) => (
                  <button key={l} className={`chip ${level === l ? "on" : ""}`} onClick={() => setLevel(l)}>
                    {l === "all" ? "All" : l[0].toUpperCase() + l.slice(1)} <span className="count">({l === "all" ? run.logs.length : count(l)})</span>
                  </button>
                ))}
              </div>
            </div>
            <table className="table compact">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Time</th>
                  <th style={{ width: 110 }}>Level</th>
                  <th style={{ width: 200 }}>Step</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i}>
                    <td className="num small muted">{fmtTime(l.t)}</td>
                    <td>
                      <span className="row small">
                        <StatusIcon status={l.level === "success" ? "success" : l.level === "warning" ? "warning" : l.level === "error" ? "error" : "info"} size={13} />
                        {l.level[0].toUpperCase() + l.level.slice(1)}
                      </span>
                    </td>
                    <td className="small">{l.step}</td>
                    <td className="small" style={{ color: l.level === "warning" ? "var(--amber-text)" : l.level === "error" ? "var(--red-text)" : undefined }}>
                      {l.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 12 }}>Run details</h3>
            <div className="kv">
              <div>Status</div>
              <div>
                <StatusBadge status={run.status} />
                {run.error && <div className="small" style={{ color: "var(--red-text)", marginTop: 4 }}>{run.error}</div>}
              </div>
              <div>Run ID</div>
              <div className="row">
                <span className="mono small ellipsis">{run.id}</span>
                <button className="btn ghost xs icon" aria-label="Copy run ID" onClick={() => copyText(run.id)}>
                  <Copy size={12} />
                </button>
              </div>
              <div>Triggered by</div>
              <div>{run.triggeredBy}</div>
              <div>Time</div>
              <div>
                {fmtDateTime(run.startedAt)}
                <div className="small muted">({fmtDuration(duration)})</div>
              </div>
              <div>Mode</div>
              <div>{run.mode === "test" ? "Test run (sample)" : "Manual"}</div>
              <div>Pipeline version</div>
              <div>{run.mode === "test" ? "Draft" : `v${run.version}`}</div>
              <div>Source</div>
              <div className="ellipsis">{run.sourceName}</div>
              <div>Destination</div>
              <div className="ellipsis">{run.destinationLabel}</div>
            </div>
          </div>
          <div className="card card-pad col">
            <h3>Actions</h3>
            <button className="btn primary" onClick={rerun} disabled={rerunning || !pipeline}>
              <RefreshCw size={15} /> Rerun pipeline
            </button>
            {run.reviewCount > 0 && (
              <Link className="btn warn" to={`/runs/${run.id}/review`}>
                <AlertTriangle size={15} /> Review {fmtInt(run.reviewCount)} rows
              </Link>
            )}
            <button className="btn soft" onClick={() => setModal("output")} disabled={run.status === "failed" || run.status === "running"}>
              <FileText size={15} /> View output data
            </button>
            <button className="btn soft" onClick={() => setModal("compare")} disabled={!prev}>
              <GitCompare size={15} /> Compare with previous run
            </button>
          </div>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 10 }}>Additional information</h3>
            <div className="kv" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>Python script</div>
              <div>
                <Link to={`/pipelines/${run.pipelineId}/export`}>View code</Link>
              </div>
              <div>Pipeline spec (JSON)</div>
              <div>
                <a href="#spec" onClick={(e) => { e.preventDefault(); setModal("spec"); }}>
                  View spec
                </a>
              </div>
              <div>Run configuration</div>
              <div>
                <a href="#config" onClick={(e) => { e.preventDefault(); setModal("config"); }}>
                  View config
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {modal === "output" && <OutputModal run={run} onClose={() => setModal(null)} />}
      {modal === "compare" && prev && <CompareModal run={run} prev={prev} onClose={() => setModal(null)} />}
      {modal === "spec" && (
        <Modal title={`Pipeline spec: ${run.mode === "test" ? "draft at run time" : `v${run.version}`}`} size="lg" onClose={() => setModal(null)}>
          {version || pipeline ? <CodeView code={generatePipelineJson((version ?? pipeline!.versions.at(-1) ?? { spec: pipeline!.spec }).spec, run.version)} /> : <div className="muted">The pipeline was deleted.</div>}
        </Modal>
      )}
      {modal === "config" && (
        <Modal title="Run configuration" size="lg" onClose={() => setModal(null)}>
          {version || pipeline ? <CodeView code={generateConfigYaml((version ?? { spec: pipeline!.spec }).spec)} /> : <div className="muted">The pipeline was deleted.</div>}
        </Modal>
      )}
    </div>
  );
}

function TlStep({ n, t, d, status, time }: { n: number; t: string; d: string; status: "ok" | "warn" | "err" | "skip"; time?: string }) {
  return (
    <div className={`tl-step ${status === "ok" ? "" : status}`}>
      <div className="tl-dot">{status === "ok" ? <Check size={16} /> : status === "warn" ? <AlertTriangle size={15} /> : status === "err" ? <X size={16} /> : <Minus size={16} />}</div>
      <div className="t">
        <span className="subtle">{String(n).padStart(2, "0")}</span> {t}
      </div>
      {time && <div className="d num">{time}</div>}
      <div className="d ellipsis" title={d}>
        {d}
      </div>
    </div>
  );
}

function Stat({ icon, k, v, pct, tone }: { icon: React.ReactNode; k: string; v: string; pct?: string; tone?: "green" | "amber" | "red" }) {
  const bg = tone === "green" ? "var(--green-bg)" : tone === "amber" ? "var(--amber-bg)" : tone === "red" ? "var(--red-bg)" : "var(--blue-50)";
  const fg = tone === "green" ? "var(--green-text)" : tone === "amber" ? "var(--amber-text)" : tone === "red" ? "var(--red-text)" : "var(--blue)";
  return (
    <div className="card stat">
      <div className="icon-wrap" style={{ background: bg, color: fg }}>
        {icon}
      </div>
      <div>
        <div className="k">{k}</div>
        <div className="v">{v}</div>
      </div>
      {pct && <div className="pct">{pct}</div>}
    </div>
  );
}

async function toXlsx(ds: Dataset): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("output");
  ws.addRow(ds.columns);
  ws.getRow(1).font = { bold: true };
  for (const r of ds.rows) ws.addRow(r.map((v) => (v === null ? undefined : v)));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function OutputModal({ run, onClose }: { run: Run; onClose: () => void }) {
  const [ds, setDs] = useState<Dataset | null | undefined>(undefined);
  useEffect(() => {
    getRunOutput(run.id).then((d) => setDs(d ?? null));
  }, [run.id]);
  const widths = useMemo(() => (ds ? estimateWidths(ds.columns, ds.rows.length, (r, c) => ds.rows[r][c]) : []), [ds]);
  const base = run.pipelineName.toLowerCase().replace(/\W+/g, "_");
  return (
    <Modal
      title={`Output data: ${fmtInt(ds?.rows.length ?? run.rowsOut)} rows`}
      size="xl"
      onClose={onClose}
      footer={
        ds && (
          <>
            <span className="small muted" style={{ marginRight: "auto" }}>
              Rows held for review are not included.
            </span>
            <button className="btn" onClick={() => download(`${base}.json`, JSON.stringify(ds.rows.map((r) => Object.fromEntries(ds.columns.map((c, i) => [c, r[i]]))), null, 2), "application/json")}>
              JSON
            </button>
            <button className="btn" onClick={async () => download(`${base}.xlsx`, await toXlsx(ds), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
              Excel
            </button>
            <button className="btn primary" onClick={() => download(`${base}.csv`, toCsv(ds), "text/csv")}>
              Download CSV
            </button>
          </>
        )
      }
    >
      <div style={{ height: "60vh", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {ds === undefined ? (
          <div className="skeleton" style={{ height: "100%" }} />
        ) : ds === null ? (
          <div className="empty">Output for this run is no longer stored.</div>
        ) : (
          <DataGrid columns={ds.columns.map((name, i) => ({ name, width: widths[i] }))} rowCount={ds.rows.length} getCell={(r, c) => ds.rows[r][c]} rowLabel={(r) => ds.rowIds[r]} />
        )}
      </div>
    </Modal>
  );
}

function CompareModal({ run, prev, onClose }: { run: Run; prev: Run; onClose: () => void }) {
  const rows: [string, number, number][] = [
    ["Input rows", prev.rowsIn, run.rowsIn],
    ["Loaded rows", prev.rowsOut, run.rowsOut],
    ["Review rows", prev.reviewCount, run.reviewCount],
    ["Excluded rows", prev.excludedCount, run.excludedCount],
    ["Steps", prev.steps.length, run.steps.length],
    ["Duration (ms)", (prev.finishedAt ?? prev.startedAt) - prev.startedAt, (run.finishedAt ?? run.startedAt) - run.startedAt],
  ];
  const addedCols = run.columns.filter((c) => !prev.columns.includes(c));
  const removedCols = prev.columns.filter((c) => !run.columns.includes(c));
  return (
    <Modal title="Compare with previous run" size="lg" onClose={onClose}>
      <div className="small muted" style={{ marginBottom: 10 }}>
        {prev.mode === "test" ? "Draft" : `v${prev.version}`} · {fmtDateTime(prev.startedAt)} → {run.mode === "test" ? "Draft" : `v${run.version}`} · {fmtDateTime(run.startedAt)}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            <th style={{ textAlign: "right" }}>Previous</th>
            <th style={{ textAlign: "right" }}>This run</th>
            <th style={{ textAlign: "right" }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num" style={{ textAlign: "right" }}>{fmtInt(a)}</td>
              <td className="num" style={{ textAlign: "right" }}>{fmtInt(b)}</td>
              <td className="num" style={{ textAlign: "right", color: b === a ? "var(--muted)" : undefined }}>
                {b === a ? "-" : `${b > a ? "+" : ""}${fmtInt(b - a)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(addedCols.length > 0 || removedCols.length > 0) && (
        <div className="callout" style={{ marginTop: 12 }}>
          <div>
            {addedCols.length > 0 && <div>Columns added: {addedCols.join(", ")}</div>}
            {removedCols.length > 0 && <div>Columns removed: {removedCols.join(", ")}</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}
