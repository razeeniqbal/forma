import { create } from "zustand";
import type { PipelineSpec, SourceFile, SourceSpec } from "@/engine/types";
import { detectRegion } from "@/engine/load";
import { newId, stepTitle, STAGE_OF } from "@/engine/registry";
import { toText } from "@/engine/values";
import { executeInWorker } from "@/lib/runner";
import * as db from "./db";
import type {
  Connection,
  Pipeline,
  PresetId,
  Run,
  RunLog,
  RunStep,
  Settings,
  SourceMeta,
  WorkspaceLayout,
} from "./model";

const DEFAULT_SETTINGS: Settings = {
  userName: "You",
  previewRows: 2000,
  defaultPreset: "analyst",
  defaultDateFormat: "YYYY-MM-DD",
  testRunRows: 200,
};

interface History {
  past: PipelineSpec[];
  future: PipelineSpec[];
  lastKey?: string;
  lastAt?: number;
}

interface Toast {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
}

interface AppState {
  ready: boolean;
  pipelines: Pipeline[];
  runs: Run[];
  sources: SourceMeta[];
  connections: Connection[];
  layouts: WorkspaceLayout[];
  settings: Settings;
  history: Record<string, History>;
  toasts: Toast[];
  runningPipelines: Record<string, string>;

  hydrate(): Promise<void>;
  toast(kind: Toast["kind"], message: string): void;
  dismissToast(id: string): void;

  addSource(file: SourceFile): Promise<SourceMeta>;
  deleteSource(id: string): Promise<void>;

  createPipeline(name: string, source: SourceMeta | null, preset: PresetId, destination?: PipelineSpec["destination"]): Promise<Pipeline>;
  createPipelineFromSpec(spec: PipelineSpec, preset?: PresetId): Pipeline;
  updateSpec(id: string, fn: (s: PipelineSpec) => PipelineSpec, coalesceKey?: string): void;
  undo(id: string): void;
  redo(id: string): void;
  setPreset(id: string, preset: PresetId, layoutId?: string): void;
  saveVersion(id: string, reason?: string): number;
  duplicatePipeline(id: string): Pipeline | undefined;
  deletePipeline(id: string): void;

  runPipeline(id: string, mode: "test" | "manual", opts?: { sourceFileId?: string }): Promise<Run | undefined>;
  deleteRun(id: string): void;

  saveLayout(layout: WorkspaceLayout): void;
  deleteLayout(id: string): void;
  addConnection(c: Omit<Connection, "id" | "createdAt">): Connection;
  deleteConnection(id: string): void;
  updateSettings(p: Partial<Settings>): void;
  resetAll(): Promise<void>;
}

const timers: Record<string, ReturnType<typeof setTimeout>> = {};
function persist(key: string, value: unknown) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => void db.save(key, value), 250);
}

export function sourceMetaFrom(file: SourceFile): SourceMeta {
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    size: file.size,
    addedAt: file.addedAt,
    lastUsedAt: Date.now(),
    sheets: file.sheets.map((s) => ({
      name: s.name,
      rows: detectRegion(s).dataRows,
      cols: s.cells.reduce((m, r) => Math.max(m, r.length), 0),
    })),
  };
}

