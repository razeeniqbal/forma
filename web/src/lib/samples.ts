import { parseFile } from "@/parsers";
import { useApp } from "@/store/app";
import { invoicePipeline } from "@/engine/demo";
import type { SourceMeta } from "@/store/model";

export async function loadSampleSource(): Promise<SourceMeta> {
  const res = await fetch("/samples/invoices.xlsx");
  if (!res.ok) throw new Error("Could not load the sample workbook.");
  const blob = await res.blob();
  const file = new File([blob], "invoices.xlsx", { type: blob.type });
  const parsed = await parseFile(file);
  return useApp.getState().addSource(parsed.source);
}

/** Creates the prebuilt Invoice Processing demo (PRD §25) on the sample workbook. */
export async function createInvoiceDemo(): Promise<string> {
  const meta = await loadSampleSource();
  const spec = invoicePipeline(meta.id);
  const p = useApp.getState().createPipelineFromSpec(spec, "analyst");
  return p.id;
}
