// Virtualized spreadsheet-like grid (PRD §6.2, §18): only visible rows are
// rendered into the DOM, so large sources stay responsive.
import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as RME } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Cell } from "@/engine/types";
import { toText } from "@/engine/values";
import { colLetter } from "@/engine/load";

export interface GridColumn {
  name: string;
  width?: number;
  type?: "text" | "number" | "date" | "bool" | "mixed" | "empty";
  headerExtra?: ReactNode;
}

export interface CellPos {
  r: number;
  c: number;
}

interface Props {
  columns: GridColumn[];
  rowCount: number;
  getCell: (r: number, c: number) => Cell;
  rowLabel?: (r: number) => ReactNode;
  cellClass?: (r: number, c: number) => string | undefined;
  rowClass?: (r: number) => string | undefined;
  renderCell?: (r: number, c: number, v: Cell) => ReactNode;
  selectedColumns?: Set<number>;
  selectedCell?: CellPos | null;
  onSelectCell?: (p: CellPos) => void;
  onHeaderClick?: (c: number, e: RME) => void;
  onHeaderContextMenu?: (c: number, e: RME) => void;
  onEnter?: (p: CellPos) => void;
  letters?: boolean;
  zoom?: number;
  showHeader?: boolean;
  gridRef?: (el: HTMLDivElement | null) => void;
  ariaLabel?: string;
}

const TYPE_GLYPH: Record<string, string> = { text: "Aa", number: "123", date: "▦", bool: "✓", mixed: "≈", empty: "∅" };

export function estimateWidths(columns: string[], rows: number, getCell: (r: number, c: number) => Cell): number[] {
  const n = Math.min(rows, 60);
  return columns.map((name, c) => {
    let w = name.length * 7.4 + 54;
    for (let r = 0; r < n; r++) {
      const t = toText(getCell(r, c));
      if (t) w = Math.max(w, Math.min(t.length, 60) * 7 + 24);
    }
    return Math.round(Math.min(Math.max(w, 76), 420));
  });
}

