import { useState } from "react";
import { Modal } from "@/components/ui";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { colLetter } from "@/engine/load";
import { sheetOf, useSourceFile } from "@/lib/hooks";
import type { SourceMeta } from "@/store/model";

/** The raw stored grid of a source (every sheet), exactly as uploaded. */
export function SourcePreviewModal({ meta, initialSheet, onClose }: { meta: SourceMeta; initialSheet?: string; onClose: () => void }) {
  const { file } = useSourceFile(meta.id);
  const [sheetName, setSheetName] = useState<string | undefined>(initialSheet);
  const sheet = sheetOf(file, sheetName);
  const width = sheet?.cells.reduce((m, r) => Math.max(m, r.length), 0) ?? 0;
  const cols: GridColumn[] = Array.from({ length: width }, (_, c) => ({ name: colLetter(c), width: 140 }));
  return (
    <Modal title={meta.name} size="xl" onClose={onClose}>
      {file && file.sheets.length > 1 && (
        <div className="tabs sm" style={{ marginBottom: 8 }}>
          {file.sheets.map((s) => (
            <button key={s.name} className={s.name === sheet?.name ? "on" : ""} onClick={() => setSheetName(s.name)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ height: "60vh", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {sheet ? <DataGrid columns={cols} rowCount={sheet.cells.length} getCell={(r, c) => sheet.cells[r][c] ?? null} /> : <div className="skeleton" style={{ height: "100%" }} />}
      </div>
    </Modal>
  );
}
