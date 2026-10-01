// Pipeline view (level 1 of CANVAS → NODE → PREVIEW → EXPAND): the data flow on a free-movable canvas,
// with status and row impact per step. Status comes from the live run, the latest run of this spec,
// or the live preview. Layout lives in the canvas state and never changes execution.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Maximize2, Pencil, X, AlertTriangle, XCircle, CheckCircle2, Loader2, ListChecks, Trash2 } from "lucide-react";
import type { Dataset, Step, StepResult } from "@/engine/types";
import { describeStep, STAGE_OF, stepColumns, stepTitle } from "@/engine/registry";
import { toText } from "@/engine/values";
import { useApp, type LiveRun } from "@/store/app";
import type { Run } from "@/store/model";
import { deriveGraph, LOAD_ID, SOURCE_ID, type PipelineNode } from "@/canvas/graph";
import { PipelineCanvas, StatusChip } from "./canvas/PipelineCanvas";
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

/** Graph node id of a flow node index (main chain). */
const idOfIndex = (index: number, steps: Step[]) => (index === SOURCE ? SOURCE_ID : index >= steps.length ? LOAD_ID : steps[index].id);

export function PipelineView({ onExpand }: { onExpand: (index: number) => void }) {
  const ws = useWs();
  const flow = useFlow();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const steps = ws.effective.steps;
  const total = steps.length;
  const graph = useMemo(() => deriveGraph(ws.effective), [ws.effective]);
  const indexOf = useCallback((id: string) => graph.nodes.find((n) => n.id === id)?.index, [graph]);
  // Supporting sources select the first step that reads them.
  const sideConsumer = (id: string) => {
    const g = graph.nodes.find((n) => n.id === id);
    return g?.side ? steps.findIndex((s) => s.id === g.side!.consumers[0]) : undefined;
  };
  // A draft (new or edited step) always shows its editor beside the canvas.
  const showEditor = !!ws.draft || editing;
  const selectedId = ws.draft ? idOfIndex(ws.draft.index, steps) : openId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ws.draft || openId === null || (e.target as HTMLElement).closest?.("input,textarea,select")) return;
      if (e.key === "Escape") {
        setOpenId(null);
        setEditing(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, ws.draft]);

  const open = useCallback(
    (id: string | null) => {
      if (ws.draft) return;
      setEditing(false);
      setOpenId(id);
      if (id === null) return;
      const i = indexOf(id) ?? sideConsumer(id);
      if (i !== undefined && i >= -1) ws.setSel(i);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.draft, ws.setSel, indexOf, graph],
  );
  const expand = (id: string) => {
    const i = indexOf(id) ?? sideConsumer(id);
    if (i !== undefined && i >= -1) onExpand(i);
  };
  const addAfter = useCallback(
    (i: number) => {
      if (ws.draft) return;
      ws.setSel(i);
      ws.openPicker();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.draft, ws.setSel, ws.openPicker],
  );

  const remoteRunning = useApp((s) => s.runs.find((r) => r.pipelineId === ws.pipeline.id && r.status === "running" && r.remoteId));
  const basis = flow.basis;
  const run = flow.run;
  const openNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined;
  const openView = openNode?.index !== undefined ? flow.nodes.find((n) => n.index === openNode.index) : undefined;

  return (
    <div className={`flow-wrap ${selectedId ? "with-side" : ""}`}>
      <div className="flow-stage" aria-label="Pipeline flow">
        <div className="flow-overlay">
          <FlowBasis flow={flow} />
          {remoteRunning ? (
            <div className="run-banner running" role="status">
              <Loader2 size={14} className="spin" />
              <span>Running on the FORMA Server. Step results appear when the server finishes.</span>
              <Link className="btn ghost xs" to={`/runs/${remoteRunning.id}`} style={{ marginLeft: "auto" }}>
                View run
              </Link>
            </div>
          ) : basis.kind === "live" || (basis.kind === "run" && run) ? (
            <RunBanner flow={flow} />
          ) : null}
          {total === 0 && !ws.draft && basis.kind !== "live" && (
            <div className="flow-empty">
              <div>
                <b>Shape this data step by step.</b> Add the first transformation, or open the{" "}
                <button className="link" onClick={() => onExpand(total)}>
                  Analyst workbench
                </button>{" "}
                and click a column to transform it directly.
              </div>
              <button className="btn primary sm" onClick={() => addAfter(SOURCE)}>
                <Plus size={14} /> Add step
              </button>
            </div>
          )}
        </div>
        <PipelineCanvas flow={flow} openId={selectedId} onOpen={open} onExpand={expand} onAddAfter={addAfter} />
      </div>
      {selectedId && (
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
          ) : openNode?.side ? (
            <SidePreview node={openNode} onClose={() => setOpenId(null)} onExpand={() => expand(openNode.id)} onOpenStep={(id) => open(id)} />
          ) : openView ? (
            <StepPreview
              node={openView}
              flow={flow}
              onClose={() => setOpenId(null)}
              onEdit={() => (openView.index >= 0 && openView.index < total ? ws.editStep(openView.index) : setEditing(true))}
              onExpand={() => onExpand(openView.index)}
            />
          ) : null}
        </aside>
      )}
    </div>
  );
}

