import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Play, FileText, Search, X, CheckCircle2, MinusCircle, ListChecks, Loader2, Undo2 } from "lucide-react";
import { useApp } from "@/store/app";
import type { Issue, IssueKind, ReviewAction, ReviewDecision } from "@/engine/types";
import type { Run } from "@/store/model";
import { fingerprint } from "@/engine/load";
import { Empty, StatusBadge } from "@/components/ui";
import { ISSUE_LABEL, upsertDecisions } from "@/lib/review";
import { RuleSuggestions } from "./RuleSuggestions";
import { copyText, fmtDateTime, fmtInt } from "@/lib/format";

interface Item {
  row: number;
  issues: Issue[];
  kind: IssueKind;
  columns: string[];
}

const KIND_TONE: Record<IssueKind, string> = {
  invalid_date: "red",
  invalid_number: "red",
  missing_value: "amber",
  pattern_mismatch: "blue",
  rule_failed: "red",
  other: "",
};

export function ReviewPage() {
  const { runId, id } = useParams();
  const runs = useApp((s) => s.runs);
  const run = runId ? runs.find((r) => r.id === runId) : runs.find((r) => r.pipelineId === id && r.reviewCount > 0) ?? runs.find((r) => r.pipelineId === id);
  const pipelineId = run?.pipelineId ?? id;
  const pipeline = useApp((s) => s.pipelines.find((p) => p.id === pipelineId));

  if (!run)
    return (
      <div className="page">
        <Empty icon={<ListChecks size={22} />} title="Nothing to review yet" action={pipelineId ? <Link className="btn primary" to={`/pipelines/${pipelineId}`}>Open workspace</Link> : <Link className="btn" to="/runs">Runs</Link>}>
          Run the pipeline. Rows that cannot be transformed or validated confidently appear here.
        </Empty>
      </div>
    );
  return <Review run={run} pipelineExists={!!pipeline} />;
}

