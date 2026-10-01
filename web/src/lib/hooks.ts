import { useEffect, useMemo, useState } from "react";
import type { ExecutionResult, PipelineSpec, RawSheet, SourceFile } from "@/engine/types";
import { execute } from "@/engine/execute";
import { getSourceFile, peekSourceFile } from "@/store/db";
import { loadSideSheets, useApp } from "@/store/app";

export function useSourceFile(id: string | undefined): { file: SourceFile | undefined; loading: boolean } {
  const [file, setFile] = useState<SourceFile | undefined>(() => (id ? peekSourceFile(id) : undefined));
  const [loading, setLoading] = useState(!!id && !file);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setFile(undefined);
      setLoading(false);
      return;
    }
    const hit = peekSourceFile(id);
    if (hit) {
      setFile(hit);
      setLoading(false);
      return;
    }
    setLoading(true);
    getSourceFile(id).then((f) => {
      if (!alive) return;
      setFile(f);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return { file, loading };
}

export function sheetOf(file: SourceFile | undefined, name?: string): RawSheet | undefined {
  if (!file) return undefined;
  return file.sheets.find((s) => s.name === name) ?? file.sheets[0];
}

/** Raw sheets of join / lookup / append sources used by a spec, loaded from storage. */
export function useSideSheets(spec: PipelineSpec | undefined): Record<string, RawSheet> | undefined {
  const key = (spec?.steps ?? [])
    .map((s) => (s.type === "join" || s.type === "append" ? `${s.source.fileId}:${s.source.sheet ?? ""}` : ""))
    .filter((k) => k && !k.startsWith(":"))
    .join("|");
  const [state, setState] = useState<{ key: string; sheets: Record<string, RawSheet> } | null>(key ? null : { key: "", sheets: {} });
  useEffect(() => {
    if (!key) {
      setState({ key: "", sheets: {} });
      return;
    }
    let alive = true;
    loadSideSheets(spec!).then((sheets) => alive && setState({ key, sheets }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state && state.key === key ? state.sheets : undefined;
}

/**
 * Preview engine: runs the pipeline on a sample (first N rows) keeping each
 * step's output, so every step can show before/after instantly (PRD §18).
 */
export function usePreview(spec: PipelineSpec | undefined): { result?: ExecutionResult; error?: string; loading: boolean; sampled: boolean } {
  const { file, loading } = useSourceFile(spec?.source?.fileId);
  const previewRows = useApp((s) => s.settings.previewRows);
  const sheets = useSideSheets(spec);
  return useMemo(() => {
    if (!spec?.source) return { loading: false, sampled: false };
    if (!file) return { loading, sampled: false, error: loading ? undefined : "Source file not found. Re-upload it from the Source step." };
    if (!sheets) return { loading: true, sampled: false };
    const sheet = sheetOf(file, spec.source.sheet)!;
    try {
      const result = execute(spec, sheet, { limit: previewRows, keepSnapshots: true, sheets });
      return { result, loading: false, sampled: sheet.cells.length - spec.source.headerRow - 1 > previewRows };
    } catch (e) {
      return { error: (e as Error).message, loading: false, sampled: false };
    }
  }, [spec, file, loading, previewRows, sheets]);
}

type Handler = (e: KeyboardEvent) => void;

/** Global keyboard shortcuts (PRD §15). Keys like "mod+z", "mod+shift+z", "delete", "escape". */
export function useHotkeys(map: Record<string, Handler>, deps: unknown[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const key = [mod ? "mod" : "", e.shiftKey ? "shift" : "", e.key.toLowerCase()].filter(Boolean).join("+");
      const h = map[key];
      if (!h) return;
      if (typing && !mod && key !== "escape") return;
      if (typing && mod && (key === "mod+z" || key === "mod+shift+z")) return; // native text undo
      e.preventDefault();
      h(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Executes the full dataset in a Web Worker (debounced) — used where exact numbers matter. */
export function useFullExecution(spec: PipelineSpec | undefined): { result?: ExecutionResult; error?: string; loading: boolean } {
  const { file } = useSourceFile(spec?.source?.fileId);
  const sheets = useSideSheets(spec);
  const [state, setState] = useState<{ result?: ExecutionResult; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    if (!spec?.source || !file || !sheets) {
      setState({ loading: !!spec?.source && !file });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      const { executeInWorker } = await import("./runner");
      try {
        const result = await executeInWorker(spec, sheetOf(file, spec.source!.sheet)!, undefined, sheets);
        if (alive) setState({ result, loading: false });
      } catch (e) {
        if (alive) setState({ error: (e as Error).message, loading: false });
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [spec, file, sheets]);
  return state;
}
