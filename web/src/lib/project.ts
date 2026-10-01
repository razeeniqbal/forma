// Project context: which project the current screen belongs to, and its sources / pipelines / runs.
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useApp } from "@/store/app";
import type { Pipeline, Project, Run, SourceMeta } from "@/store/model";
import { specSourceIds } from "@/store/migrate";

/** Project of the current route: /projects/:id/…, or the project owning the open pipeline or run. */
export function useCurrentProjectId(): string | undefined {
  const { pathname } = useLocation();
  const pipelines = useApp((s) => s.pipelines);
  const runs = useApp((s) => s.runs);
  const projects = useApp((s) => s.projects);
  const proj = matchPath("/projects/:projectId/*", pathname)?.params.projectId ?? matchPath("/projects/:projectId", pathname)?.params.projectId;
  if (proj && proj !== "new") return projects.some((p) => p.id === proj) ? proj : undefined;
  const pid = matchPath("/pipelines/:id/*", pathname)?.params.id ?? matchPath("/pipelines/:id", pathname)?.params.id;
  if (pid) return pipelines.find((p) => p.id === pid)?.projectId;
  const rid = matchPath("/runs/:runId/*", pathname)?.params.runId ?? matchPath("/runs/:runId", pathname)?.params.runId;
  if (rid) {
    const run = runs.find((r) => r.id === rid);
    return run?.projectId ?? pipelines.find((p) => p.id === run?.pipelineId)?.projectId;
  }
  return undefined;
}

export interface ProjectData {
  project?: Project;
  sources: SourceMeta[];
  pipelines: Pipeline[];
  runs: Run[];
}

export function useProjectData(projectId: string | undefined): ProjectData {
  const projects = useApp((s) => s.projects);
  const allSources = useApp((s) => s.sources);
  const allPipelines = useApp((s) => s.pipelines);
  const allRuns = useApp((s) => s.runs);
  return useMemo(
    () => ({
      project: projects.find((p) => p.id === projectId),
      sources: allSources.filter((s) => s.projectId === projectId),
      pipelines: allPipelines.filter((p) => p.projectId === projectId),
      runs: allRuns.filter((r) => r.projectId === projectId),
    }),
    [projects, allSources, allPipelines, allRuns, projectId],
  );
}

/** Most recent activity in a project (edits, uploads, runs). */
export function lastActivity(d: ProjectData): number {
  return Math.max(d.project?.updatedAt ?? 0, ...d.sources.map((s) => s.addedAt), ...d.pipelines.map((p) => p.updatedAt), ...d.runs.map((r) => r.finishedAt ?? r.startedAt));
}

/** Pipelines that read a source (as main source or through join / lookup / append). */
export function pipelinesUsing(sourceId: string, pipelines: Pipeline[]): Pipeline[] {
  return pipelines.filter((p) => specSourceIds(p.spec).includes(sourceId));
}

export const projectPath = (projectId: string, section = "") => `/projects/${projectId}${section ? `/${section}` : ""}`;
