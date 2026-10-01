import { Layers } from "lucide-react";
import { detectRegion } from "@/engine/load";
import type { SourceFile } from "@/engine/types";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import { fmtInt } from "@/lib/format";
import { useApp } from "@/store/app";
import { useWs, type Ctx as WsContext } from "./context";

/** Point the pipeline at another sheet of its workbook (region re-detected for that sheet). */
export function switchSheet(ws: WsContext, file: SourceFile, name: string) {
  const sh = file.sheets.find((s) => s.name === name);
  if (!sh || ws.spec.source?.sheet === name) return;
  const r = detectRegion(sh);
  ws.update((s) => ({
    ...s,
    source: {
      ...s.source!,
      sheet: name,
      headerRow: r.headerRow,
      startCol: r.startCol,
      endCol: r.endCol,
    },
  }));
  if (ws.spec.steps.length)
    useApp.getState().toast("info", `Now reading sheet “${name}”. Steps that use columns this sheet does not have will show an error until you adjust them.`);
}

/** Which sheet of a multi-sheet workbook the pipeline reads; renders nothing for single-sheet sources. */
export function SheetSelect({ showCount }: { showCount?: boolean }) {
  const ws = useWs();
  const src = ws.spec.source;
  const { file } = useSourceFile(src?.fileId);
  const meta = useApp((s) => s.sources.find((x) => x.id === src?.fileId));
  if (!src || !file || file.sheets.length < 2) return null;
  const current = sheetOf(file, src.sheet)!;
  const idx = file.sheets.indexOf(current);
  return (
    <label className="row small sheet-select" title="Each sheet of the workbook is a separate source">
      <Layers size={14} color="var(--blue)" />
      <select className="select sm" aria-label="Source sheet" value={current.name} onChange={(e) => switchSheet(ws, file, e.target.value)}>
        {file.sheets.map((s) => {
          const rows = meta?.sheets.find((m) => m.name === s.name)?.rows;
          return (
            <option key={s.name} value={s.name}>
              {s.name}
              {rows !== undefined ? ` (${fmtInt(rows)} rows)` : ""}
            </option>
          );
        })}
      </select>
      {showCount && (
        <span className="muted" style={{ whiteSpace: "nowrap" }}>
          Sheet {idx + 1} of {file.sheets.length}
        </span>
      )}
    </label>
  );
}
