import type { Step } from "@/engine/types";
import { loadDataset } from "@/engine/load";
import { defaultSourceSpec } from "@/store/app";
import { getSourceFile } from "@/store/db";
import { sheetOf } from "@/lib/hooks";
import { makeStep } from "@/lib/stepDefaults";
import { withSource } from "./editors/ReshapeEditor";
import type { Ctx } from "./context";

/** Start a Lookup or Append draft at the end of the pipeline that reads an existing project source. */
export async function startCombineDraft(ws: Ctx, fileId: string, sheet: string | undefined, as: "lookup" | "append"): Promise<boolean> {
  const f = await getSourceFile(fileId);
  if (!f) return false;
  const at = ws.spec.steps.length;
  const before = ws.datasetAfter(at - 1);
  const step = makeStep(as, before, undefined) as Extract<Step, { type: "join" | "append" }>;
  const src = defaultSourceSpec(f, sheet);
  const ds = loadDataset(sheetOf(f, src.sheet)!, src);
  ws.startDraft({ step: withSource(step, src, ds, before), index: at, isNew: true });
  return true;
}