export function defaultSourceSpec(file: SourceFile, sheetName?: string): SourceSpec {
  const sheet = file.sheets.find((s) => s.name === sheetName) ?? file.sheets[0];
  const r = detectRegion(sheet);
  return {
    type: file.kind,
    file: file.name,
    fileId: file.id,
    ...(file.kind === "excel" ? { sheet: sheet.name } : {}),
    headerRow: file.kind === "text" ? -1 : r.headerRow,
    startCol: r.startCol,
    endCol: r.endCol,
    ...(file.kind === "csv" ? { csvDelimiter: file.delimiter ?? "," } : {}),
  };
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  pipelines: [],
  runs: [],
  sources: [],
  connections: [],
  layouts: [],
  settings: DEFAULT_SETTINGS,
  history: {},
  toasts: [],
  runningPipelines: {},

  async hydrate() {
    const [pipelines, runs, sources, connections, layouts, settings] = await Promise.all([
      db.load<Pipeline[]>("pipelines"),
      db.load<Run[]>("runs"),
      db.load<SourceMeta[]>("sources"),
      db.load<Connection[]>("connections"),
      db.load<WorkspaceLayout[]>("layouts"),
      db.load<Settings>("settings"),
    ]);
    set({
      ready: true,
      pipelines: pipelines ?? [],
      // Runs interrupted by a reload can never finish.
      runs: (runs ?? []).map((r) => (r.status === "running" ? { ...r, status: "cancelled" as const } : r)),
      sources: sources ?? [],
      connections: connections ?? [],
      layouts: layouts ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    });
  },

  toast(kind, message) {
    const id = newId("t");
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3800);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async addSource(input) {
    const { raw, ...file } = input;
    if (raw) await db.putRawFile(file.id, raw);
    await db.putSourceFile(file);
    const meta = sourceMetaFrom(file);
    const sources = [meta, ...get().sources.filter((s) => s.id !== meta.id)];
    set({ sources });
    persist("sources", sources);
    return meta;
  },
  async deleteSource(id) {
    const sources = get().sources.filter((s) => s.id !== id);
    set({ sources });
    persist("sources", sources);
    await db.deleteSourceFile(id);
  },

  async createPipeline(name, source, preset, destination = null) {
    let spec: PipelineSpec = { name, source: null, steps: [], destination, reviewDecisions: [] };
    if (source) {
      const file = await db.getSourceFile(source.id);
      if (file) spec = { ...spec, source: defaultSourceSpec(file) };
      const sources = get().sources.map((s) => (s.id === source.id ? { ...s, lastUsedAt: Date.now() } : s));
      set({ sources });
      persist("sources", sources);
    }
    return get().createPipelineFromSpec(spec, preset);
  },

  createPipelineFromSpec(spec, preset) {
    const p: Pipeline = {
      id: newId("p"),
      spec,
      version: 0,
      versions: [],
      dirty: true,
      preset: preset ?? get().settings.defaultPreset,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const pipelines = [p, ...get().pipelines];
    set({ pipelines });
    persist("pipelines", pipelines);
    return p;
  },

  updateSpec(id, fn, coalesceKey) {
    const p = get().pipelines.find((x) => x.id === id);
    if (!p) return;
    const next = fn(p.spec);
    if (next === p.spec) return;
    const h = get().history[id] ?? { past: [], future: [] };
    const now = Date.now();
    // Coalesce rapid edits of the same field (typing) into one undo entry.
    const coalesce = coalesceKey && h.lastKey === coalesceKey && now - (h.lastAt ?? 0) < 1200;
    const past = coalesce ? h.past : [...h.past.slice(-99), p.spec];
    const pipelines = get().pipelines.map((x) => (x.id === id ? { ...x, spec: next, dirty: true, updatedAt: now } : x));
    set({ pipelines, history: { ...get().history, [id]: { past, future: [], lastKey: coalesceKey, lastAt: now } } });
    persist("pipelines", pipelines);
  },

  undo(id) {
    const h = get().history[id];
    const p = get().pipelines.find((x) => x.id === id);
    if (!h?.past.length || !p) return;
    const prev = h.past[h.past.length - 1];
    const pipelines = get().pipelines.map((x) => (x.id === id ? { ...x, spec: prev, dirty: true, updatedAt: Date.now() } : x));
    set({ pipelines, history: { ...get().history, [id]: { past: h.past.slice(0, -1), future: [p.spec, ...h.future] } } });
    persist("pipelines", pipelines);
  },

  redo(id) {
    const h = get().history[id];
    const p = get().pipelines.find((x) => x.id === id);
    if (!h?.future.length || !p) return;
    const [next, ...rest] = h.future;
    const pipelines = get().pipelines.map((x) => (x.id === id ? { ...x, spec: next, dirty: true, updatedAt: Date.now() } : x));
    set({ pipelines, history: { ...get().history, [id]: { past: [...h.past, p.spec], future: rest } } });
    persist("pipelines", pipelines);
  },

  setPreset(id, preset, layoutId) {
    const pipelines = get().pipelines.map((x) => (x.id === id ? { ...x, preset, customLayoutId: layoutId ?? x.customLayoutId } : x));
    set({ pipelines });
    persist("pipelines", pipelines);
  },

  saveVersion(id, reason = "Saved") {
    const p = get().pipelines.find((x) => x.id === id);
    if (!p) return 0;
    if (!p.dirty && p.version > 0) return p.version;
    const version = p.version + 1;
    const snapshot = JSON.parse(JSON.stringify(p.spec)) as PipelineSpec;
    const pipelines = get().pipelines.map((x) =>
      x.id === id ? { ...x, version, dirty: false, versions: [...x.versions, { version, spec: snapshot, createdAt: Date.now(), reason }] } : x,
    );
    set({ pipelines });
    persist("pipelines", pipelines);
    return version;
  },

  duplicatePipeline(id) {
    const p = get().pipelines.find((x) => x.id === id);
    if (!p) return;
    return get().createPipelineFromSpec({ ...JSON.parse(JSON.stringify(p.spec)), name: `${p.spec.name} (copy)` }, p.preset);
  },

  deletePipeline(id) {
    const pipelines = get().pipelines.filter((x) => x.id !== id);
    set({ pipelines });
    persist("pipelines", pipelines);
  },

  async runPipeline(id, mode, opts = {}) {
    const p = get().pipelines.find((x) => x.id === id);
    if (!p || !p.spec.source) {
      get().toast("error", "Add a source before running the pipeline.");
      return;
    }
    const fileId = opts.sourceFileId ?? p.spec.source.fileId;
    const file = await db.getSourceFile(fileId);
    if (!file) {
      get().toast("error", "The source file is no longer available. Upload it again from the Source step.");
      return;
    }
    const sheet = file.sheets.find((s) => s.name === p.spec.source!.sheet) ?? file.sheets[0];
    // Manual runs reference an immutable version (PRD §12).
    const version = mode === "manual" ? get().saveVersion(id, "Run") : p.version;
    const spec: PipelineSpec = mode === "manual" ? get().pipelines.find((x) => x.id === id)!.versions.at(-1)!.spec : p.spec;
    // A compatible replacement file gets its own header/region detection.
    const runSpec: PipelineSpec =
      fileId === spec.source!.fileId ? spec : { ...spec, source: { ...defaultSourceSpec(file, spec.source!.sheet), fileId, file: file.name } };
    const dest = spec.destination;
    const conn = dest?.type === "database" ? get().connections.find((c) => c.id === dest.connectionId) : undefined;
    const destinationLabel =
      dest?.type === "database" ? `${conn?.name ?? "database"} · ${dest.table ?? "table"}` : dest?.type === "file" ? dest.path || `output.${dest.format ?? "csv"}` : "Output preview";

    const started = Date.now();
    const logs: RunLog[] = [{ t: started, level: "info", step: "System", message: `Starting ${mode === "test" ? "test run" : "pipeline run"} (${mode === "test" ? "draft" : `v${version}`})` }];
    const run: Run = {
      id: `run_${new Date(started).toISOString().replace(/[-:T]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`,
      pipelineId: id,
      pipelineName: spec.name,
      version,
      mode,
      triggeredBy: get().settings.userName,
      startedAt: started,
      status: "running",
      sourceName: file.name,
      destinationLabel,
      rowsIn: 0,
      rowsOut: 0,
      reviewCount: 0,
      excludedCount: 0,
      failedCount: 0,
      steps: [],
      logs,
      reviewIssues: [],
      sourceColumns: [],
      reviewSource: {},
      reviewValues: {},
      ruleResults: [],
      columns: [],
    };
    set((s) => ({ runs: [run, ...s.runs], runningPipelines: { ...s.runningPipelines, [id]: run.id } }));

    let finished: Run;
    try {
      const res = await executeInWorker(runSpec, sheet, mode === "test" ? get().settings.testRunRows : undefined);
      let t = started;
      const tick = (ms: number) => (t += Math.max(1, Math.round(ms)));
      logs.push({ t: tick(1), level: "success", step: "Source", message: `Loaded ${file.name} (${res.input.rows.length.toLocaleString()} rows, ${res.input.columns.length} columns)` });
      const steps: RunStep[] = [];
      let failed = false;
      res.steps.forEach((r, i) => {
        const step = runSpec.steps[i];
        const title = stepTitle(step);
        const stage = STAGE_OF[step.type];
        steps.push({ ...r, title, stage });
        tick(r.durationMs);
        if (r.error) {
          failed = failed || !r.error.startsWith("Skipped");
          logs.push({ t, level: "error", step: title, message: r.error });
        } else if (r.issues) logs.push({ t, level: "warning", step: title, message: `${r.issues.toLocaleString()} values flagged for review. ${r.summary}` });
        else logs.push({ t, level: "success", step: title, message: r.summary });
      });
      const reviewSet = new Set(res.reviewRows);
      const reviewIssues = res.issues.filter((i) => reviewSet.has(i.row)).slice(0, 5000);
      const reviewSource: Run["reviewSource"] = {};
      const reviewValues: Run["reviewValues"] = {};
      const inIdx = new Map(res.input.rowIds.map((r, i) => [r, i]));
      const outIdx = new Map(res.beforeGate.rowIds.map((r, i) => [r, i]));
      for (const row of res.reviewRows.slice(0, 2000)) {
        const a = inIdx.get(row);
        if (a !== undefined) reviewSource[row] = res.input.rows[a].map(toText);
        const b = outIdx.get(row);
        if (b !== undefined) reviewValues[row] = res.beforeGate.rows[b].map(toText);
      }
      if (!failed) {
        tick(5);
        logs.push({
          t,
          level: "success",
          step: "Load",
          message:
            dest?.type === "database"
              ? `Staged ${res.output.rows.length.toLocaleString()} rows for ${destinationLabel}. Database writes run from the exported Python project; credentials stay in ${conn?.envVar ?? "your environment"}.`
              : `Prepared ${res.output.rows.length.toLocaleString()} rows for ${destinationLabel}`,
        });
        if (res.reviewRows.length) logs.push({ t, level: "warning", step: "Review", message: `${res.reviewRows.length.toLocaleString()} rows need review and were not loaded.` });
      }
      await db.putRunOutput(run.id, res.output);
      const finishedAt = Math.max(Date.now(), t);
      logs.push({ t: finishedAt, level: failed ? "error" : "info", step: "System", message: failed ? "Pipeline failed." : `Pipeline completed in ${((finishedAt - started) / 1000).toFixed(1)} seconds.` });
      finished = {
        ...run,
        status: failed ? "failed" : res.reviewRows.length ? "review" : "success",
        finishedAt,
        rowsIn: res.input.rows.length,
        rowsOut: failed ? 0 : res.output.rows.length,
        reviewCount: res.reviewRows.length,
        excludedCount: res.excludedRows.length,
        failedCount: failed ? res.input.rows.length : 0,
        steps,
        logs,
        reviewIssues,
        sourceColumns: res.input.columns,
        reviewSource,
        reviewValues,
        ruleResults: res.ruleResults,
        columns: res.beforeGate.columns,
        error: steps.find((s) => s.error && !s.error.startsWith("Skipped"))?.error,
      };
    } catch (e) {
      const finishedAt = Date.now();
      logs.push({ t: finishedAt, level: "error", step: "System", message: (e as Error).message });
      finished = { ...run, status: "failed", finishedAt, logs, error: (e as Error).message };
    }
    const runs = get().runs.map((r) => (r.id === run.id ? finished : r));
    const running = { ...get().runningPipelines };
    delete running[id];
    set({ runs, runningPipelines: running });
    persist("runs", runs.slice(0, 200));
    return finished;
  },

  deleteRun(id) {
    const runs = get().runs.filter((r) => r.id !== id);
    set({ runs });
    persist("runs", runs);
    void db.remove(`out:${id}`);
  },

  saveLayout(layout) {
    const layouts = [...get().layouts.filter((l) => l.id !== layout.id), layout];
    set({ layouts });
    persist("layouts", layouts);
  },
  deleteLayout(id) {
    const layouts = get().layouts.filter((l) => l.id !== id);
    set({ layouts });
    persist("layouts", layouts);
  },
  addConnection(c) {
    const conn: Connection = { ...c, id: newId("c"), createdAt: Date.now() };
    const connections = [...get().connections, conn];
    set({ connections });
    persist("connections", connections);
    return conn;
  },
  deleteConnection(id) {
    const connections = get().connections.filter((c) => c.id !== id);
    set({ connections });
    persist("connections", connections);
  },
  updateSettings(p) {
    const settings = { ...get().settings, ...p };
    set({ settings });
    persist("settings", settings);
  },
  async resetAll() {
    await db.clearAll();
    set({ pipelines: [], runs: [], sources: [], connections: [], layouts: [], settings: DEFAULT_SETTINGS, history: {} });
  },
}));

export const usePipeline = (id: string | undefined) => useApp((s) => s.pipelines.find((p) => p.id === id));
