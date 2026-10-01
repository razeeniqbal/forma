// Pipeline view (level 1 of PIPELINE → PREVIEW → EXPAND): the ordered flow of steps with status and row impact.
// Not a node editor: steps are an ordered list, connectors carry row counts, and there are no handles or free canvas.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Maximize2, Pencil, X, AlertTriangle, XCircle, CheckCircle2, Loader2, Circle, ArrowDownToLine, Database, ListChecks, Rows3, LayoutList, Trash2 } from "lucide-react";
import type { Dataset, Step, StepResult } from "@/engine/types";
import { describeStep, STAGE_OF, stepColumns, stepTitle } from "@/engine/registry";
import { toText } from "@/engine/values";
import { useApp, type LiveRun } from "@/store/app";
import type { Run } from "@/store/model";
import { FileIcon } from "@/components/ui";
import { fmtDuration, fmtInt, fmtTime } from "@/lib/format";
import { useWs, SOURCE } from "./context";
import { InspectorPanel } from "./panels/InspectorPanel";
import { SheetSelect } from "./SheetSelect";

export type NodeStatus = "draft" | "ready" | "review" | "failed" | "pending" | "running" | "success" | "skipped" | "idle";

export interface FlowNode {
  /** SOURCE (-1), step index, or the step count for Load. */
  index: number;
  num: string;
  stage: string;
  title: string;
  detail: string;
  status: NodeStatus;
  rowsIn?: number;
  rowsOut?: number;
  /** Distinct rows this step sent to review. */
  reviewRows?: number;
  durationMs?: number;
  error?: string;
  step?: Step;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  review: "Review",
  failed: "Failed",
  pending: "Pending",
  running: "Running",
  success: "Success",
  skipped: "Skipped",
  idle: "Not set",
};

const STEP_MS = 260;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals real progress events at a readable pace. Events (source loaded, each step finished) come from the
 * engine as they happen; small runs finish in milliseconds, so they are shown one step at a time. Numbers and
 * durations are the engine's own.
 */
function usePacedEvents(live: LiveRun | undefined): number {
  const [shown, setShown] = useState({ runId: "", n: 0 });
  const n = shown.runId === live?.runId ? shown.n : 0;
  const available = live?.events.length ?? 0;
  useEffect(() => {
    if (!live) return;
    if (n >= available) return;
    if (reducedMotion()) {
      setShown({ runId: live.runId, n: available });
      return;
    }
    const t = setTimeout(() => setShown({ runId: live.runId, n: n + 1 }), STEP_MS);
    return () => clearTimeout(t);
  }, [live, n, available]);
  return n;
}

/** Distinct rows per step id among issues of rows held for review. */
function reviewRowsByStep(issues: { stepId: string; row: number }[], held?: Set<number>): Map<string, number> {
  const rows = new Map<string, Set<number>>();
  for (const i of issues) {
    if (held && !held.has(i.row)) continue;
    if (!rows.has(i.stepId)) rows.set(i.stepId, new Set());
    rows.get(i.stepId)!.add(i.row);
  }
  return new Map([...rows].map(([k, v]) => [k, v.size]));
}

export interface FlowState {
  nodes: FlowNode[];
  /** What the numbers describe. */
  basis: { kind: "live"; live: LiveRun; revealed: number } | { kind: "run"; run: Run } | { kind: "preview"; sampled: boolean; loading: boolean };
  run?: Run;
}

