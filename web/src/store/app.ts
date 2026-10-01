import { create } from "zustand";
import type { Issue, PipelineSpec, RawSheet, SourceFile, SourceSpec, Step } from "@/engine/types";
import { detectRegion, loadDataset, sideSheetKey } from "@/engine/load";
import { parseCsv } from "@/parsers";
import { FormaServer, type ServerRun } from "@/lib/server";
import { newId, stepTitle, STAGE_OF } from "@/engine/registry";
import { toText } from "@/engine/values";
import { executeInWorker, type RunProgress } from "@/lib/runner";
import * as db from "./db";
import { migrate, SCHEMA_VERSION, type StoredData } from "./migrate";
import type {
  Connection,
  Pipeline,
  PresetId,
  Project,
  Run,
  RunLog,
  RunStep,
  Settings,
  SourceMeta,
  TransformPreset,
  WorkspaceLayout,
} from "./model";

const DEFAULT_SETTINGS: Settings = {
  userName: "You",
  previewRows: 2000,
  defaultPreset: "pipeline",
  defaultDateFormat: "YYYY-MM-DD",
  testRunRows: 200,
};

interface History {
  past: PipelineSpec[];
  future: PipelineSpec[];
  lastKey?: string;
  lastAt?: number;
}

/** Progress of the latest in-browser run of a pipeline, as reported by the engine (source load, then each step). */
export interface LiveRun {
  runId: string;
  mode: "test" | "manual";
  /** Step count of the executed spec. */
  total: number;
  events: RunProgress[];
  status: Run["status"];
  startedAt: number;
  finishedAt?: number;
}

interface Toast {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
}

interface AppState {
  ready: boolean;
  projects: Project[];
  pipelines: Pipeline[];
  runs: Run[];
  sources: SourceMeta[];
  connections: Connection[];
  layouts: WorkspaceLayout[];
  presets: TransformPreset[];
  settings: Settings;
  history: Record<string, History>;
  toasts: Toast[];
  runningPipelines: Record<string, string>;
  liveRuns: Record<string, LiveRun>;

  hydrate(): Promise<void>;
  toast(kind: Toast["kind"], message: string): void;
  dismissToast(id: string): void;

  createProject(p: { name: string; description?: string }): Project;
  updateProject(id: string, patch: Partial<Pick<Project, "name" | "description" | "execution">>): void;
  /** Deletes the project with its pipelines, runs and source files. */
  deleteProject(id: string): Promise<void>;

  /** Stores a source file in a project. The file is kept once; pipelines reference it by id. */
  addSource(file: SourceFile, projectId: string): Promise<SourceMeta>;
  deleteSource(id: string): Promise<void>;

  /** `sheet` picks the worksheet of a multi-sheet workbook (default: the first). */
  createPipeline(
    projectId: string,
    name: string,
    source: SourceMeta | null,
    preset?: PresetId,
    destination?: PipelineSpec["destination"],
    sheet?: string,
  ): Promise<Pipeline>;
  createPipelineFromSpec(spec: PipelineSpec, projectId: string, preset?: PresetId): Pipeline;
  updateSpec(id: string, fn: (s: PipelineSpec) => PipelineSpec, coalesceKey?: string): void;
  undo(id: string): void;
  redo(id: string): void;
  setPreset(id: string, preset: PresetId, layoutId?: string): void;
  setSchedule(id: string, schedule: Pipeline["schedule"]): void;
  saveVersion(id: string, reason?: string): number;
  duplicatePipeline(id: string): Pipeline | undefined;
  deletePipeline(id: string): void;

  runPipeline(id: string, mode: "test" | "manual", opts?: { sourceFileId?: string }): Promise<Run | undefined>;
  runOnServer(id: string): Promise<Run | undefined>;
  importServerRuns(): Promise<number>;
  refreshServerRun(runId: string): Promise<void>;
  deleteRun(id: string): void;

  savePreset(name: string, steps: Step[], description?: string): TransformPreset;
  deletePreset(id: string): void;
  saveLayout(layout: WorkspaceLayout): void;
  deleteLayout(id: string): void;
  addConnection(c: Omit<Connection, "id" | "createdAt">): Connection;
  deleteConnection(id: string): void;
  updateSettings(p: Partial<Settings>): void;
  resetAll(): Promise<void>;
}

