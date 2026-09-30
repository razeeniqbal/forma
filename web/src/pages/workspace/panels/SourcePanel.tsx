import { useMemo, useState } from "react";
import { Grid3x3, Code, Search, Minus, Plus, FileSpreadsheet } from "lucide-react";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { Seg, Toggle, useMenu, Empty } from "@/components/ui";
import { colLetter, detectRegion, headerNames } from "@/engine/load";
import { toText } from "@/engine/values";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import { fmtBytes, fmtInt } from "@/lib/format";
import { useWs } from "../context";
import { FloatingBar, useColumnActions } from "../columnActions";
import { PanelFrame } from "./PanelFrame";

function inMerged(merges: string[] | undefined, r: number, c: number): boolean {
  if (!merges?.length) return false;
  for (const m of merges) {
    const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    if (!mm) continue;
    const col = (s: string) => s.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    if (r + 1 >= +mm[2] && r + 1 <= +mm[4] && c >= col(mm[1]) && c <= col(mm[3])) return true;
  }
  return false;
}

export function SourcePanel() {
  const ws = useWs();
  const src = ws.spec.source;
  const { file } = useSourceFile(src?.fileId);
  const sheet = sheetOf(file, src?.sheet);
  const [view, setView] = useState<"grid" | "raw">("grid");
  const [zoom, setZoom] = useState(1);
  const [q, setQ] = useState("");
  const [showMerged, setShowMerged] = useState(true);
  const { floating, menu } = useColumnActions();
  const ctx = useMenu();

  const width = useMemo(() => sheet?.cells.reduce((m, r) => Math.max(m, r.length), 0) ?? 0, [sheet]);
  const names = useMemo(() => (src && sheet ? headerNames(src.headerRow >= 0 ? sheet.cells[src.headerRow] ?? [] : [], src.startCol, src.endCol) : []), [src, sheet]);
  const rows = useMemo(() => {
    if (!sheet) return [];
    const idx = sheet.cells.map((_, i) => i);
    if (!q.trim()) return idx;
    const n = q.toLowerCase();
    return idx.filter((i) => sheet.cells[i].some((v) => (toText(v) ?? "").toLowerCase().includes(n)));
  }, [sheet, q]);

  if (!src)
    return (
      <PanelFrame id="source" title="Source Viewer">
        <Empty icon={<FileSpreadsheet size={22} />} title="No source" />
      </PanelFrame>
    );

  const columns: GridColumn[] = Array.from({ length: width }, (_, c) => ({ name: colLetter(c), width: c >= src.startCol && c <= src.endCol ? 150 : 90 }));
  const selColName = ws.column;
  const selIdx = selColName ? names.indexOf(selColName) : -1;
  const selected = new Set(selIdx >= 0 ? [src.startCol + selIdx] : []);
  const setSheet = (name: string) => {
    const sh = file?.sheets.find((s) => s.name === name);
    if (!sh) return;
    const r = detectRegion(sh);
    ws.update((s) => ({ ...s, source: { ...s.source!, sheet: name, headerRow: r.headerRow, startCol: r.startCol, endCol: r.endCol } }));
  };
  const rowsInRegion = sheet ? sheet.cells.length - src.headerRow - 1 : 0;

  return (
    <PanelFrame
      id="source"
      title="Source Viewer"
      sub={file ? `${file.name} · ${fmtBytes(file.size)}` : undefined}
      icon={<FileSpreadsheet size={15} color="#1d8348" />}
      actions={
        <>
          <Seg
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: <><Grid3x3 size={13} /> Grid</> },
              { value: "raw", label: <><Code size={13} /> Raw</> },
            ]}
          />
          <Toggle
            checked={src.headerRow >= 0}
            onChange={(on) => {
              const r = sheet ? detectRegion(sheet) : null;
              ws.update((s) => ({ ...s, source: { ...s.source!, headerRow: on ? Math.max(0, r?.headerRow ?? 0) : -1 } }));
            }}
            label="Headers"
          />
          <Toggle checked={showMerged} onChange={setShowMerged} label="Merged" />
        </>
      }
      footer={
        sheet && (
          <>
            {file && file.sheets.length > 1 && (
              <label className="row small">
                Sheet:
                <select className="select sm" style={{ width: 130 }} value={sheet.name} onChange={(e) => setSheet(e.target.value)}>
                  {file.sheets.map((s) => (
                    <option key={s.name}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
            <span>
              Range: <b className="mono">{`${colLetter(src.startCol)}${src.headerRow + 1 || 1}:${colLetter(src.endCol)}${sheet.cells.length}`}</b>
            </span>
            <span style={{ marginLeft: "auto" }}>
              Rows: <b className="num">{fmtInt(Math.max(0, rowsInRegion))}</b>
            </span>
            <span>
              Columns: <b>{src.endCol - src.startCol + 1}</b>
            </span>
            <span className="row" style={{ gap: 2 }}>
              <button className="btn ghost xs icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(1)))}>
                <Minus size={13} />
              </button>
              <span className="num" style={{ width: 36, textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <button className="btn ghost xs icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}>
                <Plus size={13} />
              </button>
            </span>
          </>
        )
      }
    >
      {file && file.sheets.length > 1 && (
        <div className="tabs sm" style={{ padding: "0 8px" }}>
          {file.sheets.map((s) => (
            <button key={s.name} className={s.name === sheet?.name ? "on" : ""} onClick={() => setSheet(s.name)}>
              {s.name}
            </button>
          ))}
          <div className="row" style={{ marginLeft: "auto", width: 180 }}>
            <Search size={13} color="var(--subtle)" />
            <input className="input sm" placeholder="Search in sheet…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}
      {!sheet ? (
        <div className="col" style={{ padding: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 22 }} />
          ))}
        </div>
      ) : view === "raw" ? (
        <pre className="mono" style={{ margin: 0, padding: 12, fontSize: 12 * zoom, whiteSpace: "pre", height: "calc(100% - 34px)", overflow: "auto" }}>
          {rows
            .slice(0, 1000)
            .map((r) => sheet.cells[r].map((v) => toText(v) ?? "").join(file?.kind === "csv" ? file.delimiter ?? "," : "\t"))
            .join("\n")}
          {rows.length > 1000 && `\n… ${fmtInt(rows.length - 1000)} more rows`}
        </pre>
      ) : (
        <div style={{ position: "relative", height: file && file.sheets.length > 1 ? "calc(100% - 31px)" : "100%" }}>
          <DataGrid
            ariaLabel="Source sheet"
            columns={columns}
            rowCount={rows.length}
            zoom={zoom}
            getCell={(r, c) => sheet.cells[rows[r]][c] ?? null}
            rowLabel={(r) => rows[r] + 1}
            selectedColumns={selected}
            onHeaderClick={(c) => {
              if (c < src.startCol || c > src.endCol) return;
              const n = names[c - src.startCol];
              ws.setColumn(ws.column === n ? null : n);
            }}
            onHeaderContextMenu={(c, e) => {
              if (c >= src.startCol && c <= src.endCol) ctx.open(e, menu(names[c - src.startCol]));
            }}
            cellClass={(r, c) => {
              const raw = rows[r];
              if (c < src.startCol || c > src.endCol || (src.headerRow >= 0 && raw < src.headerRow)) return "outside";
              if (raw === src.headerRow) return "header-row";
              if (showMerged && inMerged(sheet.merged, raw, c)) return "changed";
              return undefined;
            }}
          />
          {ws.column && !ws.draft && names.includes(ws.column) && <FloatingBar items={floating(ws.column)} style={{ top: 38, right: 12 }} />}
        </div>
      )}
      {ctx.node}
    </PanelFrame>
  );
}
