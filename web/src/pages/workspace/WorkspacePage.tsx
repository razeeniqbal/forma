import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  Play, FlaskConical, CalendarClock, Code2, MoreHorizontal, Undo2, Redo2, LayoutGrid, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Save, ShieldCheck, ListChecks, Copy, Trash2, History, Upload, Loader2, Eye, EyeOff, Check, Plus, Workflow,
} from "lucide-react";
import { useApp, usePipeline, defaultSourceSpec } from "@/store/app";
import type { PanelId, PresetId, WorkspaceLayout } from "@/store/model";
import { ALL_PANELS, cloneLayout, PANEL_TITLES, PRESET_LABEL, PRESET_ORDER, PRESETS } from "@/store/layouts";
import { STAGE_OF, stepTitle, describeStep, TRANSFORMS } from "@/engine/registry";
import type { StepType } from "@/engine/types";
import { loadDataset } from "@/engine/load";
import { ACCEPT, parseFile } from "@/parsers";
import { confirmAction, Empty, Modal, useMenu } from "@/components/ui";
import { usePaletteActions, type PaletteAction } from "@/components/CommandPalette";
import { useHotkeys } from "@/lib/hooks";
import { fmtDateTime, fmtInt, MOD } from "@/lib/format";
import { useWs, WorkspaceProvider, SOURCE } from "./context";
import { LayoutCtl } from "./panels/PanelFrame";
import { PreviewPanel } from "./panels/PreviewPanel";
import { SourcePanel } from "./panels/SourcePanel";
import { PipelinePanel, stepState } from "./panels/PipelinePanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { BeforeAfterPanel } from "./panels/BeforeAfterPanel";
import { FailedRowsPanel, LogsPanel, ProfilePanel, PythonPanel, QualityPanel, RunsPanel, SpecPanel, SqlPanel } from "./panels/misc";
import { TransformPicker } from "./TransformPicker";

const PANELS: Record<PanelId, () => JSX.Element> = {
  source: SourcePanel,
  preview: PreviewPanel,
  pipeline: PipelinePanel,
  inspector: InspectorPanel,
  beforeAfter: BeforeAfterPanel,
  profile: ProfilePanel,
  quality: QualityPanel,
  failedRows: FailedRowsPanel,
  python: PythonPanel,
  sql: SqlPanel,
  spec: SpecPanel,
  logs: LogsPanel,
  runs: RunsPanel,
};

export function WorkspacePage() {
  const { id } = useParams();
  const pipeline = usePipeline(id);
  if (!pipeline)
    return (
      <div className="page">
        <Empty icon={<Workflow size={22} />} title="Pipeline not found" action={<Link className="btn" to="/pipelines">Back to pipelines</Link>} />
      </div>
    );
  return (
    <WorkspaceProvider key={pipeline.id} pipeline={pipeline}>
      <Workspace />
    </WorkspaceProvider>
  );
}