/** A supporting project source: which steps read it, and a link to the source itself. */
function SidePreview({ node, onClose, onExpand, onOpenStep }: { node: PipelineNode; onClose: () => void; onExpand: () => void; onOpenStep: (id: string) => void }) {
  const ws = useWs();
  const meta = useApp((s) => s.sources.find((x) => x.id === node.side!.fileId));
  const sh = meta?.sheets.find((x) => x.name === node.side!.sheet) ?? meta?.sheets[0];
  const consumers = node.side!.consumers.map((id) => ({ id, i: ws.effective.steps.findIndex((s) => s.id === id) })).filter((c) => c.i >= 0);
  return (
    <div className="sp">
      <div className="sp-head">
        <span className="sp-crumb">PROJECT SOURCE</span>
        <button className="btn ghost xs icon" aria-label="Close preview" onClick={onClose} style={{ marginLeft: "auto" }}>
          <X size={14} />
        </button>
      </div>
      <h2 className="sp-title">
        {node.side!.file}
        {node.side!.sheet && meta && meta.sheets.length > 1 && <span className="muted"> / {node.side!.sheet}</span>}
      </h2>
      {meta ? (
        <dl className="sp-metrics">
          <div>
            <dd>{fmtInt(sh?.rows ?? 0)}</dd>
            <dt>rows</dt>
          </div>
          <div>
            <dd>{sh?.cols ?? 0}</dd>
            <dt>columns</dt>
          </div>
        </dl>
      ) : (
        <div className="callout red">
          <XCircle size={16} /> This source is no longer in the project. Choose another one in the step that reads it.
        </div>
      )}
      <div className="small muted">Referenced by this pipeline, not copied. Read by:</div>
      <ul className="sp-rules">
        {consumers.map((c) => {
          const st = ws.effective.steps[c.i];
          return (
            <li key={c.id}>
              <span className="fc-num">{String(c.i + 2).padStart(2, "0")}</span>
              <button className="link" onClick={() => onOpenStep(c.id)}>
                {stepTitle(st)}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sp-actions">
        <Link className="btn" to={`/projects/${ws.pipeline.projectId}/sources?source=${node.side!.fileId}${node.side!.sheet ? `&sheet=${encodeURIComponent(node.side!.sheet)}` : ""}`}>
          Open in Sources
        </Link>
        <button className="btn primary" onClick={onExpand}>
          <Maximize2 size={14} /> Expand step
        </button>
      </div>
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
                <span className="small">. Open the review queue{node.step ? " for this step" : ""}.</span>
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

/** Join / lookup / append: both sides, keys, type and row impact. Configuration stays in the workbench. */
function CombineBody({ index }: { index: number }) {
  const ws = useWs();
  const step = ws.effective.steps[index] as Extract<Step, { type: "join" | "append" }>;
  const res = ws.preview.result?.steps[index];
  const meta = useApp((s) => s.sources.find((x) => x.id === step.source.fileId));
  const sh = meta && (meta.sheets.find((x) => x.name === step.source.sheet) ?? meta.sheets[0]);
  const right = `${step.source.file || "Choose a source"}${step.source.sheet && meta && meta.sheets.length > 1 ? ` / ${step.source.sheet}` : ""}`;
  return (
    <dl className="kv sp-combine">
      <dt>Left</dt>
      <dd>
        {ws.spec.name} <span className="subtle">({fmtInt(res?.rowsIn ?? 0)} rows)</span>
      </dd>
      <dt>{step.type === "append" ? "Appended" : "Right"}</dt>
      <dd>
        {right} {sh && <span className="subtle">({fmtInt(sh.rows)} rows)</span>}
      </dd>
      {step.type === "join" && (
        <>
          <dt>Keys</dt>
          <dd className="mono">{step.on.length ? step.on.map((k) => `${k.left} = ${k.right}`).join(", ") : "None yet"}</dd>
          <dt>Type</dt>
          <dd>
            {step.mode === "lookup" ? "Lookup (first match)" : "Join (every match)"}, {step.how === "left" ? "keep unmatched rows" : "drop unmatched rows"}
          </dd>
          <dt>Brings in</dt>
          <dd className="mono">{step.columns.join(", ") || "No columns"}</dd>
        </>
      )}
      {res && (
        <>
          <dt>Rows</dt>
          <dd className="num">
            {fmtInt(res.rowsIn)} → {fmtInt(res.rowsOut)}
          </dd>
        </>
      )}
    </dl>
  );
}

function StepBody({ index }: { index: number }) {
  const ex = useExamples(index);
  const ws = useWs();
  const step = ws.effective.steps[index];
  if (step?.type === "join" || step?.type === "append") return <CombineBody index={index} />;
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
      {!ws.spec.destination && <div className="small muted">No destination yet. Choose where rows that pass review are written. Edit to set one.</div>}
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
