// Pipeline canvas: a free-movable view of the data flow, built on React Flow and dressed as FORMA.
// Positions are presentation (stored in PipelineCanvasState). Connections are derived from the
// PipelineSpec and cannot be rewired: execution order always comes from the spec.
// Connections animate only from real run events: the edge into the step the engine reports as running.
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { Plus, Minus, Maximize, Workflow, Undo2, FolderInput, AlertTriangle, XCircle, CheckCircle2, Loader2, Circle, Database, ArrowDownToLine, Sheet, X, Combine, Layers } from "lucide-react";
import { deriveGraph, LOAD_ID, prunePositions, resolvePositions, arrange, SOURCE_ID, type PipelineGraph, type PipelineNode, type XY } from "@/canvas/graph";
import { addSourceNode, toGraphSpec } from "@/engine/graph/spec";
import { canConnect, contractOf, nodeById } from "@/engine/graph/model";
import type { InputRoleId } from "@/engine/graph/types";
import type { Connection, OnConnectStartParams } from "@xyflow/react";
import { useApp, defaultSourceSpec } from "@/store/app";
import { getSourceFile } from "@/store/db";
import { FileIcon } from "@/components/ui";
import { fmtDuration, fmtInt } from "@/lib/format";
import { useWs } from "../context";
import type { FlowNode, FlowState, NodeStatus } from "../PipelineView";
import type { Step } from "@/engine/types";
import { startCombineDraft } from "../combine";

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

export function StatusChip({ status }: { status: NodeStatus }) {
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

/** Data shown in one canvas node. Kept referentially stable while unchanged so only changed nodes re-render. */
interface NodeData extends Record<string, unknown> {
  graph: PipelineNode;
  view?: FlowNode;
  /** Label for the operation type (LOOKUP, JOIN, APPEND, CLEAN...). */
  stage: string;
  side?: { name: string; sheet?: string; rows?: number; cols?: number; missing: boolean; feeds: string; role: string };
  /** Multi-input tools: how many datasets they read. */
  inputs?: number;
  reviewHref?: string;
  basis: FlowState["basis"]["kind"];
  /** Which handles this node has: primary input, second input, output. */
  ports: { in: boolean; side: boolean; out: boolean };
  /** Connections can be edited now (not during a run or while a step is being edited). */
  editable: boolean;
  /** While dragging a new connection: whether this node can take it. */
  compat?: "yes" | "no";
}

interface EdgeData extends Record<string, unknown> {
  state: "idle" | "active" | "done" | "review" | "failed" | "pending";
  label?: string;
  /** Index of the step after which "+" inserts a step (main flow only). */
  addAfter?: number;
  /** The stored connection id, for inserting on it or disconnecting it. */
  edgeId: string;
  /** The connection's input role, read by people (e.g. "reference"). */
  role?: string;
  /** The node the connection feeds. */
  target: string;
}

const EDGE_COLOR: Record<EdgeData["state"], string> = {
  idle: "#b9c0cc",
  pending: "#d5dae2",
  active: "#146bff",
  done: "#7cc8a2",
  review: "#f0a43a",
  failed: "#f04438",
};

interface CanvasActions {
  addAfter: (index: number, edgeId: string) => void;
  disconnect: (edgeId: string) => void;
  inspect: (nodeId: string) => void;
  locked: boolean;
}
const CanvasCtx = createContext<CanvasActions>({ addAfter: () => undefined, disconnect: () => undefined, inspect: () => undefined, locked: false });

/** Node label: the tool category, or the operation for multi-input tools (see taxonomy.ts). */
const stageOf = (n: PipelineNode, view?: FlowNode) => {
  if (n.kind === "destination") return "Load";
  if (n.kind === "source") return "Source";
  return view?.stage ?? "Step";
};

/** What a supporting source is to the step that reads it, named by that step's contract. */
const sideRole = (step: Step | undefined) =>
  !step ? "project source" : step.type === "append" ? "appended rows" : step.type === "join" && step.mode === "lookup" ? "reference" : "right input";

/** Canvas commands from outside the canvas (command palette): Fit Pipeline, Auto Layout. */
export function canvasCommand(pipelineId: string, cmd: "fit" | "layout") {
  // The canvas may be mounting (switching from the Workbench); give it two frames.
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("forma:canvas", { detail: { pipelineId, cmd } }))));
}

