import { parseFile } from "@/parsers";
import { useApp } from "@/store/app";
import { invoicePipeline } from "@/engine/demo";
import type { SourceMeta } from "@/store/model";

/** Adds one of the bundled sample files (public/samples) to a project. */
export async function loadSampleFile(name: "invoices.xlsx" | "customers.csv" | "invoices.csv", projectId: string): Promise<SourceMeta> {
  const res = await fetch(`/samples/${name}`);
  if (!res.ok) throw new Error(`Could not load the sample file ${name}.`);
  const blob = await res.blob();
  const parsed = await parseFile(new File([blob], name, { type: blob.type }));
  return useApp.getState().addSource(parsed.source, projectId);
}

export const loadSampleSource = (projectId: string) => loadSampleFile("invoices.xlsx", projectId);

export const EXAMPLE_PROJECT = {
  name: "Invoice Processing",
  description: "Clean, validate and standardise invoice data before loading it into the warehouse.",
};

/** Adds the sample invoices (and customers) to a project with the prebuilt "Clean Invoices" pipeline (PRD §25). */
export async function addExampleContent(projectId: string): Promise<string> {
  const meta = await loadSampleSource(projectId);
  await loadSampleFile("customers.csv", projectId);
  const p = useApp.getState().createPipelineFromSpec({ ...invoicePipeline(meta.id), name: "Clean Invoices" }, projectId);
  return p.id;
}

/** Creates the example project; returns its id and the example pipeline id. */
export async function createExampleProject(): Promise<{ projectId: string; pipelineId: string }> {
  const project = useApp.getState().createProject(EXAMPLE_PROJECT);
  return { projectId: project.id, pipelineId: await addExampleContent(project.id) };
}
