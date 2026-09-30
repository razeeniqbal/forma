import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, ShieldCheck, AlertOctagon, Code2, Copy, Database, FileJson, ScrollText, History, ExternalLink, Download, Check, X, Ban } from "lucide-react";
import { profileDataset, validationHealth } from "@/engine/profile";
import { ruleLabel } from "@/engine/execute";
import type { Issue, IssueKind } from "@/engine/types";
import { generatePython, stepFunctionName, generatePipelineJson } from "@/codegen/python";
import { CodeView, findStepRange } from "@/components/CodeView";
import { Bar, Empty, Ring, Seg, StatusBadge, StatusIcon, Tabs } from "@/components/ui";
import { useApp } from "@/store/app";
import { copyText, download, fmtDateTime, fmtDuration, fmtInt, fmtPct, fmtTime } from "@/lib/format";
import { ISSUE_LABEL, makeDecision, removeDecision, upsertDecisions } from "@/lib/review";
import { useWs } from "../context";
import { PanelFrame } from "./PanelFrame";

// ---------------------------------------------------------------- Profile
export function ProfilePanel() {
  const ws = useWs();
  const [mode, setMode] = useState<"table" | "charts">("table");
  const ds = ws.datasetAfter(Math.min(ws.sel, ws.effective.steps.length));
  const profiles = useMemo(() => (ds ? profileDataset(ds) : []), [ds]);
  const rules = ws.preview.result?.ruleResults ?? [];
  return (
    <PanelFrame
      id="profile"
      title="Data Profile"
      icon={<BarChart3 size={15} color="var(--blue)" />}
      actions={<Seg size="sm" value={mode} onChange={setMode} options={[{ value: "table", label: "Table" }, { value: "charts", label: "Charts" }]} />}
    >
      {!ds ? (
        <Empty icon={<BarChart3 size={22} />} title="No data" />
      ) : mode === "table" ? (
        <table className="table compact">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th style={{ width: "18%" }}>Completeness</th>
              <th style={{ width: "18%" }}>Validity</th>
              <th style={{ width: "18%" }}>Uniqueness</th>
              <th>Min / Max</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const rs = rules.filter((r) => r.column === p.name && r.kind !== "not_blank" && r.kind !== "unique");
              const ev = rs.reduce((a, r) => a + r.evaluated, 0);
              const ok = rs.reduce((a, r) => a + r.passed, 0);
              return (
                <tr key={p.name} className={`clickable ${ws.column === p.name ? "selected" : ""}`} onClick={() => ws.setColumn(p.name)}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td className="muted" style={{ textTransform: "capitalize" }}>
                    {p.type}
                  </td>
                  <td>
                    <div className="num small">{fmtPct(p.filled, p.total)}</div>
                    <Bar value={p.completeness} />
                  </td>
                  <td>
                    {ev ? (
                      <>
                        <div className="num small">{fmtPct(ok, ev)}</div>
                        <Bar value={ok / ev} />
                      </>
                    ) : (
                      <span className="subtle small">No rules</span>
                    )}
                  </td>
                  <td>
                    <div className="num small">{fmtPct(p.unique, p.filled)}</div>
                    <Bar value={p.uniqueness} tone="blue" />
                  </td>
                  <td className="small muted num">{p.numericMin !== undefined ? `${p.numericMin.toLocaleString()} – ${p.numericMax!.toLocaleString()}` : p.min ? `${p.min.slice(0, 12)} – ${p.max!.slice(0, 12)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, padding: 10 }}>
          {profiles.map((p) => (
            <div key={p.name} className="card" style={{ padding: 10 }}>
              <div className="row">
                <b className="grow ellipsis">{p.name}</b>
                <span className="tiny muted">{fmtPct(p.filled, p.total)} complete</span>
              </div>
              {p.histogram ? (
                <div className="sparkbars" style={{ marginTop: 8 }}>
                  {p.histogram.map((h, i) => (
                    <span key={i} style={{ height: `${(h / Math.max(...p.histogram!)) * 100}%` }} />
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  {p.top.slice(0, 3).map((t) => (
                    <div key={t.value} className="row tiny" style={{ gap: 6 }}>
                      <span className="ellipsis" style={{ width: 70 }}>
                        {t.value}
                      </span>
                      <div className="grow">
                        <div className="bar blue">
                          <span style={{ width: `${(t.count / p.filled) * 100}%` }} />
                        </div>
                      </div>
                      <span className="num muted">{fmtPct(t.count, p.filled, 0)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="tiny muted" style={{ marginTop: 6 }}>
                {fmtInt(p.unique)} unique
                {p.numericMin !== undefined && ` · ${p.numericMin.toLocaleString()} – ${p.numericMax!.toLocaleString()}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelFrame>
  );
}

// ---------------------------------------------------------------- Quality
export function QualityPanel() {
  const ws = useWs();
  const res = ws.preview.result;
  const rules = res?.ruleResults ?? [];
  const h = validationHealth(rules);
  const validateSteps = ws.spec.steps.map((s, i) => ({ s, i })).filter((x) => x.s.type === "validate");
  const allRules = validateSteps.flatMap((x) => (x.s.type === "validate" ? x.s.rules : []));
  return (
    <PanelFrame
      id="quality"
      title="Quality"
      icon={<ShieldCheck size={15} color="var(--green)" />}
      actions={
        <Link className="btn ghost xs" to={`/pipelines/${ws.pipeline.id}/validate`}>
          Open validation <ExternalLink size={12} />
        </Link>
      }
      pad
    >
      {rules.length === 0 ? (
        <Empty icon={<ShieldCheck size={22} />} title="No validation rules yet" action={<button className="btn primary sm" onClick={() => ws.addStep("validate")}>Add validation rules</button>}>
          Define explicit rules such as “total &gt; 0” or “customer cannot be blank”.
        </Empty>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 14 }}>
            <Ring value={h.ratio} size={76} />
            <div>
              <h3>Validation health</h3>
              <div className="small muted">
                {fmtPct(h.passed, h.evaluated)} of {fmtInt(h.evaluated)} evaluated values passed configured quality rules.
              </div>
            </div>
          </div>
          {Object.entries(h.dims)
            .filter(([, d]) => d.evaluated)
            .map(([k, d]) => (
              <div key={k} className="row" style={{ gap: 10 }}>
                <span style={{ width: 96, textTransform: "capitalize" }}>{k}</span>
                <span className="num" style={{ width: 52, fontWeight: 650 }}>
                  {fmtPct(d.passed, d.evaluated)}
                </span>
                <div className="grow">
                  <Bar value={d.passed / d.evaluated} />
                </div>
              </div>
            ))}
          <div className="section-title">
            Validation rules
            <button className="btn xs" style={{ marginLeft: "auto" }} onClick={() => validateSteps[0] && ws.editStep(validateSteps[0].i)}>
              Manage rules
            </button>
          </div>
          {allRules.map((r) => {
            const rr = rules.find((x) => x.ruleId === r.id);
            const failed = rr ? rr.evaluated - rr.passed : 0;
            return (
              <div key={r.id} className="row small" style={{ gap: 8 }}>
                <StatusIcon status={failed ? "warning" : "success"} size={15} />
                <b style={{ width: 100 }} className="ellipsis">
                  {r.column}
                </b>
                <span className="grow muted ellipsis">{ruleLabel(r)}</span>
                {failed > 0 && <span className="badge amber sm">{fmtInt(failed)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </PanelFrame>
  );
}

// ---------------------------------------------------------------- Failed rows
export function FailedRowsPanel() {
  const ws = useWs();
  const res = ws.preview.result;
  const [kind, setKind] = useState<IssueKind | "all">("all");
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixValue, setFixValue] = useState("");
  const decisions = ws.spec.reviewDecisions;
  const inputIdx = useMemo(() => new Map(res?.input.rowIds.map((id, i) => [id, i]) ?? []), [res]);
  const issues = res?.issues ?? [];
  const kinds = useMemo(() => {
    const m = new Map<IssueKind, number>();
    for (const i of issues) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
    return m;
  }, [issues]);
  const list = issues.filter((i) => kind === "all" || i.kind === kind);
  const decisionFor = (i: Issue) => decisions.find((d) => d.row === i.row && (d.column === i.column || d.column === null));
  const src = (row: number) => {
    const k = inputIdx.get(row);
    return k === undefined ? undefined : res!.input.rows[k];
  };
  const decide = (i: Issue, action: "correct" | "ignore" | "exclude", value?: string) =>
    ws.update((s) => upsertDecisions(s, [makeDecision(i.row, action === "exclude" ? null : i.column, action, src(i.row), { value, issueKind: i.kind })]));

  return (
    <PanelFrame
      id="failedRows"
      title="Failed rows"
      icon={<AlertOctagon size={15} color="var(--red)" />}
      sub={res ? `${fmtInt(res.reviewRows.length)} rows require review` : undefined}
      actions={
        <Link className="btn ghost xs" to={`/pipelines/${ws.pipeline.id}/validate`}>
          View all <ExternalLink size={12} />
        </Link>
      }
    >
      {issues.length === 0 ? (
        <Empty icon={<Check size={22} />} title="No failed rows">
          Every value in the preview passed extraction, conversion and validation.
        </Empty>
      ) : (
        <>
          <div className="chips" style={{ padding: 8 }}>
            <button className={`chip ${kind === "all" ? "on" : ""}`} onClick={() => setKind("all")}>
              All issues <span className="count">({fmtInt(issues.length)})</span>
            </button>
            {[...kinds.entries()].map(([k, n]) => (
              <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
                {ISSUE_LABEL[k]} <span className="count">({fmtInt(n)})</span>
              </button>
            ))}
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Row</th>
                <th>Column</th>
                <th>Value</th>
                <th>Reason</th>
                <th style={{ width: 200 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 300).map((i, k) => {
                const d = decisionFor(i);
                const key = `${i.row}:${i.column}:${k}`;
                return (
                  <tr key={key}>
                    <td className="num">{i.row}</td>
                    <td>{i.column}</td>
                    <td className="mono small ellipsis" style={{ maxWidth: 180, color: "var(--red-text)" }} title={String(i.value ?? "")}>
                      {i.value === null ? "(blank)" : String(i.value)}
                    </td>
                    <td className="small">{i.message}</td>
                    <td>
                      {d ? (
                        <span className="row">
                          <span className="badge green sm">{d.action === "correct" ? `Fixed → ${d.value}` : d.action === "exclude" ? "Excluded" : d.action === "keep" ? "Kept" : "Ignored"}</span>
                          <button className="btn ghost xs" onClick={() => ws.update((s) => removeDecision(s, d.row, d.column))}>
                            Undo
                          </button>
                        </span>
                      ) : fixing === key ? (
                        <span className="row">
                          <input className="input sm" autoFocus value={fixValue} onChange={(e) => setFixValue(e.target.value)} onKeyDown={(e) => {
                            if (e.key === "Enter" && fixValue.trim()) {
                              decide(i, "correct", fixValue.trim());
                              setFixing(null);
                            } else if (e.key === "Escape") setFixing(null);
                          }} />
                          <button className="btn xs primary" aria-label="Save fix" disabled={!fixValue.trim()} onClick={() => { decide(i, "correct", fixValue.trim()); setFixing(null); }}>
                            <Check size={12} />
                          </button>
                        </span>
                      ) : (
                        <span className="row" style={{ gap: 4 }}>
                          <button className="btn xs soft" onClick={() => { setFixing(key); setFixValue(""); }}>
                            Fix
                          </button>
                          <button className="btn xs" onClick={() => decide(i, "ignore")}>
                            <X size={11} /> Ignore
                          </button>
                          <button className="btn xs danger" onClick={() => decide(i, "exclude")}>
                            <Ban size={11} /> Exclude
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length > 300 && <div className="small muted" style={{ padding: 10 }}>Showing 300 of {fmtInt(list.length)}. Use the Review Queue after a run for the full list.</div>}
        </>
      )}
    </PanelFrame>
  );
}

// ---------------------------------------------------------------- Python
export function PythonPanel() {
  const ws = useWs();
  const [tab, setTab] = useState<"full" | "step" | "spec">("step");
  const code = useMemo(() => generatePython(ws.effective, { version: ws.pipeline.version || 1 }), [ws.effective, ws.pipeline.version]);
  const selStep = ws.sel >= 0 && ws.sel < ws.effective.steps.length ? ws.effective.steps[ws.sel] : undefined;
  const range = selStep ? findStepRange(code, stepFunctionName(selStep, ws.sel)) : undefined;
  const stepCode = range ? code.split("\n").slice(range[0], range[1] + 1).join("\n") : "# Select a pipeline step to see its generated code.";
  const spec = useMemo(() => generatePipelineJson(ws.effective, ws.pipeline.version || 1), [ws.effective, ws.pipeline.version]);
  const shown = tab === "full" ? code : tab === "step" ? stepCode : spec;
  return (
    <PanelFrame
      id="python"
      title="Python code"
      sub="(generated pipeline)"
      icon={<Code2 size={15} color="var(--blue)" />}
      actions={
        <>
          <button className="btn xs" onClick={() => copyText(shown).then(() => useApp.getState().toast("success", "Copied to clipboard"))}>
            <Copy size={12} /> Copy
          </button>
          <Link className="btn xs soft" to={`/pipelines/${ws.pipeline.id}/export`}>
            Export
          </Link>
        </>
      }
    >
      <div style={{ padding: "0 8px" }}>
        <Tabs size="sm" value={tab} onChange={setTab} options={[{ value: "full", label: "Full script" }, { value: "step", label: "Current step" }, { value: "spec", label: "Pipeline spec (JSON)" }]} />
      </div>
      <div style={{ overflow: "auto", height: "calc(100% - 31px)" }}>
        <CodeView code={shown} highlight={tab === "full" ? range : undefined} scrollToLine={tab === "full" ? range?.[0] : undefined} />
      </div>
    </PanelFrame>
  );
}

export function SqlPanel() {
  return (
    <PanelFrame id="sql" title="SQL" icon={<Database size={15} color="var(--muted)" />}>
      <Empty icon={<Database size={22} />} title="SQL generation arrives in V1.x">
        In V1 the pipeline specification compiles to readable pandas Python. SQL (and Polars) targets are planned and will be generated from the same specification.
      </Empty>
    </PanelFrame>
  );
}

export function SpecPanel() {
  const ws = useWs();
  const json = useMemo(() => generatePipelineJson(ws.effective, ws.pipeline.version || 1), [ws.effective, ws.pipeline.version]);
  return (
    <PanelFrame
      id="spec"
      title="Pipeline spec"
      sub="source of truth"
      icon={<FileJson size={15} color="var(--purple)" />}
      actions={
        <button className="btn xs" onClick={() => download("pipeline.json", json, "application/json")}>
          <Download size={12} /> pipeline.json
        </button>
      }
    >
      <CodeView code={json} />
    </PanelFrame>
  );
}

// ---------------------------------------------------------------- Logs & runs
export function LogsPanel() {
  const ws = useWs();
  const run = ws.latestRun;
  const [level, setLevel] = useState<"all" | "info" | "success" | "warning" | "error">("all");
  const logs = run?.logs ?? [];
  const count = (l: string) => logs.filter((x) => x.level === l).length;
  return (
    <PanelFrame
      id="logs"
      title="Run logs"
      icon={<ScrollText size={15} color="var(--muted)" />}
      actions={
        run && (
          <>
            <StatusBadge status={run.status} short />
            {run.finishedAt && <span className="small muted num">{fmtDuration(run.finishedAt - run.startedAt)}</span>}
            <Link className="btn xs" to={`/runs/${run.id}`}>
              View details
            </Link>
          </>
        )
      }
    >
      {!run ? (
        <Empty icon={<ScrollText size={22} />} title="No runs yet" action={<button className="btn sm" onClick={() => useApp.getState().runPipeline(ws.pipeline.id, "test")}>Test run</button>}>
          Test runs execute the draft on a sample; runs execute a saved version on all rows.
        </Empty>
      ) : (
        <>
          <div className="chips" style={{ padding: 8 }}>
            {(["all", "info", "success", "warning", "error"] as const).map((l) => (
              <button key={l} className={`chip ${level === l ? "on" : ""}`} onClick={() => setLevel(l)}>
                {l === "all" ? "All" : l[0].toUpperCase() + l.slice(1)} <span className="count">({l === "all" ? logs.length : count(l)})</span>
              </button>
            ))}
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Step</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {logs
                .filter((l) => level === "all" || l.level === level)
                .map((l, i) => (
                  <tr key={i}>
                    <td className="num small muted">{fmtTime(l.t)}</td>
                    <td>
                      <span className="row small" style={{ gap: 5 }}>
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
        </>
      )}
    </PanelFrame>
  );
}

export function RunsPanel() {
  const ws = useWs();
  const runs = useApp((s) => s.runs.filter((r) => r.pipelineId === ws.pipeline.id));
  return (
    <PanelFrame id="runs" title="Run history" icon={<History size={15} color="var(--muted)" />}>
      {runs.length === 0 ? (
        <Empty icon={<History size={22} />} title="No runs yet" />
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Started</th>
              <th>Mode</th>
              <th>Version</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Rows in</th>
              <th style={{ textAlign: "right" }}>Loaded</th>
              <th style={{ textAlign: "right" }}>Review</th>
              <th style={{ textAlign: "right" }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/runs/${r.id}`}>{fmtDateTime(r.startedAt)}</Link>
                </td>
                <td className="small">{r.mode === "test" ? "Test" : "Manual"}</td>
                <td className="small">{r.mode === "test" ? "Draft" : `v${r.version}`}</td>
                <td>
                  <StatusBadge status={r.status} short />
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {fmtInt(r.rowsIn)}
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {fmtInt(r.rowsOut)}
                </td>
                <td className="num" style={{ textAlign: "right", color: r.reviewCount ? "var(--amber-text)" : undefined }}>
                  {fmtInt(r.reviewCount)}
                </td>
                <td className="num small muted" style={{ textAlign: "right" }}>
                  {r.finishedAt ? fmtDuration(r.finishedAt - r.startedAt) : "…"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelFrame>
  );
}
