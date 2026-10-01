// App-level objects around the PipelineSpec (PRD §5, §12, §20).
import type { Dataset, Issue, PipelineSpec, RuleResult, SourceKind, StepResult } from "@/engine/types";

/** Pipeline view modes. "pipeline" is the visual step flow; the others are workbench panel layouts. */
export type PresetId = "pipeline" | "analyst" | "extraction" | "compare" | "engineer" | "monitor" | "custom";

/** Where pipeline runs execute. */
export type ExecutionTarget = "local" | "server";

/** A project groups the sources, pipelines and runs for one data problem. */
export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Default execution target for runs started in this project (server only when one is connected). */
  execution?: ExecutionTarget;
}

export interface PipelineVersion {
  version: number;
  spec: PipelineSpec;
  createdAt: number;
  reason: string;
}

export interface Pipeline {
  id: string;
  projectId: string;
  spec: PipelineSpec;
  /** Last immutable version number (0 = never versioned). */
  version: number;
  versions: PipelineVersion[];
  /** Draft has edits not captured in a version. */
  dirty: boolean;
  preset: PresetId;
  customLayoutId?: string;
  /** Cron schedule (UTC). Executed by the FORMA server or an exported Airflow/Prefect deployment. */
  schedule?: { cron: string; enabled: boolean };
  createdAt: number;
  updatedAt: number;
}

export interface SourceMeta {
  id: string;
  /** The project this source belongs to. Pipelines reference it; the file is stored once. */
  projectId: string;
  name: string;
  kind: SourceKind;
  size: number;
  addedAt: number;
  lastUsedAt: number;
  sheets: { name: string; rows: number; cols: number }[];
}

export type RunStatus = "running" | "success" | "review" | "failed" | "cancelled";
export type LogLevel = "info" | "success" | "warning" | "error";

export interface RunLog {
  t: number;
  level: LogLevel;
  step: string;
  message: string;
}

export interface RunStep extends StepResult {
  title: string;
  stage: string;
}

export interface Run {
  id: string;
  pipelineId: string;
  projectId?: string;
  pipelineName: string;
  version: number;
  mode: "test" | "manual";
  triggeredBy: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  sourceName: string;
  destinationLabel: string;
  rowsIn: number;
  rowsOut: number;
  reviewCount: number;
  excludedCount: number;
  failedCount: number;
  steps: RunStep[];
  logs: RunLog[];
  /** Issues for rows held in review (capped for storage). */
  reviewIssues: Issue[];
  /** Source columns and original values (canonical text) for review rows, keyed by row id. */
  sourceColumns: string[];
  reviewSource: Record<number, (string | null)[]>;
  /** Values entering the review gate that held each review row, by column. */
  reviewValues: Record<number, Record<string, string | null>>;
  ruleResults: RuleResult[];
  columns: string[];
  error?: string;
  /** Executed on the FORMA server (id there). */
  remoteId?: string;
  trigger?: string;
}

export interface RunOutput {
  runId: string;
  output: Dataset;
}

export interface Connection {
  id: string;
  name: string;
  type: "postgresql" | "mysql" | "warehouse" | "api";
  /** Environment variable that holds the URL / token. Never the secret itself. */
  envVar: string;
  description?: string;
  createdAt: number;
}

export type PanelId =
  | "source"
  | "preview"
  | "pipeline"
  | "inspector"
  | "beforeAfter"
  | "profile"
  | "quality"
  | "failedRows"
  | "python"
  | "spec"
  | "logs"
  | "runs";

export interface WorkspaceLayout {
  id: string;
  name: string;
  /** Columns of stacked panels, with relative widths. */
  columns: { panels: PanelId[]; size: number; heights?: number[] }[];
  builtIn?: boolean;
}

/** Reusable transformation preset (PRD §21 "reusable transformation presets"). */
export interface TransformPreset {
  id: string;
  name: string;
  description?: string;
  steps: import("@/engine/types").Step[];
  createdAt: number;
}

export interface Settings {
  userName: string;
  previewRows: number;
  defaultPreset: PresetId;
  defaultDateFormat: string;
  testRunRows: number;
  /** Optional FORMA server (Python backend) for large files, schedules and database connections. */
  serverUrl?: string;
  /** Optional bearer token (FORMA_API_TOKEN on the server). Stored only in this browser. */
  serverToken?: string;
}