/** Status and row impact for every node, from the live run, the latest run of this spec, or the live preview. */
export function useFlow(): FlowState {
  const ws = useWs();
  const live = useApp((s) => s.liveRuns[ws.pipeline.id]);
  const runs = useApp((s) => s.runs);
  const revealed = usePacedEvents(live);
  const p = ws.pipeline;
  const steps = ws.effective.steps;
  const preview = ws.preview;
  const latest = runs.find((r) => r.pipelineId === p.id);
  // A run describes the current pipeline when nothing was edited after it started.
  const current = latest && latest.status !== "running" && latest.startedAt >= p.updatedAt - 1 && !ws.draft ? latest : undefined;
  const liveActive = !!live && (live.status === "running" || revealed < live.events.length);

  return useMemo<FlowState>(() => {
    const src = ws.spec.source;
    const dest = ws.spec.destination;
    const base = (index: number): FlowNode => {
      if (index === SOURCE)
        return {
          index,
          num: "01",
          stage: "Source",
          title: src ? `${src.file}${src.sheet ? ` / ${src.sheet}` : ""}` : "Choose a source",
          detail: src ? `${src.type === "excel" ? "Excel" : src.type.toUpperCase()} · header row ${src.headerRow + 1}` : "",
          status: src ? "ready" : "idle",
        };
      if (index >= steps.length)
        return {
          index,
          num: String(steps.length + 2).padStart(2, "0"),
          stage: "Load",
          title: dest ? (dest.type === "database" ? dest.table || "Database table" : dest.path || `${(dest.format ?? "csv").toUpperCase()} file`) : "Set destination",
          detail: dest ? (dest.type === "database" ? "database" : `${(dest.format ?? "csv").toUpperCase()} file`) : "Rows that pass review are loaded here",
          status: dest ? "ready" : "idle",
        };
      const step = steps[index];
      return { index, num: String(index + 2).padStart(2, "0"), stage: STAGE_OF[step.type], title: stepTitle(step), detail: describeStep(step).detail, status: "ready", step };
    };
    const all = [SOURCE, ...steps.map((_, i) => i), steps.length].map(base);

    if (liveActive && live) {
      const evs = live.events.slice(0, revealed);
      const loaded = evs.find((e) => e.kind === "loaded");
      const done = new Map<number, StepResult>();
      for (const e of evs) if (e.kind === "step") done.set(e.index, e.result);
      let runningSet = false;
      const nodes = all.map((n) => {
        if (n.index === SOURCE) {
          if (loaded && loaded.kind === "loaded") return { ...n, status: "success" as const, rowsOut: loaded.rows };
          runningSet = true;
          return { ...n, status: "running" as const };
        }
        const r = done.get(n.index);
        if (r) return { ...n, status: (r.error ? (r.error.startsWith("Skipped") ? "skipped" : "failed") : r.issues ? "review" : "success") as NodeStatus, rowsIn: r.rowsIn, rowsOut: r.rowsOut, durationMs: r.durationMs, error: r.error, reviewRows: undefined };
        if (!runningSet) {
          runningSet = true;
          const prev = n.index === 0 ? (loaded?.kind === "loaded" ? loaded.rows : undefined) : done.get(n.index - 1)?.rowsOut;
          return { ...n, status: "running" as const, rowsIn: prev };
        }
        return { ...n, status: "pending" as const };
      });
      return { nodes, basis: { kind: "live", live, revealed }, run: runs.find((r) => r.id === live.runId) };
    }

    if (current) {
      const byStep = reviewRowsByStep(current.reviewIssues);
      const res = new Map(current.steps.map((s) => [s.stepId, s]));
      const nodes = all.map<FlowNode>((n) => {
        if (n.index === SOURCE) return { ...n, status: current.status === "failed" && !current.steps.length ? "failed" : "success", rowsOut: current.rowsIn };
        if (!n.step)
          return {
            ...n,
            status: current.status === "failed" ? "skipped" : current.reviewCount ? "review" : "success",
            rowsIn: current.rowsOut + current.reviewCount,
            rowsOut: current.rowsOut,
            reviewRows: current.reviewCount,
          };
        const r = res.get(n.step.id);
        if (!r) return { ...n, status: "pending" };
        const review = byStep.get(n.step.id) ?? 0;
        return {
          ...n,
          status: r.error ? (r.error.startsWith("Skipped") ? "skipped" : "failed") : review || r.issues ? "review" : "success",
          rowsIn: r.rowsIn,
          rowsOut: r.rowsOut,
          reviewRows: review,
          durationMs: r.durationMs,
          error: r.error,
        };
      });
      return { nodes, basis: { kind: "run", run: current }, run: current };
    }

    const result = preview.result;
    const held = new Set(result?.reviewRows ?? []);
    const byStep = result ? reviewRowsByStep(result.issues, held) : new Map<string, number>();
    const nodes = all.map<FlowNode>((n) => {
      if (n.index === SOURCE) return { ...n, rowsOut: result?.input.rows.length };
      if (!n.step) return result ? { ...n, rowsIn: result.beforeGate.rows.length, rowsOut: result.output.rows.length, reviewRows: result.reviewRows.length } : n;
      const r = result?.steps[n.index];
      const isDraft = ws.draft?.index === n.index;
      if (!r) return { ...n, status: isDraft ? "draft" : n.status };
      const review = byStep.get(n.step.id) ?? 0;
      return {
        ...n,
        status: isDraft ? "draft" : r.error ? (r.error.startsWith("Skipped") ? "skipped" : "failed") : review || r.issues ? "review" : "ready",
        rowsIn: r.rowsIn,
        rowsOut: r.rowsOut,
        reviewRows: review,
        durationMs: r.durationMs,
        error: r.error,
      };
    });
    return { nodes, basis: { kind: "preview", sampled: preview.sampled, loading: preview.loading }, run: latest };
  }, [ws.spec.source, ws.spec.destination, ws.draft, steps, preview, live, liveActive, revealed, current, latest, runs]);
}