function Review({ run, pipelineExists }: { run: Run; pipelineExists: boolean }) {
  const nav = useNavigate();
  const pipeline = useApp((s) => s.pipelines.find((p) => p.id === run.pipelineId));
  const updateSpec = useApp((s) => s.updateSpec);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<IssueKind | "all">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(15);
  const [sel, setSel] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [rerunning, setRerunning] = useState(false);

  const items = useMemo<Item[]>(() => {
    const m = new Map<number, Issue[]>();
    for (const i of run.reviewIssues) m.set(i.row, [...(m.get(i.row) ?? []), i]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([row, issues]) => ({ row, issues, kind: issues[0].kind, columns: [...new Set(issues.map((i) => i.column))] }));
  }, [run.reviewIssues]);

  const issueColumns = useMemo(() => {
    const c = new Map<string, number>();
    for (const it of items) for (const col of it.columns) c.set(col, (c.get(col) ?? 0) + 1);
    const order = (c: string) => (run.columns.includes(c) ? run.columns.indexOf(c) : 1000);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k).sort((a, b) => order(a) - order(b));
  }, [items, run.columns]);

  const fp = (row: number) => (run.reviewSource[row] ? fingerprint(run.reviewSource[row]) : undefined);
  const decisionsFor = (row: number): ReviewDecision[] => (pipeline?.spec.reviewDecisions ?? []).filter((d) => d.row === row && (d.fingerprint === undefined || d.fingerprint === fp(row)));
  const isDecided = (it: Item) => {
    const ds = decisionsFor(it.row);
    if (ds.some((d) => d.column === null)) return true;
    return it.columns.every((c) => ds.some((d) => d.column === c));
  };

  const kinds = useMemo(() => {
    const m = new Map<IssueKind, number>();
    for (const it of items) m.set(it.kind, (m.get(it.kind) ?? 0) + 1);
    return m;
  }, [items]);

  const filtered = items.filter((it) => {
    if (tab !== "all" && it.kind !== tab) return false;
    if (!q.trim()) return true;
    const hay = [...(run.reviewSource[it.row] ?? []), ...it.issues.map((i) => i.message)].join(" ").toLowerCase();
    return hay.includes(q.toLowerCase()) || String(it.row) === q.trim();
  });
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageItems = filtered.slice(page * perPage, page * perPage + perPage);
  const selItem = filtered.find((it) => it.row === sel) ?? filtered[0];
  const selIndex = selItem ? filtered.indexOf(selItem) : -1;
  const decidedCount = items.filter(isDecided).length;

  useEffect(() => setPage(0), [tab, q, perPage]);

  const original = (it: Item): string => originalText(run, it);
  const valueOf = (row: number, col: string) => run.reviewValues[row]?.[col] ?? null;

  const record = (decisions: ReviewDecision[], message: string) => {
    if (!pipeline) return;
    updateSpec(pipeline.id, (s) => upsertDecisions(s, decisions));
    toast("success", message);
  };
  const decide = (it: Item, action: ReviewAction, values?: Record<string, string>): ReviewDecision[] => {
    const base = { decidedAt: Date.now(), fingerprint: fp(it.row), issueKind: it.kind };
    if (action === "exclude") return [{ ...base, row: it.row, column: null, action }];
    return it.columns.map((c) => ({ ...base, row: it.row, column: c, action, ...(action === "correct" ? { value: values?.[c] ?? "" } : {}) }));
  };
  const clearDecisions = (row: number) => pipeline && updateSpec(pipeline.id, (s) => ({ ...s, reviewDecisions: s.reviewDecisions.filter((d) => d.row !== row) }));

  const rerun = async () => {
    setRerunning(true);
    const r = await useApp.getState().runPipeline(run.pipelineId, "manual");
    setRerunning(false);
    if (r) nav(`/runs/${r.id}`);
  };

  return (
    <div className="page wide" style={{ paddingBottom: 16 }}>
      <div className="crumbs">
        <Link to="/runs">Runs</Link>/<Link to={`/pipelines/${run.pipelineId}`}>{run.pipelineName}</Link>/<Link to={`/runs/${run.id}`}>{fmtDateTime(run.startedAt)}</Link>/<span className="cur">Review Queue</span>
      </div>
      <div className="page-head" style={{ alignItems: "center" }}>
        <div>
          <div className="row">
            <h1 style={{ fontSize: 24 }}>{run.pipelineName}</h1>
            {run.mode === "test" ? <span className="badge">Test run</span> : <span className="badge outline">v{run.version}</span>}
          </div>
          <div className="row small muted" style={{ marginTop: 6, gap: 14 }}>
            <span>
              Run ID <span className="mono">{run.id}</span>
            </span>
            <StatusBadge status={run.status} />
            {items.length > 0 && (
              <span className="badge amber">
                <AlertTriangle size={13} /> {fmtInt(items.length)} rows need review
              </span>
            )}
          </div>
        </div>
        <div className="actions">
          <Link className="btn" to={`/runs/${run.id}`}>
            <FileText size={15} /> View run summary
          </Link>
          <button className={`btn ${decidedCount ? "primary" : ""}`} onClick={rerun} disabled={rerunning || !pipelineExists}>
            {rerunning ? <Loader2 size={15} className="spin" /> : <Play size={15} />} Rerun with {fmtInt(decidedCount)} decision{decidedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {pipelineExists && items.length > 0 && <RuleSuggestions pipelineId={run.pipelineId} />}
      {items.length === 0 ? (
        <div className="card">
          <Empty icon={<CheckCircle2 size={22} />} title="No rows need review">
            Every row in this run was transformed and validated confidently.
          </Empty>
        </div>
      ) : (
        <div className="split wide-side">
          <div className="card" style={{ minWidth: 0 }}>
            <div className="card-head" style={{ flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: 19 }}>{fmtInt(items.length)} rows need review</h2>
                <div className="small muted">
                  Review values that could not be extracted or validated confidently. {fmtInt(decidedCount)} decided · decisions apply on the next run.
                </div>
              </div>
              <div className="row" style={{ marginLeft: "auto", width: 220 }}>
                <Search size={14} color="var(--subtle)" />
                <input className="input sm" placeholder="Search rows…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="chips" style={{ padding: "10px 16px 0" }}>
              <button className={`chip ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}>
                All ({fmtInt(items.length)})
              </button>
              {[...kinds.entries()].map(([k, n]) => (
                <button key={k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
                  {ISSUE_LABEL[k]} ({fmtInt(n)})
                </button>
              ))}
            </div>
            {checked.size > 0 && (
              <div className="row" style={{ padding: "10px 16px", background: "var(--blue-50)", marginTop: 10 }}>
                <b>{checked.size} selected</b>
                <button className="btn sm" onClick={() => { record(items.filter((i) => checked.has(i.row)).flatMap((i) => decide(i, "exclude")), `Excluded ${checked.size} rows`); setChecked(new Set()); }}>
                  Exclude rows
                </button>
                <button className="btn sm" onClick={() => { record(items.filter((i) => checked.has(i.row)).flatMap((i) => decide(i, "ignore")), `Ignored warnings on ${checked.size} rows`); setChecked(new Set()); }}>
                  Ignore warnings
                </button>
                <button className="btn ghost sm" onClick={() => setChecked(new Set())} style={{ marginLeft: "auto" }}>
                  Clear
                </button>
              </div>
            )}
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        aria-label="Select page"
                        checked={pageItems.length > 0 && pageItems.every((i) => checked.has(i.row))}
                        onChange={(e) => {
                          const next = new Set(checked);
                          pageItems.forEach((i) => (e.target.checked ? next.add(i.row) : next.delete(i.row)));
                          setChecked(next);
                        }}
                      />
                    </th>
                    <th>Row</th>
                    <th>Original</th>
                    {issueColumns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                    <th>Issue</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((it) => (
                    <tr key={it.row} className={`clickable ${selItem?.row === it.row ? "selected" : ""}`} onClick={() => setSel(it.row)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select row ${it.row}`}
                          checked={checked.has(it.row)}
                          onChange={(e) => {
                            const next = new Set(checked);
                            if (e.target.checked) next.add(it.row);
                            else next.delete(it.row);
                            setChecked(next);
                          }}
                        />
                      </td>
                      <td className="num">{it.row}</td>
                      <td className="small ellipsis" style={{ maxWidth: 280 }} title={original(it)}>
                        {original(it)}
                      </td>
                      {issueColumns.map((c) => {
                        const v = valueOf(it.row, c);
                        return (
                          <td key={c} className="small num" style={{ color: it.columns.includes(c) ? "var(--red-text)" : undefined }}>
                            {v ?? "—"}
                          </td>
                        );
                      })}
                      <td>
                        <span className={`badge sm ${KIND_TONE[it.kind]}`}>{ISSUE_LABEL[it.kind]}</span>
                        {it.issues.length > 1 && <span className="tiny muted"> +{it.issues.length - 1}</span>}
                      </td>
                      <td>{isDecided(it) ? <span className="badge green sm">Decided</span> : <span className="badge sm">Pending</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
              <span className="small muted">Rows per page</span>
              <select className="select sm" style={{ width: 70 }} value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                {[15, 30, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <div className="row" style={{ margin: "0 auto" }}>
                <button className="btn ghost sm icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={15} />
                </button>
                <span className="small">
                  Page {page + 1} of {pages}
                </span>
                <button className="btn ghost sm icon" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight size={15} />
                </button>
              </div>
              <span className="small muted">
                Showing {filtered.length ? page * perPage + 1 : 0}–{Math.min(filtered.length, (page + 1) * perPage)} of {fmtInt(filtered.length)}
              </span>
            </div>
          </div>

          {selItem && (
            <ReviewDetail
              key={selItem.row}
              item={selItem}
              run={run}
              index={selIndex}
              total={filtered.length}
              onNav={(d) => {
                const next = filtered[selIndex + d];
                if (next) {
                  setSel(next.row);
                  setPage(Math.floor((selIndex + d) / perPage));
                }
              }}
              decisions={decisionsFor(selItem.row)}
              valueOf={valueOf}
              onDecide={(action, values, similar) => {
                const targets = similar ? items.filter((i) => i.kind === selItem.kind && i.columns.join() === selItem.columns.join()) : [selItem];
                record(targets.flatMap((t) => decide(t, action, values)), similar ? `Applied to ${targets.length} similar rows` : `Decision recorded for row ${selItem.row}`);
                const next = filtered.slice(selIndex + 1).find((i) => !targets.includes(i) && !isDecided(i));
                if (next) setSel(next.row);
              }}
              onClear={() => clearDecisions(selItem.row)}
              similarCount={items.filter((i) => i.kind === selItem.kind && i.columns.join() === selItem.columns.join()).length}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ReviewDetail({
  item,
  run,
  index,
  total,
  onNav,
  decisions,
  valueOf,
  onDecide,
  onClear,
  similarCount,
}: {
  item: Item;
  run: Run;
  index: number;
  total: number;
  onNav: (d: number) => void;
  decisions: ReviewDecision[];
  valueOf: (row: number, col: string) => string | null;
  onDecide: (action: ReviewAction, values: Record<string, string>, similar: boolean) => void;
  onClear: () => void;
  similarCount: number;
}) {
  const [action, setAction] = useState<ReviewAction>("correct");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(item.columns.map((c) => [c, valueOf(item.row, c) ?? ""])));
  const source = run.reviewSource[item.row] ?? [];
  const orig = originalText(run, item);
  const valid = action !== "correct" || item.columns.every((c) => (values[c] ?? "").trim() !== "");
  const existing = decisions[0];

  return (
    <div className="card" style={{ position: "sticky", top: 12 }}>
      <div className="card-head">
        <h3>Review selected row</h3>
        <button className="btn ghost sm icon" aria-label="Previous item" disabled={index <= 0} onClick={() => onNav(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button className="btn ghost sm icon" aria-label="Next item" disabled={index >= total - 1} onClick={() => onNav(1)}>
          <ChevronRight size={15} />
        </button>
        <span className="small muted num">
          {index + 1} of {total}
        </span>
      </div>
      <div className="card-pad col" style={{ gap: 14 }}>
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <h4 className="grow">Original value · row {item.row}</h4>
            <button className="btn ghost xs" onClick={() => copyText(orig)}>
              <Copy size={12} /> Copy
            </button>
          </div>
          <div className="card mono small" style={{ padding: 10, background: "var(--surface-2)", wordBreak: "break-word" }}>
            {orig}
          </div>
          <details style={{ marginTop: 6 }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>
              Full source row
            </summary>
            <div className="kv" style={{ marginTop: 6 }}>
              {run.sourceColumns.map((c, i) => (
                <FragmentKV key={c} k={c} v={source[i] ?? "—"} />
              ))}
            </div>
          </details>
        </div>

        <div>
          <h4 style={{ marginBottom: 6 }}>Values after the pipeline</h4>
          <table className="table compact card" style={{ overflow: "hidden" }}>
            <tbody>
              {item.columns.map((c) => {
                const iss = item.issues.find((i) => i.column === c)!;
                const v = valueOf(item.row, c);
                return (
                  <tr key={c}>
                    <td style={{ fontWeight: 600, width: "32%" }}>{c}</td>
                    <td className="mono small" style={{ color: v === null ? "var(--red-text)" : undefined }}>
                      {v ?? "Not detected"}
                    </td>
                    <td className="small" style={{ color: "var(--red-text)", whiteSpace: "nowrap" }}>
                      <MinusCircle size={13} style={{ verticalAlign: -2 }} /> {ISSUE_LABEL[iss.kind]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="callout red" style={{ flexDirection: "column", gap: 4 }}>
          <div className="row" style={{ fontWeight: 650, fontSize: 14 }}>
            <AlertTriangle size={16} /> {ISSUE_LABEL[item.kind]}
          </div>
          {item.issues.map((i, k) => (
            <div key={k} className="small">
              <b>{i.column}:</b> {i.message}
            </div>
          ))}
          <div className="small" style={{ opacity: 0.85 }}>
            Deterministic rule result — confidence scores apply only to AI-assisted suggestions.
          </div>
        </div>

        {existing ? (
          <div className="callout green">
            <CheckCircle2 size={16} />
            <div className="grow">
              <b>Decision recorded:</b>{" "}
              {decisions.map((d) => (d.action === "correct" ? `${d.column} → “${d.value}”` : d.action === "exclude" ? "exclude row" : `${d.action} ${d.column}`)).join(", ")}
              <div className="small">Applies on the next run while this source row is unchanged.</div>
            </div>
            <button className="btn xs" onClick={onClear}>
              <Undo2 size={12} /> Undo
            </button>
          </div>
        ) : (
          <div>
            <h4 style={{ marginBottom: 8 }}>What would you like to do?</h4>
            <div className="col" style={{ gap: 8 }}>
              <label className="row" style={{ alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="radio" checked={action === "correct"} onChange={() => setAction("correct")} style={{ marginTop: 3 }} />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Correct value</div>
                  {action === "correct" &&
                    item.columns.map((c) => (
                      <div key={c} className="row" style={{ marginTop: 6 }}>
                        <span className="small muted" style={{ width: 90 }}>
                          {c}
                        </span>
                        <input className="input sm" value={values[c] ?? ""} placeholder={c.includes("date") ? "YYYY-MM-DD" : "Corrected value"} onChange={(e) => setValues({ ...values, [c]: e.target.value })} />
                      </div>
                    ))}
                </div>
              </label>
              <Option on={action === "keep"} set={() => setAction("keep")} t="Keep original" d="Keep the original value as it is" />
              <Option on={action === "exclude"} set={() => setAction("exclude")} t="Exclude row" d="Remove this row from the pipeline output" />
              <Option on={action === "ignore"} set={() => setAction("ignore")} t="Ignore warning" d="Load the row with the transformed value" />
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary grow" disabled={!valid} onClick={() => onDecide(action, values, false)}>
                Apply decision
              </button>
              <button className="btn grow" disabled={action === "correct" || similarCount < 2} title={action === "correct" ? "Corrections are row-specific" : undefined} onClick={() => onDecide(action, values, true)}>
                Apply to {similarCount} similar rows
              </button>
            </div>
          </div>
        )}
        <div className="small muted row" style={{ gap: 6 }}>
          <X size={12} /> Decisions are stored in the pipeline (auditable in versions) and never modify the source file.
        </div>
      </div>
    </div>
  );
}

/** The source cell a flagged value came from (e.g. the Details text an invoice date was extracted from). */
function originalText(run: Run, it: Item): string {
  const src = run.reviewSource[it.row] ?? [];
  for (const i of it.issues) {
    const v = i.value === null ? null : String(i.value);
    if (v === null) continue;
    const hit = src.find((s) => s !== null && s.includes(v));
    if (hit) return hit;
  }
  const v = it.issues[0].value;
  return v === null ? "(blank)" : String(v);
}

function Option({ on, set, t, d }: { on: boolean; set: () => void; t: string; d: string }) {
  return (
    <label className="row" style={{ alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <input type="radio" checked={on} onChange={set} style={{ marginTop: 3 }} />
      <div>
        <div style={{ fontWeight: 600 }}>{t}</div>
        <div className="small muted">{d}</div>
      </div>
    </label>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div className="ellipsis">{k}</div>
      <div className="small" style={{ wordBreak: "break-word" }}>
        {v}
      </div>
    </>
  );
}
