import { execute } from "@/engine/execute";
import type { ExecutionResult, PipelineSpec, RawSheet } from "@/engine/types";

/** Run in a Web Worker when available; fall back to the main thread. */
export function executeInWorker(spec: PipelineSpec, sheet: RawSheet, limit?: number, sheets: Record<string, RawSheet> = {}): Promise<ExecutionResult> {
  if (typeof Worker === "undefined") return Promise.resolve(execute(spec, sheet, { limit, sheets }));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/run.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "Worker failed"));
    };
    w.postMessage({ spec, sheet, limit, sheets });
  });
}
