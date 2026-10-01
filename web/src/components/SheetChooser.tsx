import { useState } from "react";
import { Layers, Sheet } from "lucide-react";
import { Modal } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import type { SourceMeta } from "@/store/model";

/** Readable source label for one sheet of a workbook: "invoices.xlsx › Summary". */
export function sheetLabel(meta: Pick<SourceMeta, "name" | "sheets">, sheet?: string): string {
  return meta.sheets.length > 1 && sheet ? `${meta.name} › ${sheet}` : meta.name;
}

/** Every worksheet of a workbook is its own source: pick one, or start one pipeline per sheet. */
export function SheetChooser({
  meta,
  onPick,
  onEach,
  onClose,
}: {
  meta: SourceMeta;
  onPick: (sheet: string) => void;
  onEach?: (sheets: string[]) => void;
  onClose: () => void;
}) {
  const usable = meta.sheets.filter((s) => s.rows > 0);
  const [sel, setSel] = useState((usable[0] ?? meta.sheets[0]).name);
  return (
    <Modal
      title={`Choose a sheet · ${meta.name}`}
      icon={<Layers size={18} color="var(--blue)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {onEach && usable.length > 1 && (
            <button className="btn" onClick={() => onEach(usable.map((s) => s.name))}>
              One pipeline per sheet ({usable.length})
            </button>
          )}
          <button className="btn primary" onClick={() => onPick(sel)}>
            Use “{sel}”
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        This workbook has {meta.sheets.length} sheets. Each sheet is a separate source — pick the one this pipeline reads. Other sheets can be added later with
        an Append or Lookup / Join step.
      </p>
      <div className="col" style={{ gap: 8 }} role="radiogroup" aria-label="Sheets">
        {meta.sheets.map((s, i) => {
          const empty = s.rows === 0;
          return (
            <button
              key={s.name}
              role="radio"
              aria-checked={sel === s.name}
              className={`option ${sel === s.name ? "on" : ""} ${empty ? "disabled" : ""}`}
              style={{ textAlign: "left" }}
              disabled={empty}
              onClick={() => setSel(s.name)}
              onDoubleClick={() => !empty && onPick(s.name)}
            >
              <Sheet size={18} color={empty ? "var(--subtle)" : "var(--green-text)"} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{s.name}</div>
                <div className="d">{empty ? "Empty sheet" : `${fmtInt(s.rows)} rows · ${s.cols} columns`}</div>
              </div>
              <span className="badge sm">Sheet {i + 1}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
