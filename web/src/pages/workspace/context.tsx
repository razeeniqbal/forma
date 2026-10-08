import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Dataset, ExecutionResult, Issue, PipelineSpec, Step, StepType } from "@/engine/types";
import type { Pipeline, Run } from "@/store/model";
import { useApp } from "@/store/app";
import { usePreview } from "@/lib/hooks";
import { makeStep } from "@/lib/stepDefaults";
import { newId, stepTitle } from "@/engine/registry";
import type { CellPos } from "@/components/DataGrid";
import type { ToolCategory } from "@/engine/taxonomy";
import type { InputRoleId } from "@/engine/graph/types";
import { addLoad as addGraphLoad, removeLoad as removeGraphLoad, connect as connectEdge, disconnect as disconnectEdge, insertStep, reconnect as reconnectEdge, removeStep as removeGraphStep, syncCombineInputs, type EditResult } from "@/engine/graph/spec";
import { LOAD_ID, PRIMARY_ID } from "@/engine/graph/model";
import { confirmAction } from "@/components/ui";

export interface Draft {
  step: Step;
  index: number;
  isNew: boolean;
  /** Pipelines with explicit connections: where a new step is connected. */
  at?: { edge: string } | { after: string };
}

export const SOURCE = -1;

export interface Ctx {
  pipeline: Pipeline;
  spec: PipelineSpec;
  /** Spec including the unapplied draft (what the preview shows). */
  effective: PipelineSpec;
  preview: { result?: ExecutionResult; error?: string; loading: boolean; sampled: boolean };
  sel: number;
  setSel(i: number): void;
  isLoad: boolean;
  column: string | null;
  setColumn(c: string | null): void;
  cell: CellPos | null;
  setCell(c: CellPos | null): void;
  draft: Draft | null;
  startDraft(d: Draft): void;
  updateDraft(step: Step): void;
  applyDraft(): void;
  discardDraft(): void;
  addStep(type: StepType | "lookup", column?: string): void;
  insertPreset(steps: Step[]): void;
  editStep(i: number): void;
  removeStep(i: number): void;
  moveStep(from: number, to: number): void;
  update(fn: (s: PipelineSpec) => PipelineSpec, key?: string): void;
  datasetAfter(i: number): Dataset | undefined;
  datasetBefore(i: number): Dataset | undefined;
  issuesFor(stepId: string): Issue[];
  pickerOpen: { column?: string; category?: ToolCategory } | null;
  openPicker(column?: string, category?: ToolCategory): void;
  /** Ask the pipeline view to select a node and open its inspector (optionally in edit mode). */
  inspectRequest: { index: number; edit: boolean; n: number; nodeId?: string } | null;
  inspect(index: number, edit?: boolean, nodeId?: string): void;
  /** Branching: a new Load reading the selected node's output. Opens its destination settings. */
  addLoad(): void;
  removeLoad(id: string): void;
  /** Where the next new step connects: on a connection (the + on it) or after a node (e.g. a source node). */
  insertOn(at: Draft["at"] | null): void;
  /** Editing connections. Each validates first; an edit that leaves the pipeline incomplete asks to confirm. */
  connect(from: string, to: string, role: InputRoleId): Promise<boolean>;
  disconnect(edgeId: string): Promise<boolean>;
  reconnect(edgeId: string, change: { from?: string; to?: string; role?: InputRoleId }): Promise<boolean>;
  closePicker(): void;
  latestRun?: Run;
  runModal: boolean;
  setRunModal(v: boolean): void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function useWs(): Ctx {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("Workspace context missing");
  return c;
}

export function effectiveSpec(spec: PipelineSpec, draft: Draft | null): PipelineSpec {
  if (!draft) return spec;
  if (spec.graph) {
    if (draft.isNew) return insertStep(spec, draft.step, draft.index, draft.at ?? { after: draft.index > 0 ? spec.steps[draft.index - 1].id : PRIMARY_ID });
    return syncCombineInputs({ ...spec, steps: spec.steps.map((s, i) => (i === draft.index ? draft.step : s)) });
  }
  const steps = spec.steps.slice();
  if (draft.isNew) steps.splice(draft.index, 0, draft.step);
  else steps[draft.index] = draft.step;
  return { ...spec, steps };
}

export function WorkspaceProvider({ pipeline, children }: { pipeline: Pipeline; children: ReactNode }) {
  const updateSpec = useApp((s) => s.updateSpec);
  const toast = useApp((s) => s.toast);
  const dateFormat = useApp((s) => s.settings.defaultDateFormat);
  const latestRun = useApp((s) => s.runs.find((r) => r.pipelineId === pipeline.id));
  const spec = pipeline.spec;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selRaw, setSelRaw] = useState<number>(spec.steps.length ? spec.steps.length - 1 : SOURCE);
  const [column, setColumn] = useState<string | null>(null);
  const [cell, setCell] = useState<CellPos | null>(null);
  const [pickerOpen, setPickerOpen] = useState<{ column?: string; category?: ToolCategory } | null>(null);
  const [inspectRequest, setInspectRequest] = useState<Ctx["inspectRequest"]>(null);
  const [insertAt, setInsertAt] = useState<Draft["at"] | null>(null);
  const [runModal, setRunModal] = useState(false);

