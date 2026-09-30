/// <reference lib="webworker" />
// Executes full pipeline runs off the main thread so the UI stays responsive (PRD §18).
import { execute } from "@/engine/execute";
import type { PipelineSpec, RawSheet } from "@/engine/types";

self.onmessage = (e: MessageEvent<{ spec: PipelineSpec; sheet: RawSheet; limit?: number; sheets?: Record<string, RawSheet> }>) => {
  const { spec, sheet, limit, sheets } = e.data;
  try {
    const res = execute(spec, sheet, { limit, sheets });
    (self as unknown as Worker).postMessage({ ok: true, result: res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
