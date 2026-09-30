// Source file parsers (PRD §5 Source). Produce raw grids with the same cell
// normalisation as `read_grid()` / `normalize_cell()` in the generated Python.

import Papa from "papaparse";
import type { Cell, RawSheet, SourceFile, SourceKind } from "@/engine/types";
import { newId } from "@/engine/registry";

export const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.json,.jsonl,.ndjson";
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export function kindFromName(name: string): SourceKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "xlsx" || ext === "xlsm") return "excel";
  if (ext === "json") return "json";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "txt" || ext === "log") return "text";
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatExcelDate(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeExcelValue(v: any): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "" ? null : v;
  if (v instanceof Date) return formatExcelDate(v);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) {
      const t = v.richText.map((r: { text: string }) => r.text).join("");
      return t === "" ? null : t;
    }
    if ("result" in v) return normalizeExcelValue(v.result);
    if ("formula" in v || "sharedFormula" in v) return null;
    if ("text" in v) return normalizeExcelValue(typeof v.text === "string" ? v.text : v.text?.richText ? v.text : String(v.text));
    if ("error" in v) return String(v.error);
  }
  return String(v);
}

export async function parseExcel(buf: ArrayBuffer): Promise<RawSheet[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const cells: Cell[][] = [];
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const out: Cell[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) out.push(null);
        else out.push(normalizeExcelValue(cell.value));
      }
      cells.push(out);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merges = ((ws as any).model?.merges as string[] | undefined) ?? [];
    sheets.push({ name: ws.name, cells, merged: merges });
  });
  return sheets;
}

export function parseCsv(text: string, delimiter?: string): { sheet: RawSheet; delimiter: string } {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter: delimiter ?? "", skipEmptyLines: false });
  const cells = res.data.map((row) => row.map((c) => (c === "" ? null : c)));
  return { sheet: { name: "Sheet1", cells }, delimiter: res.meta.delimiter || "," };
}

function jsonCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

export function recordsToGrid(records: unknown[]): Cell[][] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of records)
    if (r && typeof r === "object" && !Array.isArray(r))
      for (const k of Object.keys(r))
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
  const grid: Cell[][] = [keys.slice()];
  for (const r of records) {
    if (r && typeof r === "object" && !Array.isArray(r)) grid.push(keys.map((k) => jsonCell((r as Record<string, unknown>)[k])));
    else grid.push([jsonCell(r), ...new Array(Math.max(0, keys.length - 1)).fill(null)]);
  }
  return grid;
}

export function parseJson(text: string): RawSheet {
  let data = JSON.parse(text.replace(/^﻿/, ""));
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const arr = Object.values(data).find((v) => Array.isArray(v));
    data = arr ?? [data];
  }
  return { name: "records", cells: recordsToGrid(data as unknown[]) };
}

export function parseJsonl(text: string): RawSheet {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  return { name: "records", cells: recordsToGrid(lines.map((l) => JSON.parse(l))) };
}

export function parseText(text: string): RawSheet {
  return { name: "lines", cells: text.replace(/^﻿/, "").split(/\r?\n/).map((l) => [l === "" ? null : l]) };
}

export interface ParsedFile {
  source: SourceFile;
  delimiter?: string;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const kind = kindFromName(file.name);
  if (!kind) throw new Error(`Unsupported file type: ${file.name}. Use CSV, Excel (.xlsx), JSON, JSONL or text.`);
  if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than 500 MB.");
  let sheets: RawSheet[];
  let delimiter: string | undefined;
  if (kind === "excel") sheets = await parseExcel(await file.arrayBuffer());
  else {
    const text = await file.text();
    if (kind === "csv") {
      const r = parseCsv(text, file.name.toLowerCase().endsWith(".tsv") ? "\t" : undefined);
      sheets = [r.sheet];
      delimiter = r.delimiter;
    } else if (kind === "json") sheets = [parseJson(text)];
    else if (kind === "jsonl") sheets = [parseJsonl(text)];
    else sheets = [parseText(text)];
  }
  if (!sheets.length) throw new Error("The file contains no sheets.");
  return {
    source: { id: newId("src"), name: file.name, kind, size: file.size, addedAt: Date.now(), sheets, delimiter, raw: file },
    delimiter,
  };
}