  const effective = useMemo(() => effectiveSpec(spec, draft), [spec, draft]);
  const preview = usePreview(effective);
  const total = effective.steps.length;
  const sel = draft ? draft.index : Math.min(selRaw, total);

  const setSel = useCallback((i: number) => {
    setSelRaw(i);
    setCell(null);
  }, []);

  // Combine steps and their connections stay consistent on every edit.
  const update = useCallback((fn: (s: PipelineSpec) => PipelineSpec, key?: string) => updateSpec(pipeline.id, (s) => syncCombineInputs(fn(s)), key), [pipeline.id, updateSpec]);

  const datasetAfter = useCallback(
    (i: number) => {
      const r = preview.result;
      if (!r) return undefined;
      if (i < 0) return r.input;
      if (i >= total) return r.output;
      return r.snapshots?.[i];
    },
    [preview.result, total],
  );
  // With explicit connections a step reads its connected input, not the step listed before it.
  const datasetBefore = useCallback(
    (i: number) => (preview.result?.stepInputs ? preview.result.stepInputs[i] : i <= 0 ? preview.result?.input : preview.result?.snapshots?.[i - 1]),
    [preview.result],
  );
  const issuesFor = useCallback((stepId: string) => preview.result?.issues.filter((x) => x.stepId === stepId) ?? [], [preview.result]);

  const startDraft = useCallback((d: Draft) => {
    setDraft(d);
    setColumn(null);
    setCell(null);
  }, []);

  const addStep = useCallback(
    (type: StepType | "lookup", col?: string) => {
      const at = draft ? draft.index : Math.min(Math.max(sel, SOURCE) + 1, spec.steps.length);
      if (!spec.source) {
        toast("warning", "Add a source first.");
        return;
      }
      // Where it connects: on the chosen connection, after the selected node, or into Load.
      let link: Draft["at"];
      let base: Dataset | undefined = at <= 0 ? preview.result?.input : preview.result?.snapshots?.[at - 1] ?? preview.result?.beforeGate;
      if (spec.graph) {
        const loadEdge = spec.graph.edges.find((e) => e.to === LOAD_ID);
        link = insertAt ? insertAt : sel >= spec.steps.length ? (loadEdge ? { edge: loadEdge.id } : { after: spec.steps.at(-1)?.id ?? PRIMARY_ID }) : { after: sel === SOURCE ? PRIMARY_ID : spec.steps[sel].id };
        const fromId = "edge" in link ? spec.graph.edges.find((e) => e.id === (link as { edge: string }).edge)?.from : link.after;
        const fi = spec.steps.findIndex((s) => s.id === fromId);
        base = fromId === PRIMARY_ID ? preview.result?.input : fi >= 0 ? preview.result?.snapshots?.[fi] : base;
      }
      const step = makeStep(type, base, col ?? column ?? undefined, dateFormat);
      startDraft({ step, index: at, isNew: true, at: link });
      setInsertAt(null);
      setPickerOpen(null);
    },
    [draft, sel, spec.steps, spec.graph, spec.source, preview.result, column, dateFormat, startDraft, toast, insertAt],
  );

  const insertPreset = useCallback(
    (steps: Step[]) => {
      const fresh = steps.map((s) => ({ ...JSON.parse(JSON.stringify(s)), id: newId(s.type.slice(0, 4)) }) as Step);
      const at = Math.min(Math.max(sel, SOURCE) + 1, spec.steps.length);
      setPickerOpen(null);
      if (fresh.length === 1) {
        startDraft({ step: fresh[0], index: at, isNew: true });
        return;
      }
      update((s) => ({ ...s, steps: [...s.steps.slice(0, at), ...fresh, ...s.steps.slice(at)] }));
      setSelRaw(at + fresh.length - 1);
      toast("success", `Inserted ${fresh.length} steps from preset. Undo with Ctrl/⌘ Z.`);
    },
    [sel, spec.steps.length, startDraft, update, toast],
  );

