// Persisted-data migrations. Pure and deterministic: the same stored data always migrates to the same result.
import type { PipelineSpec } from "@/engine/types";
import type { Pipeline, Project, Run, Settings, SourceMeta } from "./model";

/** Current persisted schema. v1 had no projects; v2 groups sources, pipelines and runs under projects. */
export const SCHEMA_VERSION = 2;
export const DEFAULT_PROJECT_ID = "proj_default";
export const DEFAULT_PROJECT_NAME = "My FORMA Project";

/** Shape of stored data before migration: v1 records have no projectId. */
export interface StoredData {
  schema?: number;
  projects?: Project[];
  pipelines: (Omit<Pipeline, "projectId"> & { projectId?: string })[];
  sources: (Omit<SourceMeta, "projectId"> & { projectId?: string })[];
  runs: Run[];
  settings?: Partial<Settings>;
}

export interface MigratedData {
  schema: number;
  projects: Project[];
  pipelines: Pipeline[];
  sources: SourceMeta[];
  runs: Run[];
  settings?: Partial<Settings>;
  changed: boolean;
}

/** File ids a spec reads: its main source plus join / lookup / append sources. */
export function specSourceIds(spec: PipelineSpec): string[] {
  const ids = spec.source?.fileId ? [spec.source.fileId] : [];
  for (const s of spec.steps) if ((s.type === "join" || s.type === "append") && s.source.fileId) ids.push(s.source.fileId);
  for (const s of spec.graph?.sources ?? []) ids.push(s.source.fileId);
  return ids;
}

/**
 * v1 → v2: every pipeline, source and run without a valid project moves into one default project
 * ("My FORMA Project"). Pipeline ids, versions, review decisions and runs are kept as they are.
 * A source goes to the project of the first pipeline (by id) that reads it, else the default project.
 * Pipelines that used the old default "Analyst" layout open in the new Pipeline view.
 */
export function migrate(data: StoredData): MigratedData {
  const projects = (data.projects ?? []).slice();
  const known = new Set(projects.map((p) => p.id));
  const valid = (id?: string) => !!id && known.has(id);
  const v1 = (data.schema ?? 1) < 2;

  const orphanPipelines = data.pipelines.filter((p) => !valid(p.projectId));
  const orphanSources = data.sources.filter((s) => !valid(s.projectId));
  const orphanRuns = data.runs.filter((r) => !valid(r.projectId));
  const changed = v1 || orphanPipelines.length > 0 || orphanSources.length > 0 || orphanRuns.length > 0;
  if (!changed) return { schema: SCHEMA_VERSION, projects, pipelines: data.pipelines as Pipeline[], sources: data.sources as SourceMeta[], runs: data.runs, settings: data.settings, changed };

  const pipelines: Pipeline[] = data.pipelines.map((p) =>
    valid(p.projectId) ? (p as Pipeline) : { ...p, projectId: DEFAULT_PROJECT_ID, preset: v1 && p.preset === "analyst" ? "pipeline" : p.preset },
  );

  const owner = new Map<string, string>();
  for (const p of [...pipelines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
    for (const id of specSourceIds(p.spec)) if (!owner.has(id)) owner.set(id, p.projectId);
  const sources: SourceMeta[] = data.sources.map((s) => (valid(s.projectId) ? (s as SourceMeta) : { ...s, projectId: owner.get(s.id) ?? DEFAULT_PROJECT_ID }));

  const pipelineProject = new Map(pipelines.map((p) => [p.id, p.projectId]));
  const runs: Run[] = data.runs.map((r) => (valid(r.projectId) ? r : { ...r, projectId: pipelineProject.get(r.pipelineId) ?? DEFAULT_PROJECT_ID }));

  // The default project exists only when something was given to it, dated by its oldest / newest content.
  const homed = [
    ...pipelines.filter((p) => p.projectId === DEFAULT_PROJECT_ID).flatMap((p) => [p.createdAt, p.updatedAt]),
    ...sources.filter((x) => x.projectId === DEFAULT_PROJECT_ID).map((x) => x.addedAt),
    ...runs.filter((r) => r.projectId === DEFAULT_PROJECT_ID).map((r) => r.startedAt),
  ];
  if (homed.length && !known.has(DEFAULT_PROJECT_ID)) {
    const times = homed.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    projects.push({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      description: "Sources and pipelines created before projects were introduced.",
      createdAt: times.length ? Math.min(...times) : 0,
      updatedAt: times.length ? Math.max(...times) : 0,
    });
  }

  const settings = v1 && data.settings && (data.settings.defaultPreset ?? "analyst") === "analyst" ? { ...data.settings, defaultPreset: "pipeline" as const } : data.settings;
  return { schema: SCHEMA_VERSION, projects, pipelines, sources, runs, settings, changed };
}
