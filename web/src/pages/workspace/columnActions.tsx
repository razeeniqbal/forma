import type { ReactNode } from "react";
import {
  ScanText, Split, Eraser, Replace, RefreshCcw, BarChart3, FunctionSquare, MoreHorizontal, CalendarDays, Hash,
  PaintBucket, Type, CaseSensitive, Trash2, PenLine, ArrowUpNarrowWide, ArrowDownWideNarrow, Filter, ShieldCheck,
} from "lucide-react";
import type { StepType } from "@/engine/types";
import { newId } from "@/engine/registry";
import type { MenuItem } from "@/components/ui";
import { useWs } from "./context";

export function useColumnActions() {
  const ws = useWs();
  const ds = ws.datasetAfter(Math.min(ws.sel, ws.effective.steps.length));

  const add = (type: StepType, column: string) => ws.addStep(type, column);

  const floating = (column: string): { label: string; icon: ReactNode; run: () => void }[] => [
    { label: "Extract", icon: <ScanText size={17} />, run: () => add("extract", column) },
    { label: "Split", icon: <Split size={17} />, run: () => add("split", column) },
    { label: "Clean", icon: <Eraser size={17} />, run: () => add("trim", column) },
    { label: "Replace", icon: <Replace size={17} />, run: () => add("replace", column) },
    { label: "Convert", icon: <RefreshCcw size={17} />, run: () => add("convert_number", column) },
    { label: "Profile", icon: <BarChart3 size={17} />, run: () => ws.setColumn(column) },
    { label: "Formula", icon: <FunctionSquare size={17} />, run: () => add("formula", column) },
    { label: "More", icon: <MoreHorizontal size={17} />, run: () => ws.openPicker(column) },
  ];

  const menu = (column: string): MenuItem[] => [
    { label: "Change type → Number", icon: <Hash size={15} />, onClick: () => add("convert_number", column) },
    { label: "Standardise date format", icon: <CalendarDays size={15} />, onClick: () => add("standardise_date", column) },
    { label: "Fill blanks", icon: <PaintBucket size={15} />, onClick: () => add("fill_blanks", column) },
    { label: "Replace values", icon: <Replace size={15} />, onClick: () => add("replace", column) },
    { separator: true, label: "" },
    { label: "Trim", icon: <Type size={15} />, onClick: () => add("trim", column) },
    { label: "Change case", icon: <CaseSensitive size={15} />, onClick: () => add("change_case", column) },
    { label: "Extract fields", icon: <ScanText size={15} />, onClick: () => add("extract", column) },
    { label: "Split", icon: <Split size={15} />, onClick: () => add("split", column) },
    { separator: true, label: "" },
    {
      label: "Remove column",
      icon: <Trash2 size={15} />,
      onClick: () => ds && ws.startDraft({ step: { id: newId("sele"), type: "select", columns: ds.columns.filter((c) => c !== column) }, index: nextIndex(ws), isNew: true }),
    },
    { label: "Rename", icon: <PenLine size={15} />, onClick: () => add("rename", column) },
    { label: "Formula", icon: <FunctionSquare size={15} />, onClick: () => add("formula", column) },
    { separator: true, label: "" },
    { label: "Filter rows", icon: <Filter size={15} />, onClick: () => add("filter", column) },
    { label: "Sort ascending", icon: <ArrowUpNarrowWide size={15} />, onClick: () => add("sort", column) },
    {
      label: "Sort descending",
      icon: <ArrowDownWideNarrow size={15} />,
      onClick: () => ws.startDraft({ step: { id: newId("sort"), type: "sort", column, direction: "desc" }, index: nextIndex(ws), isNew: true }),
    },
    { label: "Validate column", icon: <ShieldCheck size={15} />, onClick: () => add("validate", column) },
    { label: "Profile", icon: <BarChart3 size={15} />, onClick: () => ws.setColumn(column) },
  ];
  return { floating, menu };
}

function nextIndex(ws: ReturnType<typeof useWs>): number {
  return Math.min(Math.max(ws.sel, -1) + 1, ws.spec.steps.length);
}

export function FloatingBar({ items, style }: { items: { label: string; icon: ReactNode; run: () => void }[]; style?: React.CSSProperties }) {
  return (
    <div className="float-bar" style={style} role="toolbar" aria-label="Column actions">
      {items.map((it) => (
        <button key={it.label} onClick={it.run}>
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
