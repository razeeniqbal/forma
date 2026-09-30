import { useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import type { Cell } from "@/engine/types";
import { stepColumns, stepTitle } from "@/engine/registry";
import { DataGrid, estimateWidths, type GridColumn } from "@/components/DataGrid";
import { Empty, Seg, Toggle } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { useWs } from "../context";
import { PanelFrame } from "./PanelFrame";

type View = "changed" | "all" | "invalid";

export function BeforeAfterTable({ index, initialView = "changed" }: { index: number; initialView?: View }) {
  const ws = useWs();
  const [view, setView] = useState<View>(initialView);
  const [hl, setHl] = useState(true);
  const step = ws.effective.steps[index];
  const before = ws.datasetBefore(index);
  const after = ws.datasetAfter(index);

  const model = useMemo(() => {
    if (!step || !before || !after) return null;
    const bIdx = new Map(before.rowIds.map((id, i) => [id, i]));
    const aIdx = new Map(after.rowIds.map((id, i) => [id, i]));
    const issueRows = new Map<number, Set<string>>();
    for (const i of ws.issuesFor(step.id)) {
      const s = issueRows.get(i.row) ?? new Set();
      s.add(i.column);
      issueRows.set(i.row, s);
    }
    const inputs = stepColumns(step).filter((c) => before.columns.includes(c));
    const changed = after.columns.filter((c) => {
      const bc = before.columns.indexOf(c);
      if (bc < 0) return true;
      const ac = after.columns.indexOf(c);
      return after.rows.some((row, r) => {
        const bi = bIdx.get(after.rowIds[r]);
        return bi !== undefined && before.rows[bi][bc] !== row[ac];
      });
    });
    const renamed = before.columns.length === after.columns.length && step.type === "rename";
    const afterCols = renamed ? after.columns.filter((c) => !before.columns.includes(c)) : changed.length ? changed : inputs.filter((c) => after.columns.includes(c));
    const beforeCols = renamed ? Object.keys((step as { mapping: Record<string, string> }).mapping) : inputs.length ? inputs : afterCols.filter((c) => before.columns.includes(c));
    const context = before.columns.filter((c) => !beforeCols.includes(c) && !afterCols.includes(c)).slice(0, 2);
    const ids = before.rowIds.filter((id) => {
      if (view === "all") return true;
      if (view === "invalid") return issueRows.has(id);
      const ai = aIdx.get(id);
      if (ai === undefined || issueRows.has(id)) return true;
      const bi = bIdx.get(id)!;
      return afterCols.some((c) => {
        const bc = before.columns.indexOf(c);
        return bc < 0 ? after.rows[ai][after.columns.indexOf(c)] !== null : before.rows[bi][bc] !== after.rows[ai][after.columns.indexOf(c)];
      });
    });
    const cols = [
      ...context.map((c) => ({ side: "ctx" as const, c })),
      ...beforeCols.map((c) => ({ side: "before" as const, c })),
      ...afterCols.map((c) => ({ side: "after" as const, c })),
    ];
    const get = (r: number, k: number): Cell => {
      const id = ids[r];
      const col = cols[k];
      if (col.side === "after") {
        const ai = aIdx.get(id);
        if (ai === undefined) return "(removed)";
        return after.rows[ai][after.columns.indexOf(col.c)];
      }
      return before.rows[bIdx.get(id)!][before.columns.indexOf(col.c)];
    };
    const widths = estimateWidths(cols.map((c) => c.c + "  after"), Math.min(ids.length, 60), get);
    const gridCols: GridColumn[] = cols.map((c, k) => ({ name: c.side === "ctx" ? c.c : `${c.side === "before" ? "BEFORE" : "AFTER"} · ${c.c}`, width: widths[k] }));
    return { ids, cols, get, gridCols, issueRows, bIdx, aIdx, removed: before.rows.length - after.rows.length };
  }, [step, before, after, view, ws]);

  if (!step) return <Empty icon={<GitCompareArrows size={22} />} title="Select a step to compare" />;
  if (!model) return <div className="muted" style={{ padding: 12 }}>Loading preview…</div>;
  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="row" style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", gap: 12 }}>
        <Seg
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "changed", label: "Changed rows" },
            { value: "invalid", label: "Invalid only" },
            { value: "all", label: "All rows" },
          ]}
        />
        <Toggle checked={hl} onChange={setHl} label="Highlight changes" />
        <span className="small muted" style={{ marginLeft: "auto" }}>
          <b className="num">{fmtInt(model.ids.length)}</b> of {fmtInt(before?.rows.length ?? 0)} rows
          {model.removed > 0 && ` · ${fmtInt(model.removed)} removed`}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          ariaLabel="Before and after"
          columns={model.gridCols}
          rowCount={model.ids.length}
          getCell={model.get}
          rowLabel={(r) => model.ids[r]}
          cellClass={(r, k) => {
            if (!hl) return undefined;
            const col = model.cols[k];
            const id = model.ids[r];
            if (col.side !== "after") return col.side === "before" ? "header-row" : undefined;
            if (model.issueRows.get(id)?.has(col.c)) return "invalid";
            const v = model.get(r, k);
            if (v === "(removed)") return "invalid";
            const bc = before!.columns.indexOf(col.c);
            const bv = bc >= 0 ? before!.rows[model.bIdx.get(id)!][bc] : undefined;
            return bv === v ? undefined : "changed";
          }}
        />
      </div>
    </div>
  );
}

export function BeforeAfterPanel() {
  const ws = useWs();
  const total = ws.effective.steps.length;
  const idx = ws.sel >= 0 && ws.sel < total ? ws.sel : total - 1;
  const step = ws.effective.steps[idx];
  return (
    <PanelFrame id="beforeAfter" title="Before / After" sub={step ? stepTitle(step) : undefined} icon={<GitCompareArrows size={15} color="var(--blue)" />}>
      {idx >= 0 ? <BeforeAfterTable key={idx} index={idx} /> : <Empty icon={<GitCompareArrows size={22} />} title="No steps yet">Add a transformation to compare original and transformed values.</Empty>}
    </PanelFrame>
  );
}