// ---------------------------------------------------------------- nodes

const CanvasNodeView = memo(function CanvasNodeView({ data, selected }: NodeProps<Node<NodeData>>) {
  const { graph, view, stage, side, reviewHref, basis, ports, editable, compat } = data;
  const isSide = !!graph.side;
  const status: NodeStatus = isSide ? (side?.missing ? "failed" : "ready") : view?.status ?? "idle";
  const isLoad = graph.kind === "destination";
  const isSource = graph.kind === "source";
  const step = view?.step;
  const rowsIn = view?.rowsIn;
  const rowsOut = view?.rowsOut;
  const review = view?.reviewRows ?? 0;
  const ready = rowsOut !== undefined ? rowsOut - (isLoad ? 0 : review) : undefined;

  return (
    <div className={`cnode ${graph.kind} ${status} ${selected ? "on" : ""} ${isSide ? "side" : ""} ${compat ? `compat-${compat}` : ""}`} data-node-id={graph.id}>
      <Handle type="target" position={Position.Left} id="in" isConnectable={editable && ports.in} className={`chandle ${ports.in ? "port" : ""}`} title={ports.in ? "Input" : undefined} />
      <Handle type="source" position={Position.Right} id="out" isConnectable={editable && ports.out} className={`chandle ${ports.out ? "port" : ""}`} title={ports.out ? "Output: drag to connect" : undefined} />
      <Handle type="target" position={Position.Bottom} id="side" isConnectable={editable && ports.side} className={`chandle ${ports.side ? "port" : ""}`} title={ports.side ? "Second input" : undefined} />
      <Handle type="source" position={Position.Top} id="up" isConnectable={false} className="chandle" />
      <div className="fc-head">
        {view && !isSource && !isLoad && <span className="fc-num">{view.num}</span>}
        <span className="fc-stage">{stage}</span>
        {isSide && <span className="cnode-tag">{side?.role}</span>}
        {data.inputs && <span className="cnode-tag">{data.inputs} inputs</span>}
        <StatusChip status={status} />
      </div>
      {isSource ? (
        <div className="fc-title clamp-1">
          <FileIcon kind={(isSide ? side?.name : view?.title)?.match(/\.csv\b/i) ? "csv" : (isSide ? side?.name : view?.title)?.match(/\.xlsx?\b/i) ? "excel" : "json"} />
          <span className="clamp-1">{isSide ? side?.name : view?.title.split(" / ")[0]}</span>
        </div>
      ) : (
        <div className="fc-title clamp-1">
          {isLoad && (view?.title.includes(".") ? <ArrowDownToLine size={14} /> : <Database size={14} />)}
          <span className="clamp-1">{view?.title}</span>
        </div>
      )}
      {isSource ? (
        <div className="fc-detail clamp-1">{isSide ? side?.sheet ?? side?.feeds : view?.title.split(" / ")[1] ?? view?.detail}</div>
      ) : step?.type === "validate" ? (
        <div className="fc-detail clamp-1">
          {step.rules.length} rule{step.rules.length === 1 ? "" : "s"}
        </div>
      ) : view?.detail ? (
        <div className="fc-detail clamp-1">{view.detail}</div>
      ) : null}
      <div className="fc-metrics">
        {isSide ? (
          side?.missing ? (
            <span className="err">Source no longer in the project</span>
          ) : (
            <span>
              <b>{fmtInt(side?.rows ?? 0)}</b> rows · {side?.cols ?? 0} columns
            </span>
          )
        ) : view?.status === "running" ? (
          <span>{rowsIn !== undefined ? `${fmtInt(rowsIn)} rows in, processing` : "Loading"}</span>
        ) : view?.status === "pending" ? (
          <span className="subtle">Waiting</span>
        ) : view?.error ? (
          <span className="err clamp-1">{view.error}</span>
        ) : isSource ? (
          rowsOut !== undefined ? (
            <span>
              <b>{fmtInt(rowsOut)}</b> rows
            </span>
          ) : (
            <span className="subtle">{view?.status === "idle" ? "Choose a source" : "Loading"}</span>
          )
        ) : rowsOut !== undefined ? (
          <>
            {!isLoad && rowsIn !== undefined && rowsIn !== rowsOut ? (
              <span>
                {fmtInt(rowsIn)} → <b>{fmtInt(rowsOut)}</b>
              </span>
            ) : (
              <span>
                <b>{fmtInt(ready ?? 0)}</b> {isLoad ? (basis === "preview" ? "to load" : "loaded") : "ready"}
              </span>
            )}
            {review > 0 && reviewHref && (
              <Link className="fc-review nodrag" to={reviewHref} onClick={(e) => e.stopPropagation()}>
                <AlertTriangle size={12} /> {fmtInt(review)} review
              </Link>
            )}
            {view?.durationMs !== undefined && basis !== "preview" && <span className="subtle">{fmtDuration(view.durationMs)}</span>}
          </>
        ) : (
          <span className="subtle">{isLoad ? "Set a destination" : "No result yet"}</span>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------- edges

const FlowEdgeView = memo(function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps<Edge<EdgeData>>) {
  const { addAfter, disconnect, inspect, locked } = useContext(CanvasCtx);
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 18 });
  const state = data?.state ?? "idle";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`cedge ${state} ${selected ? "sel" : ""}`} interactionWidth={18} />
      <EdgeLabelRenderer>
        <div className={`cedge-label ${state} ${selected ? "sel" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          {data?.label && <span className="cedge-rows">{data.label}</span>}
          {data?.addAfter !== undefined && !locked && !selected && (
            <button className="cedge-add nodrag nopan" aria-label="Add a step here" title="Add a step here" onClick={() => addAfter(data.addAfter!, data.edgeId)}>
              <Plus size={12} />
            </button>
          )}
          {selected && data && (
            <span className="cedge-actions nodrag nopan" role="group" aria-label="Connection">
              {data.role && <span className="cedge-role">{data.role === "input" ? "data" : data.role}</span>}
              <button onClick={() => inspect(data.target)}>Inspect flow</button>
              {!locked && (
                <button className="danger" onClick={() => disconnect(data.edgeId)}>
                  Disconnect
                </button>
              )}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes = { forma: CanvasNodeView };
const edgeTypes = { flow: FlowEdgeView };

// ---------------------------------------------------------------- canvas

export interface PipelineCanvasProps {
  flow: FlowState;
  /** Selected node id (preview open), if any. */
  openId: string | null;
  onOpen: (id: string | null) => void;
  onExpand: (id: string) => void;
  onAddAfter: (index: number, edgeId: string) => void;
  /** + Add Tool: after the selected node, or at the end. */
  onAddTool?: () => void;
  /** Embedded in a workbench panel: no sources tray, compact toolbar. */
  embedded?: boolean;
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ flow, openId, onOpen, onExpand, onAddAfter, onAddTool, embedded }: PipelineCanvasProps) {
  const ws = useWs();
  const pid = ws.pipeline.id;
  const rf = useReactFlow<Node<NodeData>, Edge<EdgeData>>();
  const saved = useApp((s) => s.canvases[pid]?.nodes);
  const allSources = useApp((s) => s.sources);
  const setLayout = useApp((s) => s.setCanvasLayout);
  const setViewport = useApp((s) => s.setCanvasViewport);
  const graph = useMemo<PipelineGraph>(() => deriveGraph(ws.effective), [ws.effective]);
  // The connection model the compatibility rules read (same nodes and connections as the canvas).
  const model = useMemo(() => toGraphSpec(ws.effective).graph, [ws.effective]);
  const editable = !embedded && flow.basis.kind !== "live" && !ws.draft;
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  /** The input role a handle stands for on a node: "in" is its primary input, "side" its second. */
  const roleFor = useCallback(
    (nodeId: string, handle: string | null | undefined): InputRoleId | undefined => {
      const n = nodeById(model, nodeId);
      if (!n) return undefined;
      const roles = contractOf(n);
      if (handle === "side") return roles[1]?.role ?? (roles[0]?.cardinality === "many" ? roles[0].role : undefined);
      return roles[0]?.role;
    },
    [model],
  );
  const portsOf = useCallback(
    (id: string): NodeData["ports"] => {
      const n = nodeById(model, id);
      if (!n) return { in: false, side: false, out: false };
      const roles = contractOf(n);
      return { in: roles.length > 0, side: roles.length > 1 || roles[0]?.cardinality === "many", out: n.kind !== "load" };
    },
    [model],
  );
  const compatOf = useCallback(
    (id: string): NodeData["compat"] => {
      if (!connectingFrom || id === connectingFrom) return undefined;
      const n = nodeById(model, id);
      if (!n) return undefined;
      return contractOf(n).some((r) => canConnect(model, connectingFrom, id, r.role).ok) ? "yes" : "no";
    },
    [connectingFrom, model],
  );
  const positions = useMemo(() => resolvePositions(graph, saved), [graph, saved]);
  const history = useRef<Record<string, XY>[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [tray, setTray] = useState(false);
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; flow?: XY; fileId: string; sheet?: string; label: string } | null>(null);
  const live = flow.basis.kind === "live";
  const projectSources = useMemo(() => allSources.filter((s) => s.projectId === ws.pipeline.projectId), [allSources, ws.pipeline.projectId]);

  // Stable node data: rebuilt only for nodes whose visible content changed.
  const cache = useRef(new Map<string, { sig: string; data: NodeData }>());
  const nodeData = useMemo(() => {
    const out = new Map<string, NodeData>();
    const byIndex = new Map(flow.nodes.map((n) => [n.index, n]));
    const runId = flow.run && flow.basis.kind !== "preview" ? flow.run.id : undefined;
    for (const g of graph.nodes) {
      const view = g.index !== undefined ? byIndex.get(g.index) : flow.extraLoads[g.id];
      let side: NodeData["side"];
      if (g.side) {
        const meta = projectSources.find((s) => s.id === g.side!.fileId);
        const sh = meta?.sheets.find((x) => x.name === g.side!.sheet) ?? meta?.sheets[0];
        const consumers = g.side.consumers.map((c) => ws.effective.steps.findIndex((s) => s.id === c) + 2).filter((n) => n > 1);
        const first = ws.effective.steps.find((s) => s.id === g.side!.consumers[0]);
        side = { name: g.side.file, sheet: meta && meta.sheets.length > 1 ? g.side.sheet ?? sh?.name : undefined, rows: sh?.rows, cols: sh?.cols, missing: !meta, feeds: consumers.length ? `feeds step ${consumers.map((n) => String(n).padStart(2, "0")).join(", ")}` : "Not connected yet", role: sideRole(first) };
      }
      const reviewHref = view?.reviewRows ? (runId ? `/runs/${runId}/review${view.step ? `?step=${view.step.id}` : ""}` : `/pipelines/${pid}/review`) : undefined;
      const inputs = graph.edges.filter((e) => e.to === g.id).length;
      const data: NodeData = { graph: g, view, stage: stageOf(g, view), side, reviewHref, basis: flow.basis.kind, inputs: inputs > 1 ? inputs : undefined, ports: portsOf(g.id), editable, compat: compatOf(g.id) };
      const sig = JSON.stringify({ ...data, graph: g.id + (g.side?.consumers.join() ?? ""), view: view && { ...view, step: view.step && JSON.stringify(view.step) } });
      const hit = cache.current.get(g.id);
      if (hit && hit.sig === sig) out.set(g.id, hit.data);
      else {
        cache.current.set(g.id, { sig, data });
        out.set(g.id, data);
      }
    }
    return out;
  }, [graph, flow, projectSources, ws.effective.steps, pid, portsOf, editable, compatOf]);

  const fit = useCallback(() => rf.fitView({ padding: 0.18, duration: reducedMotion() ? 0 : 240, maxZoom: 1 }), [rf]);

  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((g) => {
        const o = old.get(g.id);
        const position = o?.dragging ? o.position : positions[g.id];
        const data = nodeData.get(g.id)!;
        const selected = openId === g.id;
        if (o && o.data === data && o.selected === selected && o.position.x === position.x && o.position.y === position.y) return o;
        return { ...(o ?? {}), id: g.id, type: "forma", position, data, selected, ariaLabel: `${data.stage}: ${data.view?.title ?? data.side?.name ?? ""}` } as Node<NodeData>;
      });
    });
  }, [graph, positions, nodeData, openId]);

  const edges = useMemo<Edge<EdgeData>[]>(() => {
    const byIndex = new Map(flow.nodes.map((n) => [n.index, n]));
    const viewOf = (id: string) => {
      const g = graph.nodes.find((n) => n.id === id);
      return g?.index !== undefined ? byIndex.get(g.index) : flow.extraLoads[id];
    };
    return graph.edges.map((e) => {
      const a = viewOf(e.from);
      const b = viewOf(e.to);
      let state: EdgeData["state"] = "idle";
      if (b?.status === "running") state = "active";
      else if (b?.status === "pending") state = "pending";
      else if (b?.status === "failed") state = "failed";
      else if (flow.basis.kind !== "preview" && (b?.status === "success" || b?.status === "review")) state = b.status === "review" && e.kind === "flow" && (a?.reviewRows ?? 0) > 0 ? "review" : "done";
      let label: string | undefined;
      if (e.kind === "flow" && a?.rowsOut !== undefined && (e.from === SOURCE_ID || a.rowsIn !== a.rowsOut)) label = `${fmtInt(a.rowsOut)} rows`;
      if (e.kind === "input") {
        const g = graph.nodes.find((n) => n.id === e.from);
        const meta = g?.side && projectSources.find((s) => s.id === g.side!.fileId);
        const sh = meta && (meta.sheets.find((x) => x.name === g!.side!.sheet) ?? meta.sheets[0]);
        if (sh) label = `${fmtInt(sh.rows)} rows`;
      }
      // "+" inserts a step on the connection. With explicit connections that works on every connection,
      // including the second input of a Join / Lookup / Append (to prepare that dataset).
      const addAfter = e.kind === "flow" || graph.explicit ? (a?.index ?? -1) : undefined;
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        sourceHandle: e.kind === "input" ? (graph.nodes.find((n) => n.id === e.from)?.side ? "up" : "out") : "out",
        targetHandle: e.kind === "input" ? "side" : "in",
        type: "flow",
        data: { state, label, addAfter, edgeId: e.id, role: graph.explicit ? e.role : undefined, target: e.to },
        markerEnd: { type: "arrowclosed" as never, width: 14, height: 14, color: EDGE_COLOR[state] },
        focusable: true,
        ariaLabel: `${e.from} to ${e.to}`,
      } as Edge<EdgeData>;
    });
  }, [graph, flow, projectSources]);

  const persistMoves = useCallback(
    (moved: Record<string, XY>) => {
      history.current.push({ ...positions });
      if (history.current.length > 50) history.current.shift();
      setCanUndo(true);
      setLayout(pid, { ...prunePositions(graph, positions), ...moved }, true);
    },
    [positions, graph, pid, setLayout],
  );

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodeData>>[]) => {
      // Finished moves (drag end or keyboard arrows) are persisted; positions while dragging stay local.
      const done: Record<string, XY> = {};
      let selectedId: string | undefined;
      for (const c of changes) {
        if (c.type === "position" && !c.dragging) {
          const pos = c.position ?? nodesRef.current.find((n) => n.id === c.id)?.position;
          if (pos) done[c.id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
        } else if (c.type === "select" && c.selected) selectedId = c.id;
      }
      setNodes((prev) =>
        prev.map((n) => {
          let next = n;
          for (const c of changes) {
            if (!("id" in c) || c.id !== n.id) continue;
            if (c.type === "position") next = { ...next, ...(c.position ? { position: c.position } : {}), dragging: c.dragging };
            else if (c.type === "dimensions" && c.dimensions) next = { ...next, measured: c.dimensions };
          }
          return next;
        }),
      );
      if (Object.keys(done).length) persistMoves(done);
      // Keyboard selection (Enter on a focused node) opens its preview, like a click.
      if (selectedId) onOpen(selectedId);
    },
    [persistMoves, onOpen],
  );

  const undoLayout = () => {
    const prev = history.current.pop();
    if (!prev) return;
    setLayout(pid, prev, true);
    setCanUndo(history.current.length > 0);
  };
  const runAutoLayout = () => {
    history.current.push({ ...positions });
    setCanUndo(true);
    setLayout(pid, arrange(ws.effective, graph), true);
    requestAnimationFrame(() => requestAnimationFrame(fit));
  };
  // Commands from the palette.
  const commands = useRef({ fit, runAutoLayout });
  commands.current = { fit, runAutoLayout };
  useEffect(() => {
    if (embedded) return;
    const on = (e: Event) => {
      const { pipelineId, cmd } = (e as CustomEvent<{ pipelineId: string; cmd: "fit" | "layout" }>).detail;
      if (pipelineId !== pid) return;
      if (cmd === "fit") commands.current.fit();
      else commands.current.runAutoLayout();
    };
    window.addEventListener("forma:canvas", on);
    return () => window.removeEventListener("forma:canvas", on);
  }, [pid, embedded]);

  // Viewport: restore the user's view, otherwise fit the pipeline once.
  // The embedded panel (Engineer view) always fits and leaves the main view's saved viewport alone.
  const initialViewport = useMemo(() => (embedded ? undefined : useApp.getState().canvases[pid]?.viewport), [pid, embedded]);
  const moveTimer = useRef<ReturnType<typeof setTimeout>>();

  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-forma-source");
    if (!raw) return;
    e.preventDefault();
    const { fileId, sheet, label } = JSON.parse(raw) as { fileId: string; sheet?: string; label: string };
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropMenu({ x: e.clientX - box.left, y: e.clientY - box.top, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), fileId, sheet, label });
  };
  const useSourceAs = async (as: "lookup" | "append") => {
    if (!dropMenu) return;
    const { fileId, sheet, flow: at } = dropMenu;
    setDropMenu(null);
    if (at) setLayout(pid, { [`side:${fileId}:${sheet ?? ""}`]: { x: Math.round(at.x - 120), y: Math.round(at.y - 40) } });
    await startCombineDraft(ws, fileId, sheet, as);
  };

  const ctx = useMemo<CanvasActions>(
    () => ({
      addAfter: onAddAfter,
      disconnect: (edgeId) => void ws.disconnect(edgeId),
      inspect: (nodeId) => onOpen(nodeId),
      locked: live || !!ws.draft,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAddAfter, live, ws.draft, ws.disconnect, onOpen],
  );

  // Connecting: compatible targets light up while dragging; a drop is checked against the same rules.
  const isValidConnection = useCallback(
    (c: Connection | Edge<EdgeData>) => {
      const role = roleFor(c.target, c.targetHandle);
      return !!role && canConnect(model, c.source, c.target, role).ok;
    },
    [model, roleFor],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const role = roleFor(c.target, c.targetHandle);
      if (role) void ws.connect(c.source, c.target, role);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleFor, ws.connect],
  );
  const onReconnect = useCallback(
    (old: Edge<EdgeData>, c: Connection) => {
      const edgeId = old.data?.edgeId ?? old.id;
      if (c.source !== old.source) void ws.reconnect(edgeId, { from: c.source });
      else if (c.target !== old.target || c.targetHandle !== old.targetHandle) void ws.reconnect(edgeId, { to: c.target, role: roleFor(c.target, c.targetHandle) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleFor, ws.reconnect],
  );
  const prepareSource = async () => {
    if (!dropMenu) return;
    const { fileId, sheet, flow: at } = dropMenu;
    setDropMenu(null);
    const file = await getSourceFile(fileId);
    if (!file) return;
    const r = addSourceNode(ws.effective, defaultSourceSpec(file, sheet));
    ws.update(() => r.spec);
    if (at) setLayout(pid, { [r.id]: { x: Math.round(at.x - 120), y: Math.round(at.y - 40) } });
    ws.insertOn({ after: r.id });
    ws.openPicker();
  };

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className={`pcanvas ${embedded ? "embedded" : ""}`} onDragOver={(e) => e.dataTransfer.types.includes("application/x-forma-source") && e.preventDefault()} onDrop={onDrop}>
        <ReactFlow<Node<NodeData>, Edge<EdgeData>>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onOpen(n.id)}
          onNodeDoubleClick={(_, n) => onExpand(n.id)}
          onPaneClick={() => onOpen(null)}
          defaultViewport={initialViewport}
          fitView={!initialViewport}
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          onMoveEnd={(_, vp) => {
            if (embedded) return;
            clearTimeout(moveTimer.current);
            moveTimer.current = setTimeout(() => setViewport(pid, { x: vp.x, y: vp.y, zoom: vp.zoom }), 120);
          }}
          minZoom={0.15}
          maxZoom={1.75}
          nodeDragThreshold={4}
          selectNodesOnDrag={false}
          nodesConnectable={editable}
          edgesReconnectable={editable}
          isValidConnection={isValidConnection}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onConnectStart={(_: unknown, p: OnConnectStartParams) => p.handleType === "source" && setConnectingFrom(p.nodeId)}
          onConnectEnd={() => setConnectingFrom(null)}
          connectionRadius={28}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode={["Meta", "Control"]}
          proOptions={{ hideAttribution: false }}
          aria-label="Pipeline canvas"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#dfe3ea" />
        </ReactFlow>
        <div className="ctool" role="toolbar" aria-label="Canvas">
          {!embedded && onAddTool && (
            <button className="ctool-btn add" onClick={onAddTool} disabled={live || !!ws.draft} aria-label="Add tool" title="Add a tool after the selected node">
              <Plus size={15} /> <span>Add Tool</span>
            </button>
          )}
          {!embedded && (
            <button className={`ctool-btn ${tray ? "on" : ""}`} onClick={() => setTray((v) => !v)} aria-pressed={tray} aria-label="Project sources" title="Project sources">
              <FolderInput size={15} /> <span>Sources</span>
            </button>
          )}
          <span className="ctool-sep" />
          <button className="ctool-btn icon" onClick={() => rf.zoomOut({ duration: 120 })} aria-label="Zoom out" title="Zoom out">
            <Minus size={15} />
          </button>
          <button className="ctool-btn icon" onClick={() => rf.zoomIn({ duration: 120 })} aria-label="Zoom in" title="Zoom in">
            <Plus size={15} />
          </button>
          <button className="ctool-btn" onClick={fit} aria-label="Fit pipeline" title="Fit pipeline">
            <Maximize size={14} /> {!embedded && <span>Fit</span>}
          </button>
          <button className="ctool-btn" onClick={runAutoLayout} aria-label="Auto layout" title="Arrange in execution order">
            <Workflow size={14} /> {!embedded && <span>Auto layout</span>}
          </button>
          <button className="ctool-btn icon" onClick={undoLayout} disabled={!canUndo} aria-label="Undo layout change" title="Undo layout change">
            <Undo2 size={15} />
          </button>
        </div>
        {tray && !embedded && (
          <aside className="ctray" aria-label="Project sources">
            <div className="ctray-head">
              <b>Project sources</b>
              <button className="btn ghost xs icon" aria-label="Close sources" onClick={() => setTray(false)}>
                <X size={13} />
              </button>
            </div>
            <div className="ctray-hint">Drag onto the canvas to look up or append. The source is referenced, never copied.</div>
            <ul>
              {projectSources.flatMap((s) =>
                (s.sheets.length > 1 ? s.sheets.map((sh) => ({ sh: sh.name, rows: sh.rows })) : [{ sh: undefined as string | undefined, rows: s.sheets[0]?.rows ?? 0 }]).map(({ sh, rows }) => {
                  const label = sh ? `${s.name} / ${sh}` : s.name;
                  return (
                    <li key={`${s.id}/${sh ?? ""}`}>
                      <button
                        className="ctray-item"
                        draggable={!live && !ws.draft}
                        disabled={live || !!ws.draft || !rows}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-forma-source", JSON.stringify({ fileId: s.id, sheet: sh, label }));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={(e) => {
                          const box = (e.currentTarget.closest(".pcanvas") as HTMLElement).getBoundingClientRect();
                          const r = e.currentTarget.getBoundingClientRect();
                          setDropMenu({ x: r.right - box.left + 6, y: r.top - box.top, fileId: s.id, sheet: sh, label });
                        }}
                      >
                        {sh ? <Sheet size={14} color="var(--green-text)" /> : <FileIcon kind={s.kind} />}
                        <span className="grow clamp-1">{label}</span>
                        <span className="small subtle num">{fmtInt(rows)}</span>
                      </button>
                    </li>
                  );
                }),
              )}
            </ul>
            <Link className="ctray-foot" to={`/projects/${ws.pipeline.projectId}/sources`}>
              Manage sources
            </Link>
          </aside>
        )}
        {dropMenu && (
          <div className="cdrop" style={{ left: dropMenu.x, top: dropMenu.y }} role="menu" aria-label={`Use ${dropMenu.label}`}>
            <div className="cdrop-head clamp-1">{dropMenu.label}</div>
            <button role="menuitem" onClick={() => useSourceAs("lookup")}>
              <Combine size={14} /> Look up columns from it
            </button>
            <button role="menuitem" onClick={() => useSourceAs("append")}>
              <Layers size={14} /> Append its rows
            </button>
            <button role="menuitem" onClick={prepareSource}>
              <Workflow size={14} /> Add as a source to prepare first
            </button>
            <button role="menuitem" className="subtle" onClick={() => setDropMenu(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </CanvasCtx.Provider>
  );
}

export function reducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export { LOAD_ID };
