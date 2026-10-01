import { execute } from "@/engine/execute";
import type { ExecutionResult, PipelineSpec, RawSheet, StepResult } from "@/engine/types";

export type RunProgress = { kind: "loaded"; rows: number; columns: number } | { kind: "step"; index: number; result: StepResult };

/** Run in a Web Worker when available; fall back to the main thread. `onProgress` reports real step completions. */
export function executeInWorker(
  spec: PipelineSpec,
  sheet: RawSheet,
  limit?: number,
  sheets: Record<string, RawSheet> = {},
  onProgress?: (p: RunProgress) => void,
): Promise<ExecutionResult> {
  if (typeof Worker === "undefined")
    return Promise.resolve(
      execute(spec, sheet, {
        limit,
        sheets,
        onLoaded: (rows, columns) => onProgress?.({ kind: "loaded", rows, columns }),
        onStep: (index, result) => onProgress?.({ kind: "step", index, result }),
      }),
    );
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/run.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      if (e.data.progress) {
        onProgress?.(e.data.progress);
        return;
      }
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
