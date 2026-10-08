/// <reference lib="webworker" />
// Executes full pipeline runs off the main thread so the UI stays responsive (PRD §18).
// Posts progress as the source loads and each step completes, then the full result.
import { executeSpec } from "@/engine/graph/run";
import type { PipelineSpec, RawSheet } from "@/engine/types";

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<{ spec: PipelineSpec; sheet: RawSheet; limit?: number; sheets?: Record<string, RawSheet> }>) => {
  const { spec, sheet, limit, sheets } = e.data;
  try {
    const res = executeSpec(spec, sheet, {
      limit,
      sheets,
      onLoaded: (rows, columns) => post({ progress: { kind: "loaded", rows, columns } }),
      onStep: (index, result) => post({ progress: { kind: "step", index, result } }),
    });
    post({ ok: true, result: res });
  } catch (err) {
    post({ ok: false, error: (err as Error).message });
  }
};
