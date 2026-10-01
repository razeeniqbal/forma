import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ShieldCheck, Download, ExternalLink, Search, Loader2, Workflow, Check, X, Ban, Undo2, ChevronRight } from "lucide-react";
import { usePipeline, useApp } from "@/store/app";
import { useFullExecution } from "@/lib/hooks";
import { profileDataset, validationHealth } from "@/engine/profile";
import { ruleLabel } from "@/engine/execute";
import type { Issue } from "@/engine/types";
import { toText } from "@/engine/values";
import { DataGrid, estimateWidths } from "@/components/DataGrid";
import { Bar, Empty, Ring, StatusIcon, ProjectCrumbs } from "@/components/ui";
import { download, fmtInt, fmtPct } from "@/lib/format";
import { ISSUE_LABEL, makeDecision, removeDecision, upsertDecisions } from "@/lib/review";

export function ValidatePage() {
  const { id } = useParams();
  const pipeline = usePipeline(id);
  const nav = useNavigate();
  const updateSpec = useApp((s) => s.updateSpec);
  const { result, loading, error } = useFullExecution(pipeline?.spec);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "open" | "resolved">("all");
  const [colFilter, setColFilter] = useState<string | null>(null);
  const [fix, setFix] = useState<{ key: string; value: string } | null>(null);

  const ds = result?.beforeGate;
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);
  const health = validationHealth(result?.ruleResults ?? []);
  const rules = pipeline?.spec.steps.flatMap((s) => (s.type === "validate" ? s.rules : [])) ?? [];
  const validateIndex = pipeline?.spec.steps.findIndex((s) => s.type === "validate") ?? -1;
  const issueCells = useMemo(() => new Set(result?.issues.map((i) => `${i.row}\u0000${i.column}`)), [result]);
  const inputIdx = useMemo(() => new Map(result?.input.rowIds.map((r, i) => [r, i]) ?? []), [result]);
  const decisions = pipeline?.spec.reviewDecisions ?? [];
  const decisionFor = (i: Issue) => decisions.find((d) => d.row === i.row && (d.column === i.column || d.column === null));

  const rows = useMemo(() => {
    if (!ds) return [];
    const needle = q.toLowerCase();
    return ds.rows.map((_, i) => i).filter((i) => !needle || ds.rows[i].some((v) => (toText(v) ?? "").toLowerCase().includes(needle)));
  }, [ds, q]);
  const widths = useMemo(() => (ds ? estimateWidths(ds.columns, ds.rows.length, (r, c) => ds.rows[r][c]) : []), [ds]);

  if (!pipeline)
    return (
      <div className="page">
        <Empty icon={<Workflow size={22} />} title="Pipeline not found" />
      </div>
    );

  const issues = (result?.issues ?? []).filter((i) => (!colFilter || i.column === colFilter) && (tab === "all" || (tab === "resolved") === !!decisionFor(i)));
  const byColumn = new Map<string, number>();
  for (const i of result?.issues ?? []) byColumn.set(i.column, (byColumn.get(i.column) ?? 0) + 1);
  const decide = (i: Issue, action: "correct" | "ignore" | "exclude", value?: string) => {
    const k = inputIdx.get(i.row);
    updateSpec(pipeline.id, (s) => upsertDecisions(s, [makeDecision(i.row, action === "exclude" ? null : i.column, action, k === undefined ? undefined : result!.input.rows[k], { value, issueKind: i.kind })]));
  };

  const exportReport = () => {
    const lines = [
      `# Validation report: ${pipeline.spec.name}`,
      "",
      `${fmtPct(health.passed, health.evaluated)} of ${fmtInt(health.evaluated)} evaluated values passed configured quality rules.`,
      "",
      "| Column | Rule | Passed | Evaluated |",
      "| --- | --- | ---: | ---: |",
      ...rules.map((r) => {
        const rr = result?.ruleResults.find((x) => x.ruleId === r.id);
        return `| ${r.column} | ${ruleLabel(r)} | ${rr?.passed ?? 0} | ${rr?.evaluated ?? 0} |`;
      }),
      "",
      `Rows needing review: ${fmtInt(result?.reviewRows.length ?? 0)}`,
    ];
    download(`${pipeline.spec.name.replace(/\W+/g, "_")}_validation.md`, lines.join("\n"), "text/markdown");
  };

  return (
    <div className="page wide">
      <div className="crumbs">
        <ProjectCrumbs projectId={pipeline.projectId} section="Pipelines" sectionPath="pipelines" /><Link to={`/pipelines/${pipeline.id}`}>{pipeline.spec.name}</Link>/<span className="cur">Validate</span>
      </div>
      <div className="page-head" style={{ alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 24 }}>Validate</h1>
          <p>Explicit rules on every row: {result ? `${fmtInt(result.input.rows.length)} rows evaluated` : "evaluating…"}. Problems are surfaced, never silently changed.</p>
        </div>
        <div className="actions">
          <Link className="btn" to={`/pipelines/${pipeline.id}`}>
            Back to workspace
          </Link>
          {validateIndex < 0 && (
            <Link className="btn primary" to={`/pipelines/${pipeline.id}`}>
              Add validation step
            </Link>
          )}
        </div>
      </div>
      {error && <div className="callout red" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="split wide-side">
        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="card-head">
              <h3>Data view</h3>
              {loading && <Loader2 size={15} className="spin" color="var(--blue)" />}
              <div className="row" style={{ width: 240 }}>
                <Search size={14} color="var(--subtle)" />
                <input className="input sm" placeholder="Search data…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            {ds && (
              <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid var(--border)" }}>
                {profiles.map((p) => {
                  const rr = (result?.ruleResults ?? []).filter((r) => r.column === p.name);
                  const ev = rr.reduce((a, r) => a + r.evaluated, 0);
                  const ok = rr.reduce((a, r) => a + r.passed, 0);
                  return (
                    <button key={p.name} className="option" style={{ minWidth: 170, borderRadius: 0, border: 0, borderRight: "1px solid var(--border)", flexDirection: "column", gap: 4, background: colFilter === p.name ? "var(--blue-50)" : undefined }} onClick={() => setColFilter(colFilter === p.name ? null : p.name)}>
                      <div className="t ellipsis" style={{ width: "100%" }}>{p.name}</div>
                      <div className="small muted">{ev ? `${fmtPct(ok, ev)} valid` : `${fmtPct(p.filled, p.total)} complete`}</div>
                      <div style={{ width: "100%" }}>
                        <Bar value={ev ? ok / ev : p.completeness} />
                      </div>
                      {p.histogram ? (
                        <div className="sparkbars" style={{ width: "100%", height: 20 }}>
                          {p.histogram.map((h, i) => (
                            <span key={i} style={{ height: `${(h / Math.max(...p.histogram!)) * 100}%` }} />
                          ))}
                        </div>
                      ) : (
                        <div className="tiny muted ellipsis" style={{ width: "100%" }}>{fmtInt(p.unique)} unique</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ height: 380 }}>
              {ds ? (
                <DataGrid
                  columns={ds.columns.map((name, i) => ({ name, width: widths[i] }))}
                  rowCount={rows.length}
                  getCell={(r, c) => ds.rows[rows[r]][c]}
                  rowLabel={(r) => ds.rowIds[rows[r]]}
                  selectedColumns={new Set(colFilter ? [ds.columns.indexOf(colFilter)] : [])}
                  cellClass={(r, c) => (issueCells.has(`${ds.rowIds[rows[r]]}\u0000${ds.columns[c]}`) ? "invalid" : undefined)}
                />
              ) : (
                <div className="skeleton" style={{ height: "100%", borderRadius: 0 }} />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>
                Failed rows <span style={{ color: "var(--red-text)", fontWeight: 600, fontSize: 13, marginLeft: 8 }}>{fmtInt(result?.reviewRows.length ?? 0)} rows require review</span>
              </h3>
              {colFilter && (
                <button className="chip on" onClick={() => setColFilter(null)}>
                  {colFilter} <X size={12} />
                </button>
              )}
              <Link className="btn sm" to={`/pipelines/${pipeline.id}/review`}>
                Open review queue <ExternalLink size={12} />
              </Link>
            </div>
            <div className="chips" style={{ padding: "10px 16px" }}>
              {(["all", "open", "resolved"] as const).map((t) => (
                <button key={t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                  {t === "all" ? "All issues" : t === "open" ? "Unresolved" : "Resolved"}
                </button>
              ))}
            </div>
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Column</th>
                    <th>Value</th>
                    <th>Rule / issue</th>
                    <th>Reason</th>
                    <th style={{ width: 220 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.slice(0, 500).map((i, k) => {
                    const d = decisionFor(i);
                    const key = `${i.row}:${i.column}:${k}`;
                    return (
                      <tr key={key}>
                        <td className="num">{i.row}</td>
                        <td>{i.column}</td>
                        <td className="mono small" style={{ color: "var(--red-text)", maxWidth: 200 }}>
                          <div className="ellipsis">{i.value === null ? "(blank)" : String(i.value)}</div>
                        </td>
                        <td className="small">{ISSUE_LABEL[i.kind]}</td>
                        <td className="small">{i.message}</td>
                        <td>
                          {d ? (
                            <span className="row">
                              <span className="badge green sm">{d.action === "correct" ? `Fixed → ${d.value}` : d.action === "exclude" ? "Excluded" : d.action === "keep" ? "Kept" : "Ignored"}</span>
                              <button className="btn ghost xs" onClick={() => updateSpec(pipeline.id, (s) => removeDecision(s, d.row, d.column))}>
                                <Undo2 size={11} />
                              </button>
                            </span>
                          ) : fix?.key === key ? (
                            <span className="row">
                              <input className="input sm" autoFocus value={fix.value} onChange={(e) => setFix({ key, value: e.target.value })} onKeyDown={(e) => {
                                if (e.key === "Enter" && fix.value.trim()) { decide(i, "correct", fix.value.trim()); setFix(null); }
                                if (e.key === "Escape") setFix(null);
                              }} />
                              <button className="btn primary xs" aria-label="Save" disabled={!fix.value.trim()} onClick={() => { decide(i, "correct", fix.value.trim()); setFix(null); }}>
                                <Check size={12} />
                              </button>
                            </span>
                          ) : (
                            <span className="row" style={{ gap: 4 }}>
                              <button className="btn xs soft" onClick={() => setFix({ key, value: "" })}>Fix</button>
                              <button className="btn xs" onClick={() => decide(i, "ignore")}>Ignore</button>
                              <button className="btn xs danger" onClick={() => decide(i, "exclude")}>
                                <Ban size={11} /> Exclude row
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {issues.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                        No issues in this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad">
            <div className="row" style={{ marginBottom: 12 }}>
              <h3 className="grow">Data quality</h3>
              <button className="btn sm" onClick={exportReport} disabled={!result}>
                <Download size={13} /> Export report
              </button>
            </div>
            {rules.length === 0 ? (
              <div className="muted small">No validation rules yet. Add a Validate step in the workspace.</div>
            ) : (
              <>
                <div className="row" style={{ gap: 14 }}>
                  <Ring value={health.ratio} />
                  <div>
                    <h3>Validation health</h3>
                    <div className="small muted">
                      {fmtPct(health.passed, health.evaluated)} of {fmtInt(health.evaluated)} evaluated values passed configured quality rules.
                    </div>
                  </div>
                </div>
                <div className="col" style={{ marginTop: 12, gap: 8 }}>
                  {Object.entries(health.dims)
                    .filter(([, d]) => d.evaluated)
                    .map(([k, d]) => (
                      <div key={k} className="row" style={{ gap: 10 }}>
                        <span style={{ width: 96, textTransform: "capitalize" }}>{k}</span>
                        <span className="num" style={{ width: 52, fontWeight: 650 }}>{fmtPct(d.passed, d.evaluated)}</span>
                        <div className="grow">
                          <Bar value={d.passed / d.evaluated} />
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
          <div className="card card-pad">
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 className="grow">Validation rules</h3>
              {validateIndex >= 0 && (
                <button className="btn sm" onClick={() => nav(`/pipelines/${pipeline.id}`)}>
                  Manage rules
                </button>
              )}
            </div>
            <div className="col" style={{ gap: 8 }}>
              {rules.map((r) => {
                const rr = result?.ruleResults.find((x) => x.ruleId === r.id);
                const failed = rr ? rr.evaluated - rr.passed : 0;
                return (
                  <div key={r.id} className="row small" style={{ gap: 8 }}>
                    <StatusIcon status={!rr ? "running" : failed ? "warning" : "success"} size={16} />
                    <b style={{ width: 110 }} className="ellipsis">{r.column}</b>
                    <span className="grow muted">{ruleLabel(r)}</span>
                    {failed > 0 && <span className="badge amber sm">{fmtInt(failed)}</span>}
                  </div>
                );
              })}
              {rules.length === 0 && <div className="small muted">-</div>}
            </div>
          </div>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 10 }}>Column quality</h3>
            {profiles.map((p) => {
              const n = byColumn.get(p.name) ?? 0;
              const rate = p.total ? 1 - n / p.total : 1;
              return (
                <button key={p.name} className="row" style={{ width: "100%", border: 0, background: colFilter === p.name ? "var(--blue-50)" : "transparent", padding: "6px 4px", borderRadius: 6, cursor: "pointer", gap: 10 }} onClick={() => setColFilter(colFilter === p.name ? null : p.name)}>
                  <span style={{ width: 100, textAlign: "left" }} className="ellipsis">{p.name}</span>
                  <span className="num" style={{ width: 52, fontWeight: 650, color: rate >= 0.98 ? "var(--green-text)" : rate >= 0.9 ? "var(--amber-text)" : "var(--red-text)" }}>{fmtPct(p.total - n, p.total)}</span>
                  <div className="grow">
                    <Bar value={rate} />
                  </div>
                  <span className="small muted" style={{ width: 64, textAlign: "right" }}>{n} issues</span>
                  <ChevronRight size={13} color="var(--subtle)" />
                </button>
              );
            })}
          </div>
          <div className="callout">
            <ShieldCheck size={16} />
            <div>FORMA reports validation health against your configured rules instead of an unexplained universal score.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
