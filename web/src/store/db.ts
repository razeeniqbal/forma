// Local persistence (IndexedDB). Source files are immutable once stored (PRD §17).
import { createStore, del, get, set } from "idb-keyval";
import type { Dataset, SourceFile } from "@/engine/types";

const store = typeof indexedDB !== "undefined" ? createStore("forma", "kv") : undefined;

export async function load<T>(key: string): Promise<T | undefined> {
  if (!store) return undefined;
  try {
    return await get<T>(key, store);
  } catch {
    return undefined;
  }
}

export async function save(key: string, value: unknown): Promise<void> {
  if (!store) return;
  await set(key, value, store);
}

export async function remove(key: string): Promise<void> {
  if (!store) return;
  await del(key, store);
}

const sourceCache = new Map<string, SourceFile>();

export async function putSourceFile(file: SourceFile): Promise<void> {
  sourceCache.set(file.id, file);
  await save(`src:${file.id}`, file);
}

export async function getSourceFile(id: string): Promise<SourceFile | undefined> {
  const hit = sourceCache.get(id);
  if (hit) return hit;
  const f = await load<SourceFile>(`src:${id}`);
  if (f) sourceCache.set(id, f);
  return f;
}

export function peekSourceFile(id: string): SourceFile | undefined {
  return sourceCache.get(id);
}

export async function deleteSourceFile(id: string): Promise<void> {
  sourceCache.delete(id);
  await remove(`src:${id}`);
  await remove(`raw:${id}`);
}

export async function putRawFile(id: string, blob: Blob): Promise<void> {
  await save(`raw:${id}`, blob);
}

export async function getRawFile(id: string): Promise<Blob | undefined> {
  return load<Blob>(`raw:${id}`);
}

/** A run's output. Branching pipelines store one per Load; the main Load uses the plain key. */
export async function putRunOutput(runId: string, ds: Dataset, loadId?: string): Promise<void> {
  await save(loadId && loadId !== "load" ? `out:${runId}:${loadId}` : `out:${runId}`, ds);
}

export async function getRunOutput(runId: string, loadId?: string): Promise<Dataset | undefined> {
  return load<Dataset>(loadId && loadId !== "load" ? `out:${runId}:${loadId}` : `out:${runId}`);
}

export async function clearAll(): Promise<void> {
  if (!store) return;
  const { clear } = await import("idb-keyval");
  sourceCache.clear();
  await clear(store);
}
