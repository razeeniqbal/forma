import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search, Sparkles, Hash, CalendarDays, PaintBucket, Replace, Type, CaseSensitive, CopyMinus, ScanText, SlidersHorizontal, Split,
  FunctionSquare, Percent, Columns3, PenLine, Filter, ArrowUpDown, ShieldCheck, Group, Table, Merge, ListPlus, Search as Lookup, CornerDownLeft,
} from "lucide-react";
import type { StepType } from "@/engine/types";
import { TRANSFORMS, type TransformMeta } from "@/engine/registry";
import { observations, profileColumn, profileDataset } from "@/engine/profile";
import { useWs } from "./context";
import { suggestionsFor } from "./panels/InspectorPanel";

const ICONS: Record<string, React.ReactNode> = {
  convert_number: <Hash size={16} />, standardise_date: <CalendarDays size={16} />, fill_blanks: <PaintBucket size={16} />, replace: <Replace size={16} />,
  trim: <Type size={16} />, change_case: <CaseSensitive size={16} />, remove_duplicates: <CopyMinus size={16} />, extract: <ScanText size={16} />,
  extract_kv: <SlidersHorizontal size={16} />, split: <Split size={16} />, formula: <FunctionSquare size={16} />, round: <Percent size={16} />,
  select: <Columns3 size={16} />, rename: <PenLine size={16} />, filter: <Filter size={16} />, sort: <ArrowUpDown size={16} />, validate: <ShieldCheck size={16} />,
  group: <Group size={16} />, pivot: <Table size={16} />, join: <Merge size={16} />, append: <ListPlus size={16} />, lookup: <Lookup size={16} />,
};

const ORDER = ["Clean", "Text", "Numeric", "Reshape", "Validate", "Combine"];

export function TransformPicker() {
  const ws = useWs();
  const column = ws.pickerOpen?.column;
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const ds = ws.datasetAfter(Math.min(ws.sel, ws.effective.steps.length));

  const suggested = useMemo<TransformMeta[]>(() => {
    if (!ds) return [];
    const types = new Set<string>();
    if (column && ds.columns.includes(column)) for (const s of suggestionsFor(profileColumn(ds, ds.columns.indexOf(column)))) types.add(s.type);
    else for (const o of observations(ds, profileDataset(ds))) if (o.suggestion) types.add(o.suggestion);
    if (!ws.spec.steps.some((s) => s.type === "validate")) types.add("validate");
    return [...types].slice(0, 4).map((t) => TRANSFORMS.find((x) => x.type === t)!).filter(Boolean);
  }, [ds, column, ws.spec.steps]);

  const items = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const match = (t: TransformMeta) => !needle || `${t.title} ${t.keywords} ${t.category}`.toLowerCase().includes(needle);
    const out: { group: string; t: TransformMeta }[] = [];
    if (!needle) suggested.forEach((t) => out.push({ group: "Suggested for your data", t }));
    for (const g of ORDER) TRANSFORMS.filter((t) => t.category === g && match(t)).forEach((t) => out.push({ group: g === "Combine" ? "Combine — later V1.x" : g, t }));
    return out;
  }, [q, suggested]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!ws.pickerOpen) return null;
  const choose = (t: TransformMeta | undefined) => {
    if (!t || t.later) return;
    ws.addStep(t.type as StepType, column);
  };
  let last = "";
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && ws.closePicker()}>
      <div className="modal lg" role="dialog" aria-label="Add transformation">
        <div className="palette-input">
          <Search size={18} color="var(--subtle)" />
          <input
            autoFocus
            placeholder={column ? `Add transformation for “${column}”…` : "Search transformations…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") choose(items[active]?.t);
              else if (e.key === "Escape") ws.closePicker();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="empty">No transformations match “{q}”.</div>}
          {items.map(({ group, t }, i) => {
            const header = group !== last ? (
              <div className="palette-group row" style={{ gap: 6 }}>
                {group.startsWith("Suggested") && <Sparkles size={12} color="var(--blue)" />}
                {group}
              </div>
            ) : null;
            last = group;
            return (
              <div key={group + t.type}>
                {header}
                <div className={`palette-item ${i === active ? "active" : ""} ${t.later ? "disabled" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(t)}>
                  <div className="ic">{ICONS[t.type]}</div>
                  <div className="grow">
                    <div className="t">{t.title}</div>
                    <div className="d">{t.description}</div>
                  </div>
                  {t.later ? <span className="badge sm">Later</span> : i === active && <CornerDownLeft size={14} color="var(--subtle)" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
