// Turns a raw sheet + source spec into a Dataset (header + detected region).
// Mirrors `load_source()` in the generated Python.

import type { Cell, Dataset, RawSheet, SourceSpec } from "./types";
import { isBlank, toText } from "./values";

export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function headerNames(raw: Cell[], startCol: number, endCol: number): string[] {
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (let c = startCol; c <= endCol; c++) {
    let name = toText(raw[c] ?? null)?.trim() || `Column_${colLetter(c)}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name}_${n}`;
    names.push(name);
  }
  return names;
}

/** Key of an additional source's raw sheet (several sheets of one file can be used side by side). */
export function sideSheetKey(fileId: string, sheet?: string): string {
  return sheet ? `${fileId}::${sheet}` : fileId;
}

export function loadDataset(sheet: RawSheet, spec: SourceSpec): Dataset {
  const { headerRow, startCol, endCol } = spec;
  const columns =
    headerRow >= 0
      ? headerNames(sheet.cells[headerRow] ?? [], startCol, endCol)
      : headerNames([], startCol, endCol);
  const rows: Cell[][] = [];
  const rowIds: number[] = [];
  for (let r = headerRow + 1; r < sheet.cells.length; r++) {
    const raw = sheet.cells[r] ?? [];
    const row: Cell[] = [];
    let blank = true;
    for (let c = startCol; c <= endCol; c++) {
      const v = raw[c] ?? null;
      row.push(v);
      if (!isBlank(v)) blank = false;
    }
    if (blank) continue;
    rows.push(row);
    rowIds.push(r + 1);
  }
  return { columns, rows, rowIds };
}

export function fingerprint(row: Cell[]): string {
  return row.map((v) => toText(v) ?? "").join("␟");
}

// ---------------------------------------------------------------------------
// Detection (advisory, PRD §6.2)
// ---------------------------------------------------------------------------

export interface RegionDetection {
  headerRow: number;
  startCol: number;
  endCol: number;
  dataRows: number;
  mergedCells: number;
}

export function detectRegion(sheet: RawSheet): RegionDetection {
  const cells = sheet.cells;
  const scan = Math.min(cells.length, 50);
  let width = 0;
  for (const r of cells) width = Math.max(width, r.length);
  // Column bounds: columns that contain any non-blank value.
  let startCol = width;
  let endCol = -1;
  for (const r of cells) {
    for (let c = 0; c < r.length; c++) {
      if (!isBlank(r[c])) {
        if (c < startCol) startCol = c;
        if (c > endCol) endCol = c;
      }
    }
  }
  if (endCol < 0) return { headerRow: -1, startCol: 0, endCol: Math.max(0, width - 1), dataRows: 0, mergedCells: 0 };

  // Header: first row whose filled ratio within the region is ≥ 60% and whose
  // filled values are all non-numeric text, followed by a non-blank row.
  const span = endCol - startCol + 1;
  let headerRow = -1;
  for (let r = 0; r < scan; r++) {
    const row = cells[r] ?? [];
    let filled = 0;
    let texty = 0;
    for (let c = startCol; c <= endCol; c++) {
      const v = row[c];
      if (!isBlank(v)) {
        filled++;
        if (typeof v === "string" && !/^[-+]?[\d.,\s]+$/.test(v)) texty++;
      }
    }
    if (filled / span >= 0.6 && texty === filled) {
      headerRow = r;
      break;
    }
  }
  let dataRows = 0;
  for (let r = headerRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    for (let c = startCol; c <= endCol; c++)
      if (!isBlank(row[c])) {
        dataRows++;
        break;
      }
  }
  return { headerRow, startCol, endCol, dataRows, mergedCells: sheet.merged?.length ?? 0 };
}
