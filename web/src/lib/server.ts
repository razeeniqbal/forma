// Client for the optional FORMA server (Python backend, PRD §19).
import type { PipelineSpec } from "@/engine/types";
import { configObject, generatePython, sideSteps } from "@/codegen/python";
import { getRawFile } from "@/store/db";
import type { Connection, Pipeline } from "@/store/model";

export interface ServerHealth {
  ok: boolean;
  version: string;
  features: { ai: boolean; scheduler: boolean; database: boolean; api: boolean };
  auth: boolean;
}

export interface ServerStep {
  label: string;
  title: string;
  rows_in: number;
  rows_out: number;
  issues: number;
  duration_ms: number;
  error?: string;
}

export interface ServerRun {
  id: string;
  pipelineId: string;
  pipelineName: string;
  version: number;
  trigger: string;
  status: "running" | "success" | "review" | "failed";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  result: null | {
    status: string;
    rows_in: number;
    rows_out: number;
    review_count: number;
    excluded_count: number;
    duration_ms: number;
    steps?: ServerStep[];
    logs?: { t: number; level: "info" | "success" | "warning" | "error"; step: string; message: string }[];
    columns?: string[];
    source_columns?: string[];
    rule_results?: { rule: string; column: string; evaluated: number; passed: number }[];
    review_issues?: { row: number; column: string; stepId: string; kind: string; message: string; value: string | number | boolean | null }[];
    review_source?: Record<string, (string | null)[]>;
    review_values?: Record<string, Record<string, string | null>>;
  };
}

export class ServerError extends Error {}

export class FormaServer {
  constructor(
    public base: string,
    private token?: string,
  ) {
    this.base = base.replace(/\/+$/, "");
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let r: Response;
    try {
      r = await fetch(this.base + path, {
        ...init,
        headers: { ...(init.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.headers ?? {}) },
      });
    } catch {
      throw new ServerError(`Cannot reach the FORMA server at ${this.base}. Is it running, and is this origin allowed (FORMA_CORS_ORIGINS)?`);
    }
    if (!r.ok) {
      let detail = `${r.status} ${r.statusText}`;
      try {
        const j = await r.json();
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
      } catch {
        /* not JSON */
      }
      throw new ServerError(detail);
    }
    return (r.headers.get("content-type")?.includes("json") ? r.json() : r.text()) as Promise<T>;
  }

  health = () => this.req<ServerHealth>("/api/health");

  async ensureFile(fileId: string, name: string): Promise<void> {
    try {
      await this.req(`/api/files/${encodeURIComponent(fileId)}`);
      return;
    } catch {
      /* not uploaded yet */
    }
    const raw = await getRawFile(fileId);
    if (!raw) throw new ServerError(`The original bytes of ${name} are not stored in this browser. Re-upload the file, then run again.`);
    await this.req(`/api/files/${encodeURIComponent(fileId)}?name=${encodeURIComponent(name)}`, { method: "PUT", body: raw });
  }

  /** Upload source files and the generated pipeline for the latest saved version. */
  async sync(p: Pipeline, spec: PipelineSpec, version: number, connections: Connection[]): Promise<{ nextRun: string | null }> {
    const conn = spec.destination?.type === "database" ? connections.find((c) => c.id === spec.destination!.connectionId) : undefined;
    const opts = { version, connectionEnv: conn?.envVar };
    const files: Record<string, string> = {};
    const isFile = (t: string) => t !== "database" && t !== "api";
    if (spec.source && isFile(spec.source.type)) {
      await this.ensureFile(spec.source.fileId, spec.source.file);
      files.source = spec.source.fileId;
    }
    for (const s of sideSteps(spec))
      if (isFile(s.source.type)) {
        await this.ensureFile(s.source.fileId, s.source.file);
        files[`sources.${s.id}`] = s.source.fileId;
      }
    return this.req(`/api/pipelines/${encodeURIComponent(p.id)}`, {
      method: "PUT",
      body: JSON.stringify({ name: spec.name, version, pipeline_py: generatePython(spec, opts), config: configObject(spec, opts), files, schedule: p.schedule ?? null }),
    });
  }

  startRun = (pipelineId: string) => this.req<ServerRun>(`/api/pipelines/${encodeURIComponent(pipelineId)}/runs`, { method: "POST", body: JSON.stringify({ trigger: "manual" }) });
  getRun = (id: string) => this.req<ServerRun>(`/api/runs/${encodeURIComponent(id)}`);
  listRuns = () => this.req<ServerRun[]>(`/api/runs?limit=100`);
  output = (id: string) => this.req<string>(`/api/runs/${encodeURIComponent(id)}/output`);

  querySource(body: { kind: "database"; url_env: string; query: string; limit?: number } | { kind: "api"; url: string; format: "json" | "csv"; token_env?: string }) {
    return this.req<{ grid: (string | number | boolean | null)[][]; url?: string; format?: "json" | "csv" }>(`/api/sources/query`, { method: "POST", body: JSON.stringify(body) });
  }

  testConnection = (urlEnv: string) => this.req<{ ok: boolean; error?: string }>(`/api/connections/test`, { method: "POST", body: JSON.stringify({ url_env: urlEnv }) });

  suggestPatterns = (samples: string[], hint?: string) =>
    this.req<{ fields: { name: string; type: "text" | "number" | "date"; pattern: string; explanation: string; sample_match_rate: number }[]; model: string }>(`/api/ai/extract-patterns`, {
      method: "POST",
      body: JSON.stringify({ samples, hint }),
    });
}