function StatusChip({ status }: { status: NodeStatus }) {
  const icon =
    status === "running" ? (
      <Loader2 size={12} className="spin" />
    ) : status === "success" || status === "ready" ? (
      <CheckCircle2 size={12} />
    ) : status === "review" ? (
      <AlertTriangle size={12} />
    ) : status === "failed" ? (
      <XCircle size={12} />
    ) : (
      <Circle size={12} />
    );
  return (
    <span className={`st-chip ${status}`}>
      {icon}
      {STATUS_LABEL[status]}
    </span>
  );
}

type Density = "cards" | "compact";
const DENSITY_KEY = "forma.flowDensity";
function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "cards";
  } catch {
    return "cards";
  }
}

export function PipelineView({ onExpand }: { onExpand: (index: number) => void }) {
  const ws = useWs();
  const flow = useFlow();
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [density, setDensityState] = useState<Density>(readDensity);
  const setDensity = (d: Density) => {
    setDensityState(d);
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      /* per-viewer preference only */
    }
  };
  const total = ws.effective.steps.length;
  // A draft (new or edited step) always shows its editor beside the flow.
  const showEditor = !!ws.draft || editing;
  const selected = ws.draft ? ws.draft.index : open;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ws.draft || open === null || (e.target as HTMLElement).closest?.("input,textarea,select")) return;
      if (e.key === "Escape") {
        setOpen(null);
        setEditing(false);
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !editing) {
        // Walk the pipeline with the preview open.
        e.preventDefault();
        const next = Math.max(SOURCE, Math.min(total, open + (e.key === "ArrowDown" ? 1 : -1)));
        setOpen(next);
        ws.setSel(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ws, editing, total]);

  const select = (i: number) => {
    if (ws.draft) return;
    setEditing(false);
    setOpen((o) => (o === i ? null : i));
    ws.setSel(i);
  };
  const addAfter = (i: number) => {
    if (ws.draft) return;
    ws.setSel(i);
    ws.openPicker();
  };

  const run = flow.run;
  const basis = flow.basis;
  const remoteRunning = useApp((s) => s.runs.find((r) => r.pipelineId === ws.pipeline.id && r.status === "running" && r.remoteId));

  return (
    <div className={`flow-wrap ${selected !== null ? "with-side" : ""}`}>
      <div className="flow-canvas" aria-label="Pipeline flow">
        <div className="flow-bar">
          <FlowBasis flow={flow} />
          <div className="seg sm" role="group" aria-label="Density" style={{ marginLeft: "auto" }}>
            <button className={density === "cards" ? "on" : ""} onClick={() => setDensity("cards")} title="Step cards">
              <LayoutList size={13} /> Cards
            </button>
            <button className={density === "compact" ? "on" : ""} onClick={() => setDensity("compact")} title="Compact overview">
              <Rows3 size={13} /> Compact
            </button>
          </div>
        </div>
        {remoteRunning ? (
          <div className="run-banner running" role="status">
            <Loader2 size={14} className="spin" />
            <span>Running on the FORMA Server · step results appear when the server finishes</span>
            <Link className="btn ghost xs" to={`/runs/${remoteRunning.id}`} style={{ marginLeft: "auto" }}>
              View run
            </Link>
          </div>
        ) : basis.kind === "live" || (basis.kind === "run" && run) ? (
          <RunBanner flow={flow} />
        ) : null}
        <ol className={`flow ${density}`} role="list">
          {flow.nodes.map((n, k) => {
            const next = flow.nodes[k + 1];
            const isLoad = n.index === total;
            return (
              <Fragment key={n.step?.id ?? (n.index === SOURCE ? "source" : "load")}>
                <li>
                  <FlowCard node={n} active={selected === n.index} onClick={() => select(n.index)} density={density} pipelineId={ws.pipeline.id} runId={run?.id} basisKind={basis.kind} />
                </li>
                {!isLoad && next && total === 0 && !ws.draft && basis.kind !== "live" && (
                  <li className="flow-empty">
                    <div>
                      <b>Shape this data step by step.</b> Add the first transformation — or open the{" "}
                      <button className="link" onClick={() => onExpand(total)}>
                        Analyst workbench
                      </button>{" "}
                      and click a column to transform it directly.
                    </div>
                    <button className="btn primary sm" onClick={() => addAfter(SOURCE)}>
                      <Plus size={14} /> Add step
                    </button>
                  </li>
                )}
                {!isLoad && next && (
                  <li className={`flow-link ${next.status === "running" ? "flowing" : ""} ${n.status === "pending" ? "dim" : ""}`} aria-hidden={density === "compact"}>
                    <span className="flow-rows">{n.rowsOut !== undefined ? `${fmtInt(n.rowsOut)} rows` : ""}</span>
                    <button className="flow-add" onClick={() => addAfter(n.index)} disabled={!!ws.draft || basis.kind === "live"} aria-label={`Add a step after ${n.stage}`} title="Add a step here">
                      <Plus size={12} />
                    </button>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>
      {selected !== null && (
        <aside className={`flow-side ${showEditor ? "editing" : ""}`} aria-label="Step preview">
          {showEditor ? (
            <div className="flow-editor">
              {!ws.draft && (
                <button className="btn ghost xs flow-side-back" onClick={() => setEditing(false)}>
                  ← Preview
                </button>
              )}
              <InspectorPanel />
            </div>
          ) : (
            <StepPreview
              node={flow.nodes.find((n) => n.index === selected)!}
              flow={flow}
              onClose={() => setOpen(null)}
              onEdit={() => (selected >= 0 && selected < total ? ws.editStep(selected) : setEditing(true))}
              onExpand={() => onExpand(selected)}
            />
          )}
        </aside>
      )}
    </div>
  );
}

function FlowBasis({ flow }: { flow: FlowState }) {
  const b = flow.basis;
  if (b.kind === "live") return <span className="flow-basis live">Running {b.live.mode === "test" ? "test run" : "pipeline"}…</span>;
  if (b.kind === "run")
    return (
      <span className="flow-basis">
        Showing {b.run.mode === "test" ? "test run" : `run of v${b.run.version}`} · {fmtTime(b.run.startedAt).slice(0, 5)}
      </span>
    );
  return (
    <span className="flow-basis">
      {b.loading ? <Loader2 size={12} className="spin" /> : null} Live preview{b.sampled ? " · sample" : " · all rows"}
    </span>
  );
}

function RunBanner({ flow }: { flow: FlowState }) {
  const b = flow.basis;
  const run = flow.run;
  if (b.kind === "live") {
    const steps = b.live.total + 1;
    const done = Math.min(b.revealed, steps);
    return (
      <div className="run-banner running" role="status">
        <Loader2 size={14} className="spin" />
        <span>
          {b.live.mode === "test" ? "Test run" : "Run"} in progress · step {Math.min(done + 1, steps)} of {steps}
        </span>
        <span className="run-progress" aria-hidden>
          <span style={{ width: `${(done / steps) * 100}%` }} />
        </span>
      </div>
    );
  }
  if (!run) return null;
  return (
    <div className={`run-banner ${run.status}`} role="status">
      {run.status === "failed" ? <XCircle size={14} /> : run.status === "review" ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      <span className="run-nums">
        <b>{fmtInt(run.rowsIn)}</b> input · <b>{fmtInt(run.rowsOut)}</b> {run.status === "failed" ? "loaded" : "ready"}
        {run.reviewCount > 0 && (
          <>
            {" "}
            · <Link to={`/runs/${run.id}/review`}>{fmtInt(run.reviewCount)} review</Link>
          </>
        )}
        {run.excludedCount > 0 && <span className="subtle"> · {fmtInt(run.excludedCount)} excluded</span>}
        {run.finishedAt && <span className="subtle"> · {fmtDuration(run.finishedAt - run.startedAt)}</span>}
      </span>
      <Link className="btn ghost xs" to={`/runs/${run.id}`} style={{ marginLeft: "auto" }}>
        View run
      </Link>
    </div>
  );
}

function FlowCard({
  node,
  active,
  onClick,
  density,
  pipelineId,
  runId,
  basisKind,
}: {
  node: FlowNode;
  active: boolean;
  onClick: () => void;
  density: Density;
  pipelineId: string;
  runId?: string;
  basisKind: FlowState["basis"]["kind"];
}) {
  const isSource = node.index === SOURCE;
  const isLoad = !node.step && !isSource;
  const ready = node.rowsOut !== undefined && node.reviewRows ? node.rowsOut - (isLoad ? 0 : node.reviewRows) : node.rowsOut;
  const reviewHref = runId && basisKind !== "preview" ? `/runs/${runId}/review${node.step ? `?step=${node.step.id}` : ""}` : `/pipelines/${pipelineId}/review`;
  return (
    <div
      className={`flow-card ${node.status} ${active ? "on" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${node.num} ${node.stage}: ${node.title} — ${STATUS_LABEL[node.status]}`}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
    >
      <div className="fc-head">
        <span className="fc-num">{node.num}</span>
        <span className="fc-stage">{node.stage}</span>
        {density === "compact" && <span className="fc-title-inline clamp-1">{node.title}</span>}
        <StatusChip status={node.status} />
      </div>
      {density === "cards" && (
        <>
          <div className="fc-title clamp-1">
            {isSource && <FileIcon kind={node.title.endsWith(".csv") ? "csv" : "excel"} />}
            {isLoad && (node.title.includes(".") ? <ArrowDownToLine size={14} /> : <Database size={14} />)}
            {node.title}
          </div>
          {node.detail && <div className="fc-detail clamp-1">{node.detail}</div>}
        </>
      )}
      {(node.rowsOut !== undefined || node.status === "running" || node.error) && (
        <div className="fc-metrics">
          {node.status === "running" ? (
            <span>{node.rowsIn !== undefined ? `${fmtInt(node.rowsIn)} rows in · processing` : "loading"}</span>
          ) : node.error ? (
            <span className="err clamp-1">{node.error}</span>
          ) : isSource ? (
            <span>
              <b>{fmtInt(node.rowsOut!)}</b> rows
            </span>
          ) : (
            <>
              {node.rowsIn !== undefined && node.rowsIn !== node.rowsOut && !isLoad && (
                <span>
                  {fmtInt(node.rowsIn)} → <b>{fmtInt(node.rowsOut!)}</b> rows
                </span>
              )}
              {(node.rowsIn === node.rowsOut || isLoad) && (
                <span>
                  <b>{fmtInt(ready ?? 0)}</b> {isLoad ? (basisKind === "preview" ? "to load" : "loaded") : "ready"}
                </span>
              )}
              {node.reviewRows ? (
                <Link className="fc-review" to={reviewHref} onClick={(e) => e.stopPropagation()}>
                  <AlertTriangle size={12} /> {fmtInt(node.reviewRows)} review
                </Link>
              ) : null}
              {node.durationMs !== undefined && basisKind !== "preview" && <span className="subtle">{fmtDuration(node.durationMs)}</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Example rows: values the step read and what it produced. */
function useExamples(index: number): { inCols: string[]; outCols: string[]; rows: { input: (string | null)[]; output: (string | null)[] }[]; removed: number } | null {
  const ws = useWs();
  const before = ws.datasetBefore(index);
  const after = ws.datasetAfter(index);
  const step = ws.effective.steps[index];
  return useMemo(() => {
    if (!step || !before || !after) return null;
    const read = stepColumns(step).filter((c) => before.columns.includes(c));
    const added = after.columns.filter((c) => !before.columns.includes(c));
    const bIdx = new Map(before.rowIds.map((r, i) => [r, i]));
    const changed = after.columns.filter((c) => {
      if (added.includes(c) || !before.columns.includes(c)) return false;
      const bc = before.columns.indexOf(c);
      const ac = after.columns.indexOf(c);
      for (let i = 0; i < Math.min(after.rows.length, 400); i++) {
        const b = bIdx.get(after.rowIds[i]);
        if (b !== undefined && toText(before.rows[b][bc]) !== toText(after.rows[i][ac])) return true;
      }
      return false;
    });
    const inCols = (read.length ? read : changed).slice(0, 3);
    const outCols = [...added, ...changed].slice(0, 4);
    const rows: { input: (string | null)[]; output: (string | null)[] }[] = [];
    if (inCols.length && outCols.length)
      for (let i = 0; i < after.rows.length && rows.length < 3; i++) {
        const b = bIdx.get(after.rowIds[i]);
        if (b === undefined) continue;
        const input = inCols.map((c) => toText(before.rows[b][before.columns.indexOf(c)]));
        const output = outCols.map((c) => toText(after.rows[i][after.columns.indexOf(c)]));
        if (output.every((v) => v === null)) continue;
        rows.push({ input, output });
      }
    return { inCols, outCols, rows, removed: before.rows.length - after.rows.length };
  }, [step, before, after]);
}

function StepPreview({ node, flow, onClose, onEdit, onExpand }: { node: FlowNode; flow: FlowState; onClose: () => void; onEdit: () => void; onExpand: () => void }) {
  const ws = useWs();
  const isSource = node.index === SOURCE;
  const isLoad = !node.step && !isSource;
  const live = flow.basis.kind === "live";
  return (
    <div className="sp" key={node.index}>
      <div className="sp-head">
        <span className="fc-num">{node.num}</span>
        <span className="sp-crumb">/ {node.stage.toUpperCase()}</span>
        <StatusChip status={node.status} />
        <button className="btn ghost xs icon" aria-label="Close preview" onClick={onClose} style={{ marginLeft: "auto" }}>
          <X size={14} />
        </button>
      </div>
      <h2 className="sp-title">{node.title}</h2>
      {node.detail && <div className="sp-detail">{node.detail}</div>}

      {node.status === "running" ? (
        <div className="sp-running">
          <Loader2 size={16} className="spin" />
          <div>
            <b>{isSource ? "Loading the source" : `Running ${node.stage.toLowerCase()}`}</b>
            <div className="small muted">
              {node.rowsIn !== undefined ? `${fmtInt(node.rowsIn)} rows in. ` : ""}This step reports its results when it completes.
            </div>
          </div>
        </div>
      ) : node.status === "pending" ? (
        <div className="small muted">Waiting for the previous steps.</div>
      ) : (
        <>
          {isSource && <SourceBody />}
          {node.step && <StepBody index={node.index} />}
          {isLoad && <LoadBody node={node} />}
          <Metrics node={node} isSource={isSource} isLoad={isLoad} />
          {node.error && (
            <div className="callout red">
              <XCircle size={16} /> {node.error}
            </div>
          )}
          {node.reviewRows ? (
            <Link className="callout amber sp-review" to={flow.run && flow.basis.kind !== "preview" ? `/runs/${flow.run.id}/review${node.step ? `?step=${node.step.id}` : ""}` : `/pipelines/${ws.pipeline.id}/review`}>
              <ListChecks size={16} />
              <span>
                <b>{fmtInt(node.reviewRows)} rows need review</b>
                <span className="small"> — open the review queue{node.step ? " for this step" : ""}</span>
              </span>
            </Link>
          ) : null}
        </>
      )}

      <div className="sp-actions">
        <button className="btn" onClick={onEdit} disabled={live}>
          <Pencil size={14} /> Edit
        </button>
        <button className="btn primary" onClick={onExpand}>
          <Maximize2 size={14} /> Expand
        </button>
        {node.step && (
          <button className="btn ghost icon" aria-label="Delete step" title="Delete step" disabled={live} onClick={() => (ws.removeStep(node.index), onClose())} style={{ marginLeft: "auto" }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Metrics({ node, isSource, isLoad }: { node: FlowNode; isSource: boolean; isLoad: boolean }) {
  if (node.rowsOut === undefined) return null;
  const cells: [string, string][] = isSource
    ? [["rows", fmtInt(node.rowsOut)]]
    : [
        ...(node.rowsIn !== undefined ? ([["input", fmtInt(node.rowsIn)]] as [string, string][]) : []),
        [isLoad ? "ready to load" : "ready", fmtInt(node.rowsOut - (isLoad ? 0 : node.reviewRows ?? 0))],
        ["review", fmtInt(node.reviewRows ?? 0)],
        ...(node.durationMs !== undefined ? ([["time", fmtDuration(node.durationMs)]] as [string, string][]) : []),
      ];
  return (
    <dl className="sp-metrics">
      {cells.map(([k, v]) => (
        <div key={k} className={k === "review" && v !== "0" ? "amber" : ""}>
          <dd>{v}</dd>
          <dt>{k}</dt>
        </div>
      ))}
    </dl>
  );
}

function StepBody({ index }: { index: number }) {
  const ex = useExamples(index);
  const ws = useWs();
  const step = ws.effective.steps[index];
  if (step?.type === "validate") {
    const results = ws.preview.result?.ruleResults ?? [];
    return (
      <ul className="sp-rules">
        {step.rules.map((r) => {
          const rr = results.find((x) => x.ruleId === r.id);
          const failed = rr ? rr.evaluated - rr.passed : 0;
          return (
            <li key={r.id}>
              <span className="mono">{r.column}</span> <span className="muted">{("description" in r && r.description) || r.kind.replace(/_/g, " ")}</span>
              <span className={`num ${failed ? "amber" : "subtle"}`}>{rr ? (failed ? `${fmtInt(failed)} fail` : "all pass") : ""}</span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (!ex) return null;
  if (!ex.rows.length)
    return ex.removed ? (
      <div className="small muted">{fmtInt(ex.removed)} rows removed by this step.</div>
    ) : (
      <div className="small subtle">No visible change in the preview sample.</div>
    );
  return (
    <div className="sp-examples" aria-label="Example input and output">
      {ex.rows.map((r, i) => (
        <div key={i} className="sp-ex">
          <div className="sp-io">
            <span className="sp-io-label">Input</span>
            {ex.inCols.map((c, k) => (
              <div key={c} className="sp-val" title={c}>
                {ex.inCols.length > 1 && <span className="sp-col">{c}</span>}
                <span className="mono">{r.input[k] ?? <i className="subtle">blank</i>}</span>
              </div>
            ))}
          </div>
          <div className="sp-io out">
            <span className="sp-io-label">Output</span>
            {ex.outCols.map((c, k) => (
              <div key={c} className="sp-val" title={c}>
                <span className="sp-col">{c}</span>
                <span className="mono">{r.output[k] ?? <i className="subtle">blank</i>}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceBody() {
  const ws = useWs();
  const input = ws.preview.result?.input;
  return (
    <div className="col" style={{ gap: 10 }}>
      <SheetSelect showCount />
      {input && (
        <div className="small muted">
          {input.columns.length} columns: <span className="mono">{input.columns.slice(0, 6).join(", ")}{input.columns.length > 6 ? "…" : ""}</span>
        </div>
      )}
      {input && input.rows.length > 0 && <MiniTable ds={input} />}
    </div>
  );
}

function LoadBody({ node }: { node: FlowNode }) {
  const ws = useWs();
  const out = ws.preview.result?.output;
  return (
    <div className="col" style={{ gap: 10 }}>
      {!ws.spec.destination && <div className="small muted">No destination yet — choose where rows that pass review are written. Edit to set one.</div>}
      {out && out.rows.length > 0 && <MiniTable ds={out} />}
      {node.reviewRows ? <div className="small muted">Rows needing review are held back and never loaded until resolved.</div> : null}
    </div>
  );
}

function MiniTable({ ds }: { ds: Dataset }) {
  const cols = ds.columns.slice(0, 4);
  return (
    <div className="mini-table">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ds.rows.slice(0, 4).map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className="mono">
                  {toText(r[ds.columns.indexOf(c)]) ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
