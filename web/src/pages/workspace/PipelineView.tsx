// Pipeline view (level 1 of CANVAS → NODE → PREVIEW → EXPAND): the data flow on a free-movable canvas,
// with status and row impact per step. Status comes from the live run, the latest run of this spec,
// or the live preview. Layout lives in the canvas state and never changes execution.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Maximize2, SlidersHorizontal, X, AlertTriangle, XCircle, CheckCircle2, Loader2, ListChecks, Trash2, ArrowDown } from "lucide-react";
import type { Dataset, Step, StepResult } from "@/engine/types";
import { describeStep, stageOf, stepColumns, stepTitle } from "@/engine/registry";
import { CATEGORIES, categoryMeta, operationOf, pathOf } from "@/engine/taxonomy";
import { DocLink } from "@/components/DocLink";
import { appendSchema, inputRoles, matchStats } from "@/lib/combine";
import { explainMissingColumn, schemaChange } from "@/lib/schema";
import { useOther } from "./editors/ReshapeEditor";
import { destinationLabel, toGraphSpec } from "@/engine/graph/spec";
import { canConnect, contractOf, nodeById, nodeTitle } from "@/engine/graph/model";
import type { InputRoleId } from "@/engine/graph/types";
import { toText } from "@/engine/values";
import { useApp, type LiveRun } from "@/store/app";
import type { Run } from "@/store/model";
import { deriveGraph, LOAD_ID, SOURCE_ID, type PipelineNode } from "@/canvas/graph";
import { PipelineCanvas, StatusChip } from "./canvas/PipelineCanvas";
import { fmtDuration, fmtInt, fmtTime } from "@/lib/format";
import { useWs, SOURCE } from "./context";
import { InspectorPanel, LoadInspector } from "./panels/InspectorPanel";
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
  /** Extra Loads (branches), by node id. */
  extraLoads: Record<string, FlowNode>;
  /** What the numbers describe. */
  basis: { kind: "live"; live: LiveRun; revealed: number } | { kind: "run"; run: Run } | { kind: "preview"; sampled: boolean; loading: boolean };
  run?: Run;
}

/** Extra Loads (branches) as flow nodes: their destination, and real row counts from the chosen basis. */
function extraLoadNodes(
  loads: { id: string; destination: import("@/engine/types").Destination | null }[],
  basis: "live" | "run" | "preview",
  data: { run?: Run; result?: import("@/engine/types").ExecutionResult },
): Record<string, FlowNode> {
  const out: Record<string, FlowNode> = {};
  loads.forEach((l, k) => {
    const base: FlowNode = { index: -100 - k, num: "", stage: "Load", title: destinationLabel(l.destination), detail: l.destination ? "branch output" : "Choose where this branch is written", status: l.destination ? "ready" : "idle" };
    if (basis === "live") out[l.id] = { ...base, status: "pending" };
    else if (basis === "run") {
      const r = data.run?.loads?.find((x) => x.id === l.id);
      out[l.id] = r ? { ...base, status: r.rowsIn > r.rowsOut ? "review" : "success", rowsIn: r.rowsIn, rowsOut: r.rowsOut, reviewRows: r.rowsIn - r.rowsOut } : base;
    } else {
      const r = data.result?.loads?.find((x) => x.id === l.id);
      const problem = data.result?.problems?.find((x) => x.level === "error" && x.nodeId === l.id);
      out[l.id] = problem
        ? { ...base, status: "failed", error: problem.message }
        : r
          ? { ...base, status: r.beforeGate.rows.length > r.output.rows.length ? "review" : base.status, rowsIn: r.beforeGate.rows.length, rowsOut: r.output.rows.length, reviewRows: r.beforeGate.rows.length - r.output.rows.length }
          : base;
    }
  });
  return out;
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
      return { index, num: String(index + 2).padStart(2, "0"), stage: stageOf(step), title: stepTitle(step), detail: describeStep(step).detail, status: "ready", step };
    };
    const all = [SOURCE, ...steps.map((_, i) => i), steps.length].map(base);
    const extra = ws.effective.graph?.loads ?? [];

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
      return { nodes, extraLoads: extraLoadNodes(extra, "live", {}), basis: { kind: "live", live, revealed }, run: runs.find((r) => r.id === live.runId) };
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
      return { nodes, extraLoads: extraLoadNodes(extra, "run", { run: current }), basis: { kind: "run", run: current }, run: current };
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
    // Connection problems (pipelines with explicit connections) show on the node they concern.
    const problems = result?.problems ?? [];
    const idOf = (index: number) => (index === SOURCE ? SOURCE_ID : index >= steps.length ? LOAD_ID : steps[index].id);
    const withProblems = nodes.map((n) => {
      const p = problems.find((x) => x.level === "error" && x.nodeId === idOf(n.index));
      return p && !n.error ? { ...n, status: "failed" as const, error: p.message } : n;
    });
    return { nodes: withProblems, extraLoads: extraLoadNodes(extra, "preview", { result }), basis: { kind: "preview", sampled: preview.sampled, loading: preview.loading }, run: latest };
  }, [ws.spec.source, ws.spec.destination, ws.effective.graph, ws.draft, steps, preview, live, liveActive, revealed, current, latest, runs]);
}