const timers: Record<string, ReturnType<typeof setTimeout>> = {};
const pending: Record<string, unknown> = {};
/** Debounced save for rapid edits; `now` writes at once (new or deleted objects must survive an immediate reload). */
function persist(key: string, value: unknown, now = false) {
  clearTimeout(timers[key]);
  if (now) {
    delete pending[key];
    void db.save(key, value);
    return;
  }
  pending[key] = value;
  timers[key] = setTimeout(() => {
    delete pending[key];
    void db.save(key, value);
  }, 250);
}

/** Write debounced saves now, so a reload or closed tab right after an edit loses nothing. */
function flushPersist() {
  for (const key of Object.keys(pending)) {
    clearTimeout(timers[key]);
    void db.save(key, pending[key]);
    delete pending[key];
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPersist);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushPersist());
}

export function sourceMetaFrom(file: SourceFile): Omit<SourceMeta, "projectId"> {
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
    ...(file.origin ? { origin: file.origin } : {}),
  };
}

/** Raw sheets for join / lookup / append steps, keyed by file id. */
export async function loadSideSheets(spec: PipelineSpec): Promise<Record<string, RawSheet>> {
  const out: Record<string, RawSheet> = {};
  for (const s of spec.steps) {
    if ((s.type === "join" || s.type === "append") && s.source.fileId) {
      const key = sideSheetKey(s.source.fileId, s.source.sheet);
      if (out[key]) continue;
      const f = await db.getSourceFile(s.source.fileId);
      const sh = f && (f.sheets.find((x) => x.name === s.source.sheet) ?? f.sheets[0]);
      if (sh) out[key] = sh;
    }
  }
  return out;
}

export function serverClient(): FormaServer | null {
  const { serverUrl, serverToken } = useApp.getState().settings;
  return serverUrl ? new FormaServer(serverUrl, serverToken) : null;
}

async function pollServerRun(runId: string) {
  for (let i = 0; i < 7200; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 700 : 2000));
    const run = useApp.getState().runs.find((r) => r.id === runId);
    if (!run) return;
    try {
      await useApp.getState().refreshServerRun(runId);
    } catch {
      /* transient network error: keep polling */
    }
    if (useApp.getState().runs.find((r) => r.id === runId)?.status !== "running") return;
  }
}

