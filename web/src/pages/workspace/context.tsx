import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Dataset, ExecutionResult, Issue, PipelineSpec, Step, StepType } from "@/engine/types";
import type { Pipeline, Run } from "@/store/model";
import { useApp } from "@/store/app";
import { usePreview } from "@/lib/hooks";
import { makeStep } from "@/lib/stepDefaults";
import { newId, stepTitle } from "@/engine/registry";
import type { CellPos } from "@/components/DataGrid";

export interface Draft {
  step: Step;
  index: number;
  isNew: boolean;
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
  pickerOpen: { column?: string } | null;
  openPicker(column?: string): void;
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
  const [pickerOpen, setPickerOpen] = useState<{ column?: string } | null>(null);
  const [runModal, setRunModal] = useState(false);

  const effective = useMemo(() => effectiveSpec(spec, draft), [spec, draft]);
  const preview = usePreview(effective);
  const total = effective.steps.length;
  const sel = draft ? draft.index : Math.min(selRaw, total);

  const setSel = useCallback((i: number) => {
    setSelRaw(i);
    setCell(null);
  }, []);

  const update = useCallback((fn: (s: PipelineSpec) => PipelineSpec, key?: string) => updateSpec(pipeline.id, fn, key), [pipeline.id, updateSpec]);

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
  const datasetBefore = useCallback((i: number) => (i <= 0 ? preview.result?.input : preview.result?.snapshots?.[i - 1]), [preview.result]);
  const issuesFor = useCallback((stepId: string) => preview.result?.issues.filter((x) => x.stepId === stepId) ?? [], [preview.result]);

  const startDraft = useCallback((d: Draft) => {
    setDraft(d);
    setColumn(null);
    setCell(null);
  }, []);

  const addStep = useCallback(
    (type: StepType | "lookup", col?: string) => {
      const at = draft ? draft.index : Math.min(Math.max(sel, SOURCE) + 1, spec.steps.length);
      const base = at <= 0 ? preview.result?.input : preview.result?.snapshots?.[at - 1] ?? preview.result?.beforeGate;
      if (!spec.source) {
        toast("warning", "Add a source first.");
        return;
      }
      const step = makeStep(type, base, col ?? column ?? undefined, dateFormat);
      startDraft({ step, index: at, isNew: true });
      setPickerOpen(null);
    },
    [draft, sel, spec.steps.length, spec.source, preview.result, column, dateFormat, startDraft, toast],
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
      update((s) => ({ ...s, steps: s.steps.filter((_, k) => k !== i) }));
      setSelRaw(Math.min(i, spec.steps.length - 2));
      toast("info", `Removed “${stepTitle(step)}”. Undo with Ctrl/⌘ Z.`);
    },
    [spec.steps, update, toast],
  );

  const moveStep = useCallback(
    (from: number, to: number) => {
      if (from === to || to < 0 || to >= spec.steps.length) return;
      update((s) => {
        const steps = s.steps.slice();
        const [x] = steps.splice(from, 1);
        steps.splice(to, 0, x);
        return { ...s, steps };
      });
      setSelRaw(to);
    },
    [spec.steps.length, update],
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
    openPicker: (c) => setPickerOpen({ column: c ?? column ?? undefined }),
    closePicker: () => setPickerOpen(null),
    latestRun,
    runModal,
    setRunModal,
  };
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
