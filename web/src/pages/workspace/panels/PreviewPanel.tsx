import { useMemo, useState } from "react";
import { Search, Table2 } from "lucide-react";
import { DataGrid, estimateWidths, type GridColumn } from "@/components/DataGrid";
import { Toggle, useMenu, Empty } from "@/components/ui";
import { profileColumn } from "@/engine/profile";
import { stepTitle } from "@/engine/registry";
import { toText } from "@/engine/values";
import { fmtInt } from "@/lib/format";
import { useWs } from "../context";
import { FloatingBar, useColumnActions } from "../columnActions";
import { PanelFrame } from "./PanelFrame";

export function PreviewPanel() {
  const ws = useWs();
  const { floating, menu } = useColumnActions();
  const ctx = useMenu();
  const total = ws.effective.steps.length;
  const stepIdx = Math.min(ws.sel, total);
  const ds = ws.datasetAfter(stepIdx);
  const before = stepIdx >= 0 && stepIdx < total ? ws.datasetBefore(stepIdx) : undefined;
  const step = stepIdx >= 0 && stepIdx < total ? ws.effective.steps[stepIdx] : undefined;
  const [q, setQ] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const issueCells = useMemo(() => {
    const m = new Map<string, "invalid" | "review">();
    const res = ws.preview.result;
    if (!res) return m;
    const upto = new Set(ws.effective.steps.slice(0, stepIdx + 1).map((s) => s.id));
    const review = new Set(res.reviewRows);
    for (const i of res.issues) if (upto.has(i.stepId)) m.set(`${i.row}\u0000${i.column}`, review.has(i.row) ? "invalid" : "review");
    return m;
  }, [ws.preview.result, ws.effective.steps, stepIdx]);

  const flaggedRows = useMemo(() => new Set([...issueCells.keys()].map((k) => Number(k.split("\u0000")[0]))), [issueCells]);

  const rows = useMemo(() => {
    if (!ds) return [];
    let idx = ds.rows.map((_, i) => i);
    if (onlyFlagged) idx = idx.filter((i) => flaggedRows.has(ds.rowIds[i]));
    if (q.trim()) {
      const needle = q.toLowerCase();
      idx = idx.filter((i) => ds.rows[i].some((v) => (toText(v) ?? "").toLowerCase().includes(needle)));
    }
    return idx;
  }, [ds, q, onlyFlagged, flaggedRows]);

  const beforeIdx = useMemo(() => {
    if (!before || !ds) return null;
    const m = new Map<number, number>();
    before.rowIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [before, ds]);

  const columns: GridColumn[] = useMemo(() => {
    if (!ds) return [];
    const widths = estimateWidths(ds.columns, ds.rows.length, (r, c) => ds.rows[r][c]);
    return ds.columns.map((name, i) => ({ name, width: widths[i], type: profileColumn(ds, i, 300).type }));
  }, [ds]);

  const selectedCols = useMemo(() => new Set(ws.column && ds ? [ds.columns.indexOf(ws.column)] : []), [ws.column, ds]);
  const title = stepIdx < 0 ? "source" : stepIdx >= total ? "review gate · rows to load" : stepTitle(step!);

  return (
    <PanelFrame
      id="preview"
      title="Data preview"
      sub={`(after ${title})`}
      actions={
        <>
          <div className="row" style={{ width: 170 }}>
            <Search size={14} color="var(--subtle)" />
            <input className="input sm" placeholder="Search data…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Toggle checked={onlyFlagged} onChange={setOnlyFlagged} label="Flagged only" />
        </>
      }
      footer={
        ds && (
          <>
            <span>
              Rows: <b className="num">{fmtInt(rows.length)}</b>
              {rows.length !== ds.rows.length && <> of {fmtInt(ds.rows.length)}</>}
            </span>
            <span>
              Columns: <b>{ds.columns.length}</b>
            </span>
            {ws.preview.sampled && <span className="badge sm">Preview sample</span>}
            <span className="row" style={{ marginLeft: "auto", gap: 10 }}>
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ background: "var(--amber-cell)", border: "1px solid #fedf89" }} /> Changed
              </span>
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ background: "var(--red-bg)", border: "1px solid #fecdca" }} /> Needs review
              </span>
            </span>
          </>
        )
      }
    >
      {ws.preview.error ? (
        <div className="callout red" style={{ margin: 12 }}>
          {ws.preview.error}
        </div>
      ) : !ds ? (
        ws.spec.source ? (
          <div className="col" style={{ padding: 12 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 22 }} />
            ))}
          </div>
        ) : (
          <Empty icon={<Table2 size={22} />} title="No source yet">
            Choose a source to start shaping data.
          </Empty>
        )
      ) : (
        <div style={{ position: "relative", height: "100%" }}>
          <DataGrid
            ariaLabel="Data preview"
            columns={columns}
            rowCount={rows.length}
            getCell={(r, c) => ds.rows[rows[r]][c]}
            rowLabel={(r) => ds.rowIds[rows[r]]}
            selectedColumns={selectedCols}
            selectedCell={ws.cell}
            onSelectCell={(p) => {
              ws.setCell(p);
              ws.setColumn(ds.columns[p.c]);
            }}
            onEnter={(p) => ws.setColumn(ds.columns[p.c])}
            onHeaderClick={(c) => ws.setColumn(ws.column === ds.columns[c] ? null : ds.columns[c])}
            onHeaderContextMenu={(c, e) => ctx.open(e, menu(ds.columns[c]))}
            cellClass={(r, c) => {
              const id = ds.rowIds[rows[r]];
              const flag = issueCells.get(`${id}\u0000${ds.columns[c]}`);
              if (flag) return flag;
              if (beforeIdx && before) {
                const bi = beforeIdx.get(id);
                const bc = before.columns.indexOf(ds.columns[c]);
                if (bi === undefined || bc < 0) return before.columns.includes(ds.columns[c]) ? undefined : "changed";
                if (before.rows[bi][bc] !== ds.rows[rows[r]][c]) return "changed";
              }
              return undefined;
            }}
          />
          {ws.column && !ws.draft && ds.columns.includes(ws.column) && (
            <FloatingBar items={floating(ws.column)} style={{ top: 38, right: 12 }} />
          )}
        </div>
      )}
      {ctx.node}
    </PanelFrame>
  );
}