/** Selected node per pipeline, restored when coming back from the review queue or the Workbench. */
const lastOpen = new Map<string, string | null>();

/** Graph node id of a flow node index (main chain). */
const idOfIndex = (index: number, steps: Step[]) => (index === SOURCE ? SOURCE_ID : index >= steps.length ? LOAD_ID : steps[index].id);

export function PipelineView({ onExpand }: { onExpand: (index: number) => void }) {
  const ws = useWs();
  const flow = useFlow();
  const [openId, setOpenIdRaw] = useState<string | null>(() => lastOpen.get(ws.pipeline.id) ?? null);
  const setOpenId = useCallback(
    (id: string | null) => {
      lastOpen.set(ws.pipeline.id, id);
      setOpenIdRaw(id);
    },
    [ws.pipeline.id],
  );
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
  useEffect(() => {
    if (openId && !graph.nodes.some((n) => n.id === openId)) setOpenId(null);
  }, [graph, openId, setOpenId]);

  // Add Tool and the command palette can ask for a node's inspector (Source, Load).
  const req = ws.inspectRequest;
  useEffect(() => {
    if (!req || ws.draft) return;
    setOpenId(req.nodeId ?? idOfIndex(req.index, steps));
    setEditing(req.edit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.n]);

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
  }, [openId, ws.draft, setOpenId]);

  const open = useCallback(
    (id: string | null) => {
      if (ws.draft) return;
      setEditing(false);
      setOpenId(id);
      const g = id ? graph.nodes.find((n) => n.id === id) : undefined;
      ws.insertOn(g?.side && graph.explicit ? { after: id! } : null);
      if (id === null) return;
      const i = indexOf(id) ?? sideConsumer(id);
      if (i !== undefined && i >= -1) ws.setSel(i);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.draft, ws.setSel, ws.insertOn, indexOf, graph, setOpenId],
  );
  const expand = (id: string) => {
    const i = indexOf(id) ?? sideConsumer(id);
    if (i !== undefined && i >= -1) onExpand(i);
  };
  const addAfter = useCallback(
    (i: number, edgeId?: string) => {
      if (ws.draft) return;
      ws.setSel(i);
      ws.insertOn(edgeId && ws.effective.graph ? { edge: edgeId } : null);
      ws.openPicker();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.draft, ws.setSel, ws.openPicker, ws.insertOn, ws.effective.graph],
  );

  const remoteRunning = useApp((s) => s.runs.find((r) => r.pipelineId === ws.pipeline.id && r.status === "running" && r.remoteId));
  const basis = flow.basis;
  const run = flow.run;
  const openNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined;
  const openView = openNode?.index !== undefined ? flow.nodes.find((n) => n.index === openNode.index) : undefined;
  const openExtraLoad = openNode && openNode.kind === "destination" && openNode.index === undefined ? openNode.id : undefined;

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
          {total === 0 && !ws.draft && basis.kind !== "live" && <EmptyPipeline onAddSource={() => ws.inspect(SOURCE, true)} onAddTool={() => addAfter(SOURCE)} hasSource={!!ws.spec.source} />}
        </div>
        <PipelineCanvas flow={flow} openId={selectedId} onOpen={open} onExpand={expand} onAddAfter={addAfter} onAddTool={() => !ws.draft && ws.openPicker()} />
      </div>
      {selectedId && (
        <aside className={`flow-side ${showEditor ? "editing" : ""}`} aria-label="Step preview">
          {showEditor && openExtraLoad ? (
            <div className="flow-editor">
              <button className="btn ghost xs flow-side-back" onClick={() => setEditing(false)}>
                Back to summary
              </button>
              <div className="pad-panel">
                <LoadInspector loadId={openExtraLoad} />
              </div>
            </div>
          ) : openExtraLoad ? (
            <StepPreview node={flow.extraLoads[openExtraLoad] ?? { index: -100, num: "", stage: "Load", title: "Load", detail: "", status: "idle" }} flow={flow} loadId={openExtraLoad} onClose={() => setOpenId(null)} onEdit={() => setEditing(true)} onExpand={() => setEditing(true)} />
          ) : showEditor ? (
            <div className="flow-editor">
              {!ws.draft && (
                <button className="btn ghost xs flow-side-back" onClick={() => setEditing(false)}>
                  Back to summary
                </button>
              )}
              <InspectorPanel />
            </div>
          ) : openNode?.side ? (
            <SidePreview node={openNode} onClose={() => setOpenId(null)} onOpenStep={(id) => open(id)} />
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

/** A new pipeline: start with data, then add tools. The common flow is guidance, not a rule. */
function EmptyPipeline({ hasSource, onAddSource, onAddTool }: { hasSource: boolean; onAddSource: () => void; onAddTool: () => void }) {
  return (
    <div className="flow-start" aria-label="Build your pipeline">
      <div className="flow-start-title">Build your pipeline</div>
      <div className="flow-start-sub">{hasSource ? "Your source is ready. Add the first tool." : "Start with data."}</div>
      <div className="row" style={{ gap: 8, justifyContent: "center" }}>
        <button className={`btn ${hasSource ? "" : "primary"} sm`} onClick={onAddSource}>
          {hasSource ? "Configure source" : "Add Source"}
        </button>
        <button className={`btn ${hasSource ? "primary" : ""} sm`} onClick={onAddTool}>
          <Plus size={14} /> Add Tool
        </button>
      </div>
      <div className="flow-start-common">
        <span className="subtle small">Common flow</span>
        <ol className="flow-start-steps">
          {CATEGORIES.map((c) => (
            <li key={c.id} title={c.tagline}>
              {c.title}
            </li>
          ))}
        </ol>
      </div>
      <DocLink page="getting-started-add-tool" />
    </div>
  );
}

/** A supporting project source: its role for the step that reads it, which steps read it, and a link to the source. */
function SidePreview({ node, onClose, onOpenStep }: { node: PipelineNode; onClose: () => void; onOpenStep: (id: string) => void }) {
  const ws = useWs();
  const meta = useApp((s) => s.sources.find((x) => x.id === node.side!.fileId));
  const sh = meta?.sheets.find((x) => x.name === node.side!.sheet) ?? meta?.sheets[0];
  const consumers = node.side!.consumers.map((id) => ({ id, i: ws.effective.steps.findIndex((s) => s.id === id) })).filter((c) => c.i >= 0);
  return (
    <div className="sp">
      <div className="sp-head">
        <span className="sp-crumb">SOURCE</span>
        <span className="sp-path">{sideRoleTitle(ws.effective.steps.find((s) => s.id === node.side!.consumers[0]))}</span>
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
        {consumers[0] && (
          <button className="btn primary" onClick={() => onOpenStep(consumers[0].id)}>
            Open {stepTitle(ws.effective.steps[consumers[0].i])}
          </button>
        )}
        <Link className="btn" to={`/projects/${ws.pipeline.projectId}/sources?source=${node.side!.fileId}${node.side!.sheet ? `&sheet=${encodeURIComponent(node.side!.sheet)}` : ""}`}>
          Open in Sources
        </Link>
      </div>
      <Connections nodeId={node.id} />
      <DocLink page="combine-multiple-sources" />
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

const sideRoleTitle = (step: Step | undefined) =>
  !step ? "Project source" : step.type === "append" ? "Appended dataset" : step.type === "join" && step.mode === "lookup" ? "Reference dataset" : "Right input";

/** Quick inspector (level 2): what the selected tool does to the data, and the actions that matter for it. */
function StepPreview({ node, flow, onClose, onEdit, onExpand, loadId }: { node: FlowNode; flow: FlowState; onClose: () => void; onEdit: () => void; onExpand: () => void; loadId?: string }) {
  const ws = useWs();
  const isSource = node.index === SOURCE;
  const isLoad = !node.step && !isSource;
  const live = flow.basis.kind === "live";
  const op = node.step ? operationOf(node.step) : undefined;
  const category = isSource ? categoryMeta("source") : isLoad ? categoryMeta("load") : categoryMeta(op!.category);
  const path = op ? pathOf(op).slice(1, -1).join(" > ") : "";
  const doc = op?.doc ?? category.doc;
  const explain = node.step && node.error ? explainMissingColumn(ws.effective, node.index, node.error, ws.preview.result?.snapshots) : null;
  return (
    <div className="sp" key={node.index}>
      <div className="sp-head">
        <span className="fc-num">{node.num}</span>
        <span className="sp-crumb">{node.stage.toUpperCase()}</span>
        {path && <span className="sp-path">{path}</span>}
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
          {node.step && <StepBody index={node.index} reviewRows={node.reviewRows ?? 0} />}
          {isLoad && !loadId && <LoadBody node={node} />}
          {loadId && <BranchLoadBody loadId={loadId} />}
          <Metrics node={node} isSource={isSource} isLoad={isLoad} />
          {node.step && !node.error && <SchemaLine index={node.index} />}
          {node.error && (
            <div className="callout red">
              <XCircle size={16} />
              <div>
                {node.error}
                {explain && <div className="small">{explain}</div>}
              </div>
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
        <button className="btn primary" onClick={onEdit} disabled={live}>
          <SlidersHorizontal size={14} /> Configure
        </button>
        {!loadId && (
          <button className="btn" onClick={onExpand}>
            <Maximize2 size={14} /> Open Workbench
          </button>
        )}
        {loadId && (
          <button className="btn ghost icon" aria-label="Remove this Load" title="Remove this Load" disabled={live} onClick={() => (ws.removeLoad(loadId), onClose())} style={{ marginLeft: "auto" }}>
            <Trash2 size={14} />
          </button>
        )}
        {node.step && (
          <button className="btn ghost icon" aria-label="Delete step" title="Delete step" disabled={live} onClick={() => (ws.removeStep(node.index), onClose())} style={{ marginLeft: "auto" }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <Connections nodeId={loadId ?? (node.index === SOURCE ? SOURCE_ID : node.step ? node.step.id : LOAD_ID)} />
      <DocLink page={doc} />
    </div>
  );
}

/**
 * Connections of a node, editable without dragging: each input with its source and Disconnect, a list of
 * compatible nodes to connect from, and where its output goes. Uses the same rules as the canvas.
 */
function Connections({ nodeId }: { nodeId: string }) {
  const ws = useWs();
  const g = useMemo(() => toGraphSpec(ws.effective).graph, [ws.effective]);
  const node = nodeById(g, nodeId);
  const live = !!ws.draft;
  if (!node) return null;
  const roles = contractOf(node);
  const ins = g.edges.filter((e) => e.to === nodeId);
  const outs = g.edges.filter((e) => e.from === nodeId);
  const title = (id: string) => nodeTitle(nodeById(g, id)!, g);
  const fromOptions = (role: InputRoleId) => g.nodes.filter((n) => canConnect(g, n.id, nodeId, role).ok);
  const toOptions = node.kind === "load" ? [] : g.nodes.flatMap((n) => contractOf(n).filter((r) => canConnect(g, nodeId, n.id, r.role).ok).map((r) => ({ id: n.id, role: r.role, label: `${title(n.id)} (${r.label.toLowerCase()})` })));
  return (
    <details className="sp-conn">
      <summary>
        Connections <span className="subtle">({ins.length} in, {outs.length} out)</span>
      </summary>
      {roles.map((r) => {
        const here = ins.filter((e) => e.input === r.role);
        const free = r.cardinality === "many" || here.length === 0;
        const options = free ? fromOptions(r.role) : [];
        return (
          <div key={r.role} className="sp-conn-row">
            <span className="sp-conn-role">{r.label}</span>
            {here.map((e) => (
              <span key={e.id} className="sp-conn-edge">
                <span className="clamp-1">{title(e.from)}</span>
                <button className="btn ghost xs" disabled={live} onClick={() => void ws.disconnect(e.id)} aria-label={`Disconnect ${title(e.from)} from ${r.label.toLowerCase()}`}>
                  Disconnect
                </button>
              </span>
            ))}
            {free && (
              <select className="select sm" value="" disabled={live || !options.length} aria-label={`Connect ${r.label.toLowerCase()} from`} onChange={(ev) => ev.target.value && void ws.connect(ev.target.value, nodeId, r.role)}>
                <option value="">{options.length ? "Connect from..." : "Nothing compatible to connect"}</option>
                {options.map((n) => (
                  <option key={n.id} value={n.id}>
                    {title(n.id)}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {node.kind !== "load" && (
        <div className="sp-conn-row">
          <span className="sp-conn-role">Output</span>
          {outs.map((e) => (
            <span key={e.id} className="sp-conn-edge">
              <span className="clamp-1">{title(e.to)}</span>
              <button className="btn ghost xs" disabled={live} onClick={() => void ws.disconnect(e.id)} aria-label={`Disconnect from ${title(e.to)}`}>
                Disconnect
              </button>
            </span>
          ))}
          <select className="select sm" value="" disabled={live || !toOptions.length} aria-label="Connect output to" onChange={(ev) => {
            const o = toOptions[Number(ev.target.value)];
            if (o) void ws.connect(nodeId, o.id, o.role);
          }}>
            <option value="">{toOptions.length ? "Connect to..." : "Nothing compatible to connect to"}</option>
            {toOptions.map((o, k) => (
              <option key={`${o.id}:${o.role}`} value={k}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="hint">Moving nodes never changes what runs. Connections do.</div>
    </details>
  );
}

/** Output schema of a step: column count and what changed. */
function SchemaLine({ index }: { index: number }) {
  const ws = useWs();
  const ch = schemaChange(ws.datasetBefore(index), ws.datasetAfter(index));
  if (!ch) return null;
  const parts = [ch.added.length ? `+${ch.added.length} (${ch.added.slice(0, 3).join(", ")}${ch.added.length > 3 ? ", ..." : ""})` : "", ch.removed.length ? `-${ch.removed.length} (${ch.removed.slice(0, 3).join(", ")}${ch.removed.length > 3 ? ", ..." : ""})` : ""].filter(Boolean);
  return (
    <div className="sp-schema small muted">
      Output: <b>{ch.columns} columns</b>
      {parts.length ? <span className="mono"> {parts.join(" ")}</span> : <span> (unchanged)</span>}
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

/** Name of the dataset flowing into a step: the source, or the output of the step before it. */
function upstreamName(ws: ReturnType<typeof useWs>, index: number): string {
  if (index === 0) return ws.spec.source ? `${ws.spec.source.file}${ws.spec.source.sheet ? ` / ${ws.spec.source.sheet}` : ""}` : "Source";
  const prev = ws.effective.steps[index - 1];
  return `${String(index + 1).padStart(2, "0")} ${stepTitle(prev)}`;
}

/** Join / Lookup / Append: both inputs by role, keys, and real row impact. Configuration stays in Configure. */
function CombineBody({ index }: { index: number }) {
  const ws = useWs();
  const step = ws.effective.steps[index] as Extract<Step, { type: "join" | "append" }>;
  const res = ws.preview.result?.steps[index];
  const meta = useApp((s) => s.sources.find((x) => x.id === step.source.fileId));
  const right = useOther(step.source);
  const before = ws.datasetBefore(index);
  const after = ws.datasetAfter(index);
  const [leftRole, rightRole] = inputRoles(step);
  const rightName = `${step.source.file || "Choose a source"}${step.source.sheet && meta && meta.sheets.length > 1 ? ` / ${step.source.sheet}` : ""}`;
  const reviewRows = ws.preview.result?.reviewRows;
  const stats = useMemo(() => {
    if (step.type !== "join" || !before || !right) return null;
    // A Join changes row identity, so rows held for review never reach it: count only rows that do.
    let left = before;
    if (step.mode === "join" && res && res.rowsIn < before.rows.length && reviewRows) {
      const held = new Set(reviewRows);
      const keep = before.rowIds.map((id) => !held.has(id));
      left = { ...before, rows: before.rows.filter((_, i) => keep[i]), rowIds: before.rowIds.filter((_, i) => keep[i]) };
    }
    return matchStats(left, right, step.on);
  }, [step, before, right, res, reviewRows]);
  const schema = useMemo(() => (step.type === "append" && before && right ? appendSchema(before, right, step.mapping) : null), [step, before, right]);
  return (
    <div className="combine-io">
      <div className="combine-input">
        <span className="combine-role">{leftRole}</span>
        <span className="combine-name">{upstreamName(ws, index)}</span>
        <span className="subtle num">{res ? `${fmtInt(res.rowsIn)} rows` : ""}</span>
      </div>
      <div className="combine-input">
        <span className="combine-role">{rightRole}</span>
        <span className="combine-name">{rightName}</span>
        <span className="subtle num">{right ? `${fmtInt(right.rows.length)} rows` : ""}</span>
      </div>
      {step.type === "join" ? (
        <>
          <dl className="kv sp-combine">
            <dt>Type</dt>
            <dd>
              {step.mode === "lookup" ? "Lookup, first match" : step.how === "left" ? "Left join, every match" : "Inner join, every match"}
              {step.mode === "lookup" ? (step.how === "left" ? ". Unmatched rows kept" : ". Unmatched rows dropped") : ""}
              {step.mode === "lookup" && step.flagUnmatched ? ", sent to review" : ""}
            </dd>
            <dt>Match</dt>
            <dd className="mono">{step.on.length ? step.on.map((k) => `${k.left} = ${k.right}`).join(", ") : <span className="amber">No keys yet. Configure to choose them.</span>}</dd>
            {step.columns.length > 0 && (
              <>
                <dt>Brings in</dt>
                <dd className="mono clamp-2">{step.columns.join(", ")}</dd>
              </>
            )}
          </dl>
          {stats && (
            <dl className="sp-metrics">
              <div>
                <dd>{fmtInt(stats.matched)}</dd>
                <dt>matched</dt>
              </div>
              <div className={stats.unmatched ? "amber" : ""}>
                <dd>{fmtInt(stats.unmatched)}</dd>
                <dt>unmatched</dt>
              </div>
              {res && !res.error && (
                <div>
                  <dd>{fmtInt(res.rowsOut)}</dd>
                  <dt>result rows</dt>
                </div>
              )}
              {after && !res?.error && (
                <div>
                  <dd>{after.columns.length}</dd>
                  <dt>columns</dt>
                </div>
              )}
            </dl>
          )}
        </>
      ) : (
        schema && (
          <div className="col" style={{ gap: 6 }}>
            <dl className="sp-metrics">
              <div>
                <dd>{schema.matched.length}</dd>
                <dt>matched columns</dt>
              </div>
              <div className={schema.missing.length ? "amber" : ""}>
                <dd>{schema.missing.length}</dd>
                <dt>missing</dt>
              </div>
              <div>
                <dd>{schema.additional.length}</dd>
                <dt>additional</dt>
              </div>
            </dl>
            {schema.matched.some((m) => m.conflict) && (
              <div className="callout amber small">
                <AlertTriangle size={14} /> Type conflicts: {schema.matched.filter((m) => m.conflict).map((m) => `${m.target} (${m.conflict!.target} / ${m.conflict!.from})`).join(", ")}
              </div>
            )}
            {(schema.suggestions.length > 0 || schema.invalid.length > 0) && (
              <div className="small muted">{schema.invalid.length ? schema.invalid.join(". ") : `Possible mappings to check: ${schema.suggestions.map((x) => `${x.target} <- ${x.from}`).join(", ")}. Configure to map them.`}</div>
            )}
          </div>
        )
      )}
    </div>
  );
}

/** Extract: an input value, the fields it produced, and how many rows matched. */
function ExtractBody({ index, reviewRows }: { index: number; reviewRows: number }) {
  const ws = useWs();
  const step = ws.effective.steps[index] as Extract<Step, { type: "extract" | "extract_kv" | "split" }>;
  const before = ws.datasetBefore(index);
  const after = ws.datasetAfter(index);
  const res = ws.preview.result?.steps[index];
  const fields = step.type === "extract" ? step.fields.map((f) => f.name) : step.type === "extract_kv" ? step.keys.map((k) => k.name) : step.into;
  const sample = useMemo(() => {
    if (!before || !after) return null;
    const ci = before.columns.indexOf(step.column);
    if (ci < 0) return null;
    const bIdx = new Map(before.rowIds.map((r, i) => [r, i]));
    for (let i = 0; i < after.rows.length; i++) {
      const b = bIdx.get(after.rowIds[i]);
      if (b === undefined) continue;
      const out = fields.map((f) => toText(after.rows[i][after.columns.indexOf(f)]));
      if (out.some((v) => v !== null)) return { input: toText(before.rows[b][ci]), out };
    }
    return null;
  }, [before, after, step.column, fields]);
  const failedRows = new Set(ws.issuesFor(step.id).map((i) => i.row)).size;
  const rowsIn = res?.rowsIn ?? 0;
  return (
    <div className="col" style={{ gap: 10 }}>
      {sample && (
        <div className="sp-extract">
          <div className="sp-io-label">Input</div>
          <div className="mono sp-extract-in">{sample.input ?? <i className="subtle">blank</i>}</div>
          <ArrowDown size={14} className="sp-extract-arrow" aria-hidden />
          <div className="sp-io-label">Extracted</div>
          <dl className="sp-extract-out">
            {fields.map((f, k) => (
              <div key={f}>
                <dt>{f}</dt>
                <dd className="mono">{sample.out[k] ?? <i className="subtle">blank</i>}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {rowsIn > 0 && step.type === "extract" && (
        <div className="small">
          <b>{((100 * (rowsIn - failedRows)) / rowsIn).toFixed(1)}% matched</b>
          {reviewRows > 0 && <span className="amber">, {fmtInt(reviewRows)} review</span>}
          {ws.preview.sampled && <span className="subtle"> (preview sample)</span>}
        </div>
      )}
    </div>
  );
}

function StepBody({ index, reviewRows }: { index: number; reviewRows: number }) {
  const ex = useExamples(index);
  const ws = useWs();
  const step = ws.effective.steps[index];
  if (step?.type === "join" || step?.type === "append") return <CombineBody index={index} />;
  if (step?.type === "extract" || step?.type === "extract_kv" || step?.type === "split") return <ExtractBody index={index} reviewRows={reviewRows} />;
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

/** An extra Load: what reaches it and what it writes (rows held for review never load). */
function BranchLoadBody({ loadId }: { loadId: string }) {
  const ws = useWs();
  const r = ws.preview.result?.loads?.find((l) => l.id === loadId);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="small muted">A branch output. It writes the rows that reach it and pass review, independently of the main Load.</div>
      {r && r.output.rows.length > 0 && <MiniTable ds={r.output} />}
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