/** Map a FORMA server run into the app's run record. */
export function fromServerRun(r: ServerRun, spec: PipelineSpec | undefined, triggeredBy: string, projectId?: string): Run {
  const res = r.result;
  const rules = spec?.steps.flatMap((s) => (s.type === "validate" ? s.rules : [])) ?? [];
  const started = r.startedAt * 1000;
  return {
    id: `run_${r.id}`,
    remoteId: r.id,
    trigger: r.trigger,
    pipelineId: r.pipelineId,
    projectId,
    pipelineName: r.pipelineName,
    version: r.version,
    mode: "manual",
    triggeredBy: r.trigger === "schedule" ? "Schedule (FORMA server)" : `${triggeredBy} · FORMA server`,
    startedAt: started,
    finishedAt: r.finishedAt ? r.finishedAt * 1000 : undefined,
    status: r.status,
    sourceName: spec?.source?.file ?? "source",
    destinationLabel: spec?.destination?.type === "database" ? `database · ${spec.destination.table ?? ""}` : spec?.destination?.path || "output file (server)",
    rowsIn: res?.rows_in ?? 0,
    rowsOut: res?.rows_out ?? 0,
    reviewCount: res?.review_count ?? 0,
    excludedCount: res?.excluded_count ?? 0,
    failedCount: r.status === "failed" ? res?.rows_in ?? 0 : 0,
    steps: (res?.steps ?? []).map((s, i) => ({
      stepId: spec?.steps[i]?.id ?? `srv${i}`,
      title: s.title,
      stage: s.label.split(" — ")[0].replace(/^\d+\s*/, ""),
      rowsIn: s.rows_in,
      rowsOut: s.rows_out,
      changedCells: 0,
      addedColumns: [],
      removedColumns: [],
      issues: s.issues,
      durationMs: s.duration_ms,
      summary: s.error ? "Failed" : `${s.rows_in.toLocaleString()} → ${s.rows_out.toLocaleString()} rows${s.issues ? ` · ${s.issues.toLocaleString()} flagged` : ""}`,
      error: s.error,
    })),
    logs: (res?.logs ?? [{ t: r.startedAt, level: "info" as const, step: "System", message: "Queued on the FORMA server" }]).map((l) => ({ ...l, t: l.t * 1000 })),
    reviewIssues: (res?.review_issues ?? []).map((i) => ({ ...i, kind: i.kind as Issue["kind"] })),
    sourceColumns: res?.source_columns ?? [],
    reviewSource: Object.fromEntries(Object.entries(res?.review_source ?? {}).map(([k, v]) => [Number(k), v])),
    reviewValues: Object.fromEntries(Object.entries(res?.review_values ?? {}).map(([k, v]) => [Number(k), v])),
    ruleResults: (res?.rule_results ?? []).map((x) => ({ ruleId: x.rule, column: x.column, kind: rules.find((rr) => rr.id === x.rule)?.kind ?? "not_blank", evaluated: x.evaluated, passed: x.passed })),
    columns: res?.columns ?? [],
    error: r.error ?? undefined,
  };
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  projects: [],
  pipelines: [],
  runs: [],
  sources: [],
  connections: [],
  layouts: [],
  presets: [],
  settings: DEFAULT_SETTINGS,
  history: {},
  toasts: [],
  runningPipelines: {},
  liveRuns: {},

  async hydrate() {
    const [schema, projects, pipelines, runs, sources, connections, layouts, settings, presets] = await Promise.all([
      db.load<number>("schema"),
      db.load<Project[]>("projects"),
      db.load<StoredData["pipelines"]>("pipelines"),
      db.load<Run[]>("runs"),
      db.load<StoredData["sources"]>("sources"),
      db.load<Connection[]>("connections"),
      db.load<WorkspaceLayout[]>("layouts"),
      db.load<Settings>("settings"),
      db.load<TransformPreset[]>("presets"),
    ]);
    const m = migrate({ schema, projects, pipelines: pipelines ?? [], sources: sources ?? [], runs: runs ?? [], settings });
    if (m.changed) {
      await Promise.all([
        db.save("projects", m.projects),
        db.save("pipelines", m.pipelines),
        db.save("sources", m.sources),
        db.save("runs", m.runs),
        ...(m.settings ? [db.save("settings", m.settings)] : []),
      ]);
      await db.save("schema", SCHEMA_VERSION);
    }
    set({
      ready: true,
      projects: m.projects,
      pipelines: m.pipelines,
      // Runs interrupted by a reload can never finish.
      runs: m.runs.map((r) => (r.status === "running" ? { ...r, status: "cancelled" as const } : r)),
      sources: m.sources,
      connections: connections ?? [],
      layouts: layouts ?? [],
      presets: presets ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(m.settings ?? {}) },
    });
  },

  toast(kind, message) {
    const id = newId("t");
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : kind === "warning" ? 5000 : 2600);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  createProject({ name, description }) {
    const now = Date.now();
    const project: Project = { id: newId("proj"), name: name.trim() || "Untitled project", description: description?.trim() || undefined, createdAt: now, updatedAt: now };
    const projects = [project, ...get().projects];
    set({ projects });
    persist("projects", projects, true);
    return project;
  },
  updateProject(id, patch) {
    const projects = get().projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p));
    set({ projects });
    persist("projects", projects, true);
  },
  async deleteProject(id) {
    const { projects, pipelines, runs, sources } = get();
    const goneRuns = runs.filter((r) => r.projectId === id);
    const goneSources = sources.filter((s) => s.projectId === id);
    const next = {
      projects: projects.filter((p) => p.id !== id),
      pipelines: pipelines.filter((p) => p.projectId !== id),
      runs: runs.filter((r) => r.projectId !== id),
      sources: sources.filter((s) => s.projectId !== id),
    };
    set(next);
    for (const [k, v] of Object.entries(next)) persist(k, v, true);
    await Promise.all([...goneSources.map((s) => db.deleteSourceFile(s.id)), ...goneRuns.map((r) => db.remove(`out:${r.id}`))]);
  },

  async addSource(input, projectId) {
    const { raw, ...file } = input;
    if (raw) await db.putRawFile(file.id, raw);
    await db.putSourceFile(file);
    const meta: SourceMeta = { ...sourceMetaFrom(file), projectId };
    const sources = [meta, ...get().sources.filter((s) => s.id !== meta.id)];
    set({ sources });
    persist("sources", sources, true);
    return meta;
  },
  async deleteSource(id) {
    const sources = get().sources.filter((s) => s.id !== id);
    set({ sources });
    persist("sources", sources, true);
    await db.deleteSourceFile(id);
  },

  async createPipeline(projectId, name, source, preset, destination = null, sheet) {
    let spec: PipelineSpec = { name, source: null, steps: [], destination, reviewDecisions: [] };
    if (source) {
      const file = await db.getSourceFile(source.id);
      if (file) spec = { ...spec, source: defaultSourceSpec(file, sheet) };
      const sources = get().sources.map((s) => (s.id === source.id ? { ...s, lastUsedAt: Date.now() } : s));
      set({ sources });
      persist("sources", sources, true);
    }
    return get().createPipelineFromSpec(spec, projectId, preset);
  },

  createPipelineFromSpec(spec, projectId, preset) {
    const p: Pipeline = {
      id: newId("p"),
      projectId,
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
    persist("pipelines", pipelines, true);
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

  setSchedule(id, schedule) {
    const pipelines = get().pipelines.map((x) => (x.id === id ? { ...x, schedule, updatedAt: Date.now() } : x));
    set({ pipelines });
    persist("pipelines", pipelines);
    const server = serverClient();
    if (server) {
      // Schedules run on the server: publish the latest saved version with the new schedule.
      const version = get().saveVersion(id, "Scheduled");
      const p = get().pipelines.find((x) => x.id === id)!;
      server
        .sync(p, p.versions.at(-1)!.spec, version, get().connections)
        .then((r) => get().toast("success", schedule?.enabled ? `Scheduled on the FORMA server${r.nextRun ? ` — next run ${r.nextRun.replace("T", " ").slice(0, 16)} UTC` : ""}` : "Schedule updated on the FORMA server"))
        .catch((e) => get().toast("error", `Could not sync the schedule: ${(e as Error).message}`));
    }
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
    return get().createPipelineFromSpec({ ...JSON.parse(JSON.stringify(p.spec)), name: `${p.spec.name} (copy)` }, p.projectId, p.preset);
  },

  deletePipeline(id) {
    const pipelines = get().pipelines.filter((x) => x.id !== id);
    set({ pipelines });
    persist("pipelines", pipelines, true);
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
      projectId: p.projectId,
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
    const live: LiveRun = { runId: run.id, mode, total: runSpec.steps.length, events: [], status: "running", startedAt: started };
    set((s) => ({ runs: [run, ...s.runs], runningPipelines: { ...s.runningPipelines, [id]: run.id }, liveRuns: { ...s.liveRuns, [id]: live } }));
    const onProgress = (e: RunProgress) =>
      set((s) => {
        const cur = s.liveRuns[id];
        return cur?.runId === run.id ? { liveRuns: { ...s.liveRuns, [id]: { ...cur, events: [...cur.events, e] } } } : {};
      });

    let finished: Run;
    try {
      const sheets = await loadSideSheets(runSpec);
      const res = await executeInWorker(runSpec, sheet, mode === "test" ? get().settings.testRunRows : undefined, sheets, onProgress);
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
      // A row is held at the gate before a reshaping step or at the end; find its values there.
      const gateIdx = res.gated.map((g) => new Map(g.rowIds.map((r, i) => [r, i])));
      for (const row of res.reviewRows.slice(0, 2000)) {
        const a = inIdx.get(row);
        if (a !== undefined) reviewSource[row] = res.input.rows[a].map(toText);
        for (let g = res.gated.length - 1; g >= 0; g--) {
          const b = gateIdx[g].get(row);
          if (b === undefined) continue;
          const ds = res.gated[g];
          reviewValues[row] = Object.fromEntries(ds.columns.map((c, ci) => [c, toText(ds.rows[b][ci])]));
          break;
        }
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
    const cur = get().liveRuns[id];
    const liveRuns = cur?.runId === run.id ? { ...get().liveRuns, [id]: { ...cur, status: finished.status, finishedAt: finished.finishedAt } } : get().liveRuns;
    set({ runs, runningPipelines: running, liveRuns });
    persist("runs", runs.slice(0, 200));
    return finished;
  },

  async runOnServer(id) {
    const server = serverClient();
    const p0 = get().pipelines.find((x) => x.id === id);
    if (!server || !p0?.spec.source) return;
    const version = get().saveVersion(id, "Run on server");
    const p = get().pipelines.find((x) => x.id === id)!;
    const spec = p.versions.at(-1)!.spec;
    let remote: ServerRun;
    try {
      await server.sync(p, spec, version, get().connections);
      remote = await server.startRun(id);
    } catch (e) {
      get().toast("error", (e as Error).message);
      return;
    }
    const run = fromServerRun(remote, spec, get().settings.userName, p.projectId);
    set((s) => ({ runs: [run, ...s.runs], runningPipelines: { ...s.runningPipelines, [id]: run.id } }));
    void pollServerRun(run.id);
    return run;
  },

  async importServerRuns() {
    const server = serverClient();
    if (!server) return 0;
    const remote = await server.listRuns();
    const known = new Set(get().runs.map((r) => r.remoteId).filter(Boolean));
    // Runs of pipelines that no longer exist here have no project to belong to.
    const fresh = remote.filter((r) => !known.has(r.id) && get().pipelines.some((p) => p.id === r.pipelineId));
    if (!fresh.length) return 0;
    const added = fresh.map((r) => {
      const p = get().pipelines.find((x) => x.id === r.pipelineId)!;
      return fromServerRun(r, p.versions.find((v) => v.version === r.version)?.spec, "Schedule", p.projectId);
    });
    const runs = [...get().runs, ...added].sort((a, b) => b.startedAt - a.startedAt);
    set({ runs });
    persist("runs", runs.slice(0, 200));
    return added.length;
  },

  async refreshServerRun(runId) {
    const run = get().runs.find((r) => r.id === runId);
    const server = serverClient();
    if (!run?.remoteId || !server) return;
    const remote = await server.getRun(run.remoteId);
    const spec = get().pipelines.find((p) => p.id === run.pipelineId)?.versions.find((v) => v.version === run.version)?.spec;
    const next = { ...fromServerRun(remote, spec, run.triggeredBy.split(" · ")[0], run.projectId), id: run.id };
    if (next.status !== "running" && remote.status !== "failed") {
      try {
        const csv = await server.output(run.remoteId);
        const sheet = parseCsv(csv, ",").sheet;
        if (sheet.cells.length <= 200001) await db.putRunOutput(run.id, loadDataset(sheet, { type: "csv", file: "", fileId: "", headerRow: 0, startCol: 0, endCol: Math.max(0, (sheet.cells[0]?.length ?? 1) - 1) }));
      } catch {
        /* output is optional */
      }
    }
    const runs = get().runs.map((r) => (r.id === runId ? next : r));
    const running = { ...get().runningPipelines };
    if (next.status !== "running") delete running[run.pipelineId];
    set({ runs, runningPipelines: running });
    persist("runs", runs.slice(0, 200));
  },

  deleteRun(id) {
    const runs = get().runs.filter((r) => r.id !== id);
    set({ runs });
    persist("runs", runs);
    void db.remove(`out:${id}`);
  },

  savePreset(name, steps, description) {
    const preset: TransformPreset = { id: newId("preset"), name, description, steps: JSON.parse(JSON.stringify(steps)), createdAt: Date.now() };
    const presets = [...get().presets, preset];
    set({ presets });
    persist("presets", presets);
    return preset;
  },
  deletePreset(id) {
    const presets = get().presets.filter((p) => p.id !== id);
    set({ presets });
    persist("presets", presets);
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
    void db.save("settings", settings); // immediate: settings must survive an instant reload
  },
  async resetAll() {
    await db.clearAll();
    set({ projects: [], pipelines: [], runs: [], sources: [], connections: [], layouts: [], presets: [], settings: DEFAULT_SETTINGS, history: {} });
  },
}));

export const usePipeline = (id: string | undefined) => useApp((s) => s.pipelines.find((p) => p.id === id));
export const useProject = (id: string | undefined) => useApp((s) => s.projects.find((p) => p.id === id));