  const applyDraft = useCallback(() => {
    if (!draft) return;
    const d = draft;
    update((s) => effectiveSpec(s, d));
    setDraft(null);
    setSelRaw(d.index);
    toast("success", `${d.isNew ? "Added" : "Updated"} “${stepTitle(d.step)}”`);
  }, [draft, update, toast]);

  const discardDraft = useCallback(() => {
    if (draft) setSelRaw(draft.isNew ? Math.max(SOURCE, draft.index - 1) : draft.index);
    setDraft(null);
  }, [draft]);

  const editStep = useCallback(
    (i: number) => {
      const step = spec.steps[i];
      if (step) startDraft({ step: JSON.parse(JSON.stringify(step)), index: i, isNew: false });
    },
    [spec.steps, startDraft],
  );

  const removeStep = useCallback(
    (i: number) => {
      const step = spec.steps[i];
      if (!step) return;
      update((s) => (s.graph ? removeGraphStep(s, i) : { ...s, steps: s.steps.filter((_, k) => k !== i) }));
      setSelRaw(Math.min(i, spec.steps.length - 2));
      toast("info", `Removed “${stepTitle(step)}”. Undo with Ctrl/⌘ Z.`);
    },
    [spec.steps, update, toast],
  );

  const moveStep = useCallback(
    (from: number, to: number) => {
      if (from === to || to < 0 || to >= spec.steps.length) return;
      if (spec.graph) {
        toast("info", "This pipeline runs in the order of its connections. Reconnect tools on the canvas to change it.");
        return;
      }
      update((s) => {
        const steps = s.steps.slice();
        const [x] = steps.splice(from, 1);
        steps.splice(to, 0, x);
        return { ...s, steps };
      });
      setSelRaw(to);
    },
    [spec.steps.length, spec.graph, update, toast],
  );

  /** Apply a connection edit; confirm first when it leaves the pipeline incomplete. */
  const applyEdit = useCallback(
    async (make: (s: PipelineSpec) => EditResult): Promise<boolean> => {
      const r = make(spec);
      if (!r.ok) {
        toast("warning", r.reason);
        return false;
      }
      if (r.problems.length) {
        const ok = await confirmAction({
          title: "Keep this change?",
          body: `${r.problems.map((p) => p.message).join(" ")} The pipeline will not run until this is fixed.`,
          confirmLabel: "Keep change",
        });
        if (!ok) return false;
      }
      update(() => r.spec);
      return true;
    },
    [spec, toast, update],
  );

  const value: Ctx = {
    pipeline,
    spec,
    effective,
    preview,
    sel,
    setSel,
    isLoad: sel >= total,
    column,
    setColumn,
    cell,
    setCell,
    draft,
    startDraft,
    updateDraft: (step) => setDraft((d) => (d ? { ...d, step } : d)),
    applyDraft,
    discardDraft,
    addStep,
    insertPreset,
    editStep,
    removeStep,
    moveStep,
    update,
    datasetAfter,
    datasetBefore,
    issuesFor,
    pickerOpen,
    openPicker: (c, category) => setPickerOpen({ column: c ?? column ?? undefined, category }),
    inspectRequest,
    insertOn: setInsertAt,
    connect: (from, to, role) => applyEdit((s) => connectEdge(s, from, to, role)),
    disconnect: (edgeId) => applyEdit((s) => disconnectEdge(s, edgeId)),
    reconnect: (edgeId, change) => applyEdit((s) => reconnectEdge(s, edgeId, change)),
    inspect: (index, edit = false, nodeId) => {
      setPickerOpen(null);
      setSelRaw(index);
      setInspectRequest((r) => ({ index, edit, nodeId, n: (r?.n ?? 0) + 1 }));
    },
    addLoad: () => {
      if (draft) return;
      const after = insertAt && "after" in insertAt ? insertAt.after : sel === SOURCE ? PRIMARY_ID : sel < spec.steps.length ? spec.steps[sel].id : spec.steps.at(-1)?.id ?? PRIMARY_ID;
      const r = addGraphLoad(spec, after);
      update(() => r.spec);
      setInsertAt(null);
      setPickerOpen(null);
      setInspectRequest((q) => ({ index: spec.steps.length, edit: true, nodeId: r.id, n: (q?.n ?? 0) + 1 }));
      toast("success", "Added a Load. Set where this branch is written.");
    },
    removeLoad: (id) => {
      update((s) => removeGraphLoad(s, id));
      toast("info", "Removed the Load. Undo with Ctrl/⌘ Z.");
    },
    closePicker: () => setPickerOpen(null),
    latestRun,
    runModal,
    setRunModal,
  };
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