function Workspace() {
  const ws = useWs();
  const nav = useNavigate();
  const { pipeline } = ws;
  const app = useApp.getState();
  const history = useApp((s) => s.history[pipeline.id]);
  const running = useApp((s) => s.runningPipelines[pipeline.id]);
  const layouts = useApp((s) => s.layouts);
  const [edit, setEdit] = useState<WorkspaceLayout | null>(null);
  const [customize, setCustomize] = useState(false);
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [versions, setVersions] = useState(false);
  const [name, setName] = useState(pipeline.spec.name);
  const more = useMenu();
  const presetMenu = useMenu();

  useEffect(() => setName(pipeline.spec.name), [pipeline.spec.name]);

  const base: WorkspaceLayout =
    pipeline.preset === "custom" ? layouts.find((l) => l.id === pipeline.customLayoutId) ?? PRESETS.analyst : PRESETS[pipeline.preset];
  const layout = edit ?? base;
  const setLayout = (l: WorkspaceLayout) =>
    setEdit({ ...l, columns: l.columns.filter((c) => c.panels.length).map((c) => (c.heights?.length === c.panels.length ? c : { ...c, heights: undefined })) });
  const present = new Set(layout.columns.flatMap((c) => c.panels));

  const hide = (pid: PanelId) => {
    if (maximized === pid) setMaximized(null);
    setLayout({ ...cloneLayout(layout), columns: layout.columns.map((c) => ({ ...c, panels: c.panels.filter((p) => p !== pid) })) });
  };
  const showPanel = (pid: PanelId) => {
    const l = cloneLayout(layout);
    if (!l.columns.length) l.columns.push({ panels: [], size: 100 });
    l.columns[l.columns.length - 1].panels.push(pid);
    setLayout(l);
  };
  const movePanel = (pid: PanelId, dir: "left" | "right" | "up" | "down") => {
    const l = cloneLayout(layout);
    const ci = l.columns.findIndex((c) => c.panels.includes(pid));
    const col = l.columns[ci];
    const pi = col.panels.indexOf(pid);
    if (dir === "up" && pi > 0) [col.panels[pi - 1], col.panels[pi]] = [col.panels[pi], col.panels[pi - 1]];
    else if (dir === "down" && pi < col.panels.length - 1) [col.panels[pi + 1], col.panels[pi]] = [col.panels[pi], col.panels[pi + 1]];
    else if (dir === "left" || dir === "right") {
      const target = ci + (dir === "left" ? -1 : 1);
      col.panels.splice(pi, 1);
      if (target < 0) l.columns.unshift({ panels: [pid], size: 25 });
      else if (target >= l.columns.length) l.columns.push({ panels: [pid], size: 25 });
      else l.columns[target].panels.push(pid);
    }
    setLayout(l);
  };
  const choosePreset = (p: PresetId, layoutId?: string) => {
    setEdit(null);
    setMaximized(null);
    if (p === "custom" && !layoutId) {
      setCustomize(true);
      setLayout(cloneLayout(layout));
      return;
    }
    app.setPreset(pipeline.id, p, layoutId);
  };
  const saveLayout = (asNew: boolean) => {
    const existing = pipeline.preset === "custom" && !asNew ? layouts.find((l) => l.id === pipeline.customLayoutId) : undefined;
    const layoutName = existing?.name ?? window.prompt("Name this layout", asNew ? `${layout.name} copy` : "My layout")?.trim();
    if (!layoutName) return;
    const saved: WorkspaceLayout = { ...cloneLayout(layout), id: existing?.id ?? `layout_${Date.now().toString(36)}`, name: layoutName, builtIn: false };
    app.saveLayout(saved);
    app.setPreset(pipeline.id, "custom", saved.id);
    setEdit(null);
    app.toast("success", `Layout “${layoutName}” saved`);
  };

  const testRun = async () => {
    const r = await app.runPipeline(pipeline.id, "test");
    if (r)
      app.toast(
        r.status === "failed" ? "error" : r.reviewCount ? "warning" : "success",
        r.status === "failed" ? `Test run failed: ${r.error ?? "see logs"}` : `Test run on ${fmtInt(r.rowsIn)} rows: ${fmtInt(r.rowsOut)} ready to load, ${fmtInt(r.reviewCount)} need review.`,
      );
  };

  const saveVersion = () => {
    if (ws.draft) {
      app.toast("warning", "Apply or cancel the transformation you're editing first.");
      return;
    }
    const v = app.saveVersion(pipeline.id, "Saved");
    app.toast("success", `Saved as version v${v}`);
  };

  useHotkeys(
    {
      "mod+z": () => !ws.draft && app.undo(pipeline.id),
      "mod+shift+z": () => !ws.draft && app.redo(pipeline.id),
      "mod+y": () => !ws.draft && app.redo(pipeline.id),
      "mod+s": saveVersion,
      delete: () => {
        if (!ws.draft && ws.sel >= 0 && ws.sel < ws.spec.steps.length) ws.removeStep(ws.sel);
      },
      escape: () => {
        if (ws.column || ws.cell) {
          ws.setColumn(null);
          ws.setCell(null);
        } else if (maximized) setMaximized(null);
        else if (customize) setCustomize(false);
      },
    },
    [ws.draft, ws.sel, ws.column, ws.cell, ws.spec.steps.length, maximized, customize, pipeline.id],
  );

  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      ...TRANSFORMS.filter((t) => !t.later).map((t) => ({
        id: `add-${t.type}`,
        group: "Add transformation",
        title: t.title,
        description: t.description,
        keywords: t.keywords,
        icon: <Plus size={16} />,
        run: () => ws.addStep(t.type as StepType),
      })),
      { id: "run", group: "Pipeline", title: "Run pipeline", icon: <Play size={16} />, run: () => ws.setRunModal(true) },
      { id: "test", group: "Pipeline", title: "Test run", icon: <FlaskConical size={16} />, run: testRun },
      { id: "export", group: "Pipeline", title: "Export Python", icon: <Code2 size={16} />, run: () => nav(`/pipelines/${pipeline.id}/export`) },
      { id: "validate", group: "Pipeline", title: "Open validation", icon: <ShieldCheck size={16} />, run: () => nav(`/pipelines/${pipeline.id}/validate`) },
      { id: "review", group: "Pipeline", title: "Open review queue", icon: <ListChecks size={16} />, run: () => nav(`/pipelines/${pipeline.id}/review`) },
      { id: "save", group: "Pipeline", title: "Save version", keywords: "publish", icon: <Save size={16} />, run: saveVersion },
      ...PRESET_ORDER.filter((p) => p !== "custom").map((p) => ({
        id: `preset-${p}`,
        group: "Workspace",
        title: `${PRESET_LABEL[p]} workspace`,
        keywords: "preset layout",
        icon: <LayoutGrid size={16} />,
        run: () => choosePreset(p),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipeline.id, ws.addStep, ws.draft],
  );
  usePaletteActions("workspace", paletteActions);

  const results = ws.preview.result?.steps ?? [];
  const steps = ws.effective.steps;
  const presetLabel = pipeline.preset === "custom" ? layouts.find((l) => l.id === pipeline.customLayoutId)?.name ?? "Custom" : PRESET_LABEL[pipeline.preset];

  return (
    <div className="ws">
      <div className="ws-head">
        <input
          className="ws-title"
          value={name}
          aria-label="Pipeline name"
          size={Math.max(8, name.length)}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== pipeline.spec.name && ws.update((s) => ({ ...s, name: name.trim() }))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {pipeline.dirty ? <span className="badge">Draft</span> : <span className="badge outline">v{pipeline.version}</span>}
        {pipeline.dirty && pipeline.version > 0 && <span className="small subtle">edited since v{pipeline.version}</span>}
        <div className="row" style={{ gap: 2, marginLeft: 6 }}>
          <button className="btn ghost sm icon" title={`Undo (${MOD}+Z)`} aria-label="Undo" disabled={!history?.past.length || !!ws.draft} onClick={() => app.undo(pipeline.id)}>
            <Undo2 size={15} />
          </button>
          <button className="btn ghost sm icon" title={`Redo (${MOD}+Shift+Z)`} aria-label="Redo" disabled={!history?.future.length || !!ws.draft} onClick={() => app.redo(pipeline.id)}>
            <Redo2 size={15} />
          </button>
        </div>
        <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
          <button className="btn" onClick={(e) => presetMenu.open(e.currentTarget.getBoundingClientRect(), [
            ...PRESET_ORDER.filter((p) => p !== "custom").map((p) => ({ label: PRESET_LABEL[p], icon: pipeline.preset === p ? <Check size={15} /> : <span style={{ width: 15 }} />, onClick: () => choosePreset(p) })),
            ...(layouts.length ? [{ separator: true, label: "" }] : []),
            ...layouts.map((l) => ({ label: l.name, icon: pipeline.customLayoutId === l.id && pipeline.preset === "custom" ? <Check size={15} /> : <span style={{ width: 15 }} />, onClick: () => choosePreset("custom", l.id) })),
            { separator: true, label: "" },
            { label: "Customize workspace…", icon: <LayoutGrid size={15} />, onClick: () => setCustomize(true) },
          ])}>
            <LayoutGrid size={15} /> {presetLabel}
            {edit && <span className="dot" style={{ background: "var(--amber)" }} title="Unsaved layout changes" />}
          </button>
          <button className="btn" onClick={testRun} disabled={!!running || !ws.spec.source}>
            {running ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />} Test Run
          </button>
          <button className="btn" disabled title="Scheduled runs arrive in V1.x">
            <CalendarClock size={15} /> Schedule
          </button>
          <button className="btn primary" onClick={() => ws.setRunModal(true)} disabled={!!running || !ws.spec.source}>
            <Play size={15} /> Run
          </button>
          <Link className="btn soft" to={`/pipelines/${pipeline.id}/export`}>
            <Code2 size={15} /> Export Python
          </Link>
          <button
            className="btn icon"
            aria-label="More"
            onClick={(e) =>
              more.open(e.currentTarget.getBoundingClientRect(), [
                { label: "Save version", icon: <Save size={15} />, hint: `${MOD} S`, onClick: saveVersion },
                { label: "Versions…", icon: <History size={15} />, onClick: () => setVersions(true) },
                { label: "Validation", icon: <ShieldCheck size={15} />, onClick: () => nav(`/pipelines/${pipeline.id}/validate`) },
                { label: "Review queue", icon: <ListChecks size={15} />, onClick: () => nav(`/pipelines/${pipeline.id}/review`) },
                { label: "Customize workspace", icon: <LayoutGrid size={15} />, onClick: () => setCustomize(true) },
                { separator: true, label: "" },
                { label: "Duplicate pipeline", icon: <Copy size={15} />, onClick: () => { const p = app.duplicatePipeline(pipeline.id); if (p) nav(`/pipelines/${p.id}`); } },
                {
                  label: "Delete pipeline",
                  icon: <Trash2 size={15} />,
                  danger: true,
                  onClick: async () => {
                    if (await confirmAction({ title: "Delete pipeline?", body: `"${pipeline.spec.name}" and its versions will be deleted. Source files and run history are kept.`, confirmLabel: "Delete", danger: true })) {
                      app.deletePipeline(pipeline.id);
                      nav("/pipelines");
                    }
                  },
                },
              ])
            }
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="stepper" role="list" aria-label="Pipeline stages">
        <button className={`stp ${ws.spec.source ? "ok" : ""} ${ws.sel === SOURCE ? "on" : ""}`} onClick={() => !ws.draft && ws.setSel(SOURCE)} role="listitem">
          <span className="n">01</span>
          <span>
            <div className="t">Source</div>
            <div className="d">{ws.spec.source?.file ?? "Choose source"}</div>
          </span>
        </button>
        {steps.map((s, i) => (
          <Fragment key={s.id}>
            <span className="stp-line" />
            <button className={`stp ${stepState(results[i])} ${ws.sel === i ? "on" : ""}`} onClick={() => !ws.draft && ws.setSel(i)} role="listitem" title={describeStep(s).detail}>
              <span className="n">{String(i + 2).padStart(2, "0")}</span>
              <span>
                <div className="t">{STAGE_OF[s.type]}</div>
                <div className="d">{stepTitle(s)}</div>
              </span>
            </button>
          </Fragment>
        ))}
        <span className="stp-line" />
        <button className={`stp ${ws.isLoad ? "on" : ""}`} onClick={() => !ws.draft && ws.setSel(steps.length)} role="listitem">
          <span className="n">{String(steps.length + 2).padStart(2, "0")}</span>
          <span>
            <div className="t">Load</div>
            <div className="d">{ws.spec.destination ? (ws.spec.destination.type === "database" ? ws.spec.destination.table || "Database" : `${(ws.spec.destination.format ?? "csv").toUpperCase()} file`) : "Set destination"}</div>
          </span>
        </button>
      </div>

      <div className="ws-body">
        <LayoutCtl.Provider value={{ hide, toggleMax: (p) => setMaximized((m) => (m === p ? null : p)), maximized }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {maximized ? (
              <MaxPanel id={maximized} />
            ) : layout.columns.length === 0 ? (
              <Empty icon={<LayoutGrid size={22} />} title="All panels are hidden" action={<button className="btn" onClick={() => setEdit(null)}>Reset layout</button>} />
            ) : (
              <PanelGroup key={layout.id + layout.columns.map((c) => c.panels.join(",")).join("|")} direction="horizontal">
                {layout.columns.map((col, ci) => (
                  <Fragment key={ci}>
                    {ci > 0 && <PanelResizeHandle className="resize-h" />}
                    <Panel defaultSize={col.size} minSize={12}>
                      <PanelGroup direction="vertical">
                        {col.panels.map((pid, pi) => {
                          const C = PANELS[pid];
                          return (
                            <Fragment key={pid}>
                              {pi > 0 && <PanelResizeHandle className="resize-v" />}
                              <Panel defaultSize={col.heights?.length === col.panels.length ? col.heights[pi] : 100 / col.panels.length} minSize={10}>
                                <C />
                              </Panel>
                            </Fragment>
                          );
                        })}
                      </PanelGroup>
                    </Panel>
                  </Fragment>
                ))}
              </PanelGroup>
            )}
          </div>
        </LayoutCtl.Provider>
        {customize && (
          <aside className="drawer panel" aria-label="Customize workspace">
            <div className="panel-head">
              <h3>Customize workspace</h3>
              <button className="btn ghost xs icon" aria-label="Close" onClick={() => setCustomize(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="panel-body pad">
              <div className="section-title">Panel library</div>
              <div className="col" style={{ gap: 2 }}>
                {ALL_PANELS.map((pid) => {
                  const on = present.has(pid);
                  return (
                    <div key={pid} className="row" style={{ padding: "5px 4px", borderRadius: 6 }}>
                      <button className="btn ghost xs icon" aria-label={on ? `Hide ${PANEL_TITLES[pid]}` : `Show ${PANEL_TITLES[pid]}`} onClick={() => (on ? hide(pid) : showPanel(pid))}>
                        {on ? <Eye size={14} color="var(--blue)" /> : <EyeOff size={14} color="var(--subtle)" />}
                      </button>
                      <span className="grow" style={{ color: on ? "var(--ink)" : "var(--subtle)", fontWeight: on ? 550 : 450 }}>
                        {PANEL_TITLES[pid]}
                      </span>
                      {on && (
                        <span className="row" style={{ gap: 0 }}>
                          <button className="btn ghost xs icon" aria-label="Move left" onClick={() => movePanel(pid, "left")}>
                            <ChevronLeft size={13} />
                          </button>
                          <button className="btn ghost xs icon" aria-label="Move up" onClick={() => movePanel(pid, "up")}>
                            <ChevronUp size={13} />
                          </button>
                          <button className="btn ghost xs icon" aria-label="Move down" onClick={() => movePanel(pid, "down")}>
                            <ChevronDown size={13} />
                          </button>
                          <button className="btn ghost xs icon" aria-label="Move right" onClick={() => movePanel(pid, "right")}>
                            <ChevronRight size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="hint" style={{ margin: "8px 0 14px" }}>
                Drag the dividers between panels to resize. Presets change the arrangement of panels, never the pipeline.
              </div>
              <div className="section-title">Layout actions</div>
              <div className="col">
                <button className="btn primary" onClick={() => saveLayout(false)}>
                  Save layout
                </button>
                <button className="btn" onClick={() => saveLayout(true)}>
                  Save as new layout
                </button>
                <button className="btn" onClick={() => setEdit(null)} disabled={!edit}>
                  Reset layout
                </button>
                {pipeline.preset === "custom" && pipeline.customLayoutId && (
                  <button
                    className="btn danger"
                    onClick={() => {
                      app.deleteLayout(pipeline.customLayoutId!);
                      app.setPreset(pipeline.id, "analyst");
                      setEdit(null);
                    }}
                  >
                    Delete this layout
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      <TransformPicker />
      {ws.runModal && <RunModal onClose={() => ws.setRunModal(false)} />}
      {versions && <VersionsModal onClose={() => setVersions(false)} />}
      {more.node}
      {presetMenu.node}
    </div>
  );
}

function MaxPanel({ id }: { id: PanelId }) {
  const C = PANELS[id];
  return <C />;
}

function RunModal({ onClose }: { onClose: () => void }) {
  const ws = useWs();
  const nav = useNavigate();
  const app = useApp.getState();
  const [mode, setMode] = useState<"current" | "other">("current");
  const [other, setOther] = useState<{ id: string; name: string; missing: string[]; rows: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const p = ws.pipeline;
  const nextVersion = p.dirty || !p.version ? p.version + 1 : p.version;
  const needed = ws.preview.result?.input.columns ?? [];

  const pick = async (f: File) => {
    setBusy(true);
    try {
      const parsed = await parseFile(f);
      const meta = await app.addSource(parsed.source);
      const spec = defaultSourceSpec(parsed.source, ws.spec.source?.sheet);
      const sheet = parsed.source.sheets.find((s) => s.name === spec.sheet) ?? parsed.source.sheets[0];
      const ds = loadDataset(sheet, spec);
      setOther({ id: meta.id, name: meta.name, missing: needed.filter((c) => !ds.columns.includes(c)), rows: ds.rows.length });
    } catch (e) {
      app.toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    onClose();
    const r = await app.runPipeline(p.id, "manual", mode === "other" && other ? { sourceFileId: other.id } : {});
    if (r) nav(`/runs/${r.id}`);
  };

  return (
    <Modal
      title="Run pipeline"
      icon={<Play size={18} color="var(--blue)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={run} disabled={busy || (mode === "other" && (!other || other.missing.length > 0))}>
            <Play size={15} /> Run v{nextVersion}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="muted">
          Runs execute every row in a background worker and reference an immutable version.
          {p.dirty && ` Your draft changes will be saved as v${nextVersion}.`}
        </div>
        <label className={`option ${mode === "current" ? "on" : ""}`}>
          <input type="radio" checked={mode === "current"} onChange={() => setMode("current")} />
          <div>
            <div className="t">Current source</div>
            <div className="d">{ws.spec.source?.file}</div>
          </div>
        </label>
        <label className={`option ${mode === "other" ? "on" : ""}`}>
          <input type="radio" checked={mode === "other"} onChange={() => setMode("other")} />
          <div className="grow">
            <div className="t">A new compatible file</div>
            <div className="d">Rerun the same pipeline on new data — no cleaning steps repeated.</div>
            {mode === "other" && (
              <div style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                  {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} Choose file
                </button>
                <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
                {other && (
                  <div className={`callout ${other.missing.length ? "red" : "green"}`} style={{ marginTop: 8 }}>
                    {other.missing.length ? (
                      <>Not compatible: missing columns {other.missing.join(", ")}.</>
                    ) : (
                      <>
                        <Check size={16} /> {other.name} is compatible ({fmtInt(other.rows)} rows).
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </label>
      </div>
    </Modal>
  );
}

function VersionsModal({ onClose }: { onClose: () => void }) {
  const ws = useWs();
  const p = ws.pipeline;
  const runs = useApp((s) => s.runs.filter((r) => r.pipelineId === p.id && r.mode === "manual"));
  return (
    <Modal title="Pipeline versions" icon={<History size={18} />} onClose={onClose} size="lg">
      {p.versions.length === 0 ? (
        <div className="muted">No versions yet. Save (Ctrl/⌘ S) or run the pipeline to create an immutable version.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Created</th>
              <th>Reason</th>
              <th>Steps</th>
              <th>Runs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...p.versions].reverse().map((v) => (
              <tr key={v.version}>
                <td>
                  <span className="badge outline">v{v.version}</span>
                </td>
                <td>{fmtDateTime(v.createdAt)}</td>
                <td>{v.reason}</td>
                <td className="num">{v.spec.steps.length}</td>
                <td className="num">{runs.filter((r) => r.version === v.version).length}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      if (await confirmAction({ title: `Restore v${v.version} as draft?`, body: "Your current draft is replaced (you can undo). Existing versions and runs are unchanged.", confirmLabel: "Restore" })) {
                        ws.update(() => JSON.parse(JSON.stringify(v.spec)));
                        onClose();
                      }
                    }}
                  >
                    Restore as draft
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