export function DataGrid(props: Props) {
  const {
    columns, rowCount, getCell, rowLabel, cellClass, rowClass, renderCell, selectedColumns, selectedCell,
    onSelectCell, onHeaderClick, onHeaderContextMenu, onEnter, letters, zoom = 1, showHeader = true, gridRef, ariaLabel,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowH = Math.round(30 * zoom);
  const idxW = Math.max(44, String(rowCount).length * 8 + 22);
  const [manual, setManual] = useState<Record<number, number>>({});
  const widths = useMemo(() => columns.map((c, i) => Math.round((manual[i] ?? c.width ?? 140) * zoom)), [columns, manual, zoom]);
  const total = idxW + widths.reduce((a, b) => a + b, 0);
  const headerH = (showHeader ? rowH + 2 : 0) + (letters ? 22 : 0);

  const v = useVirtualizer({ count: rowCount, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12 });
  useEffect(() => v.measure(), [rowH, v]);

  useEffect(() => {
    if (!selectedCell) return;
    v.scrollToIndex(selectedCell.r, { align: "auto" });
  }, [selectedCell, v]);

  const startResize = (c: number, e: RME) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = manual[c] ?? columns[c].width ?? 140;
    const move = (ev: MouseEvent) => setManual((m) => ({ ...m, [c]: Math.max(56, w0 + (ev.clientX - x0) / zoom) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!onSelectCell || !rowCount || !columns.length) return;
    const cur = selectedCell ?? { r: 0, c: 0 };
    let next: CellPos | null = null;
    if (e.key === "ArrowDown") next = { r: Math.min(rowCount - 1, cur.r + 1), c: cur.c };
    else if (e.key === "ArrowUp") next = { r: Math.max(0, cur.r - 1), c: cur.c };
    else if (e.key === "ArrowRight") next = { r: cur.r, c: Math.min(columns.length - 1, cur.c + 1) };
    else if (e.key === "ArrowLeft") next = { r: cur.r, c: Math.max(0, cur.c - 1) };
    else if (e.key === "PageDown") next = { r: Math.min(rowCount - 1, cur.r + 20), c: cur.c };
    else if (e.key === "PageUp") next = { r: Math.max(0, cur.r - 20), c: cur.c };
    else if (e.key === "Enter" && selectedCell) {
      e.preventDefault();
      onEnter?.(selectedCell);
      return;
    }
    if (next) {
      e.preventDefault();
      onSelectCell(next);
      const el = scrollRef.current;
      if (el) {
        let left = idxW;
        for (let i = 0; i < next.c; i++) left += widths[i];
        if (left < el.scrollLeft + idxW) el.scrollLeft = left - idxW;
        else if (left + widths[next.c] > el.scrollLeft + el.clientWidth) el.scrollLeft = left + widths[next.c] - el.clientWidth;
      }
    }
  };

  return (
    <div
      className="grid-wrap"
      ref={(el) => {
        scrollRef.current = el;
        gridRef?.(el);
      }}
      tabIndex={0}
      onKeyDown={onKey}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rowCount}
      style={{ fontSize: `${12.5 * zoom}px` }}
    >
      <div className="grid" style={{ width: total, height: v.getTotalSize() + headerH }}>
        {letters && (
          <div className="grid-letters" style={{ width: total, height: 22 }}>
            <div className="gc gidx" style={{ width: idxW }} />
            {columns.map((_, c) => (
              <div key={c} className={`gc ${selectedColumns?.has(c) ? "col-sel" : ""}`} style={{ width: widths[c], justifyContent: "center" }}>
                {colLetter(c)}
              </div>
            ))}
          </div>
        )}
        {showHeader && (
          <div className="grid-head" style={{ width: total, height: rowH + 2, top: letters ? 22 : 0 }} role="row">
            <div className="gc gidx" style={{ width: idxW }}>
              No.
            </div>
            {columns.map((col, c) => (
              <div
                key={c}
                role="columnheader"
                className={`gc gh ${selectedColumns?.has(c) ? "col-sel" : ""}`}
                style={{ width: widths[c], position: "relative" }}
                onClick={(e) => onHeaderClick?.(c, e)}
                onContextMenu={(e) => {
                  if (onHeaderContextMenu) {
                    e.preventDefault();
                    onHeaderContextMenu(c, e);
                  }
                }}
                title={col.name}
              >
                {col.type && <span className="ty">{TYPE_GLYPH[col.type]}</span>}
                <span className="ellipsis grow">{col.name}</span>
                {col.headerExtra}
                <span onMouseDown={(e) => startResize(c, e)} style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 2 }} />
              </div>
            ))}
          </div>
        )}
        {v.getVirtualItems().map((vr) => {
          const r = vr.index;
          return (
            <div key={vr.key} className={`grid-row ${rowClass?.(r) ?? ""}`} style={{ top: vr.start + headerH, height: rowH, width: total }} role="row">
              <div className="gc gidx" style={{ width: idxW }}>
                {rowLabel ? rowLabel(r) : r + 1}
              </div>
              {columns.map((_, c) => {
                const val = getCell(r, c);
                const blank = val === null || val === "";
                const sel = selectedCell && selectedCell.r === r && selectedCell.c === c;
                const cls = [
                  "gc",
                  typeof val === "number" ? "num-cell" : "",
                  blank ? "blank" : "",
                  selectedColumns?.has(c) ? "col-sel" : "",
                  sel ? "cell-sel" : "",
                  cellClass?.(r, c) ?? "",
                ].join(" ");
                return (
                  <div key={c} className={cls} style={{ width: widths[c] }} onMouseDown={() => onSelectCell?.({ r, c })} role="gridcell" title={toText(val) ?? ""}>
                    <span>{renderCell ? renderCell(r, c, val) : blank ? "-" : typeof val === "number" ? val.toLocaleString("en-US", { maximumFractionDigits: 10 }) : toText(val)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {rowCount === 0 && (
          <div className="muted" style={{ position: "absolute", top: headerH + 24, left: 0, width: "100%", textAlign: "center" }}>
            No rows
          </div>
        )}
      </div>
    </div>
  );
}
