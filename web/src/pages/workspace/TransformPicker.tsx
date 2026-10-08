// + Add Tool: one entry point to every tool, organised as SOURCE → EXTRACT → TRANSFORM → VALIDATE → LOAD.
// The first level shows the five categories only; Transform opens its groups; search spans the taxonomy
// and shows each result's path (Transform > Convert > Date).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search, Sparkles, Hash, CalendarDays, PaintBucket, Replace, Type, CaseSensitive, CopyMinus, ScanText, SlidersHorizontal, Split,
  FunctionSquare, Percent, Columns3, PenLine, Filter, ArrowUpDown, ShieldCheck, Group, Table, Merge, ListPlus, Search as Lookup, CornerDownLeft, Rows3, Bookmark,
  ChevronRight, ChevronLeft, FileInput, ArrowDownToLine, Wand2, ListChecks,
} from "lucide-react";
import type { TransformPreset } from "@/store/model";
import { useApp } from "@/store/app";
import { stepTitle } from "@/engine/registry";
import type { StepType } from "@/engine/types";
import { CATEGORIES, GROUPS, OPERATIONS, operation, pathOf, searchTools, type Operation, type ToolCategory, type TransformGroup } from "@/engine/taxonomy";
import { observations, profileColumn, profileDataset } from "@/engine/profile";
import { DocLink } from "@/components/DocLink";
import { useWs, SOURCE } from "./context";
import { suggestionsFor } from "./panels/InspectorPanel";

export const OP_ICONS: Record<string, React.ReactNode> = {
  convert_number: <Hash size={16} />, standardise_date: <CalendarDays size={16} />, fill_blanks: <PaintBucket size={16} />, replace: <Replace size={16} />,
  trim: <Type size={16} />, change_case: <CaseSensitive size={16} />, remove_duplicates: <CopyMinus size={16} />, extract: <ScanText size={16} />,
  extract_kv: <SlidersHorizontal size={16} />, split: <Split size={16} />, formula: <FunctionSquare size={16} />, round: <Percent size={16} />,
  select: <Columns3 size={16} />, rename: <PenLine size={16} />, filter: <Filter size={16} />, sort: <ArrowUpDown size={16} />, validate: <ShieldCheck size={16} />,
  group: <Group size={16} />, pivot: <Table size={16} />, unpivot: <Rows3 size={16} />, join: <Merge size={16} />, append: <ListPlus size={16} />, lookup: <Lookup size={16} />,
  source: <FileInput size={16} />, load: <ArrowDownToLine size={16} />,
};

export const CATEGORY_ICONS: Record<ToolCategory, React.ReactNode> = {
  source: <FileInput size={16} />,
  extract: <ScanText size={16} />,
  transform: <Wand2 size={16} />,
  validate: <ListChecks size={16} />,
  load: <ArrowDownToLine size={16} />,
};

type Level = { kind: "root" } | { kind: "category"; id: ToolCategory } | { kind: "group"; id: TransformGroup };

interface Item {
  key: string;
  section: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  path?: string;
  /** Drills into a level instead of adding a tool. */
  next?: Level;
  op?: Operation;
  preset?: TransformPreset;
  /** A custom action instead of adding a step (e.g. a branch Load). */
  action?: () => void;
}

const opItem = (o: Operation, section: string, withPath = false): Item => ({
  key: `${section}:${o.id}`,
  section,
  icon: OP_ICONS[o.id],
  title: o.title,
  description: o.description,
  path: withPath ? pathOf(o).join(" > ") : undefined,
  op: o,
});

export function TransformPicker() {
  const ws = useWs();
  const column = ws.pickerOpen?.column;
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<Level>({ kind: "root" });
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const presets = useApp((s) => s.presets);
  const ds = ws.datasetAfter(Math.min(ws.sel, ws.effective.steps.length));
  const open = !!ws.pickerOpen;

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    setLevel(ws.pickerOpen?.category ? { kind: "category", id: ws.pickerOpen.category } : { kind: "root" });
  }, [open, ws.pickerOpen?.category]);

  const suggested = useMemo<Operation[]>(() => {
    if (!ds || !open) return [];
    const types = new Set<string>();
    if (column && ds.columns.includes(column)) for (const s of suggestionsFor(profileColumn(ds, ds.columns.indexOf(column)))) types.add(s.type);
    else for (const o of observations(ds, profileDataset(ds))) if (o.suggestion) types.add(o.suggestion);
    if (!ws.spec.steps.some((s) => s.type === "validate")) types.add("validate");
    return [...types].slice(0, 4).map((t) => OPERATIONS.find((x) => x.id === t)).filter((x): x is Operation => !!x);
  }, [ds, column, ws.spec.steps, open]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim();
    if (needle) {
      const out = searchTools(needle).map((h) => opItem(h.op, "Tools", true));
      for (const p of presets)
        if (`${p.name} ${p.description ?? ""} preset`.toLowerCase().includes(needle.toLowerCase()))
          out.push({ key: `preset:${p.id}`, section: "Your presets", icon: <Bookmark size={16} />, title: p.name, description: p.description || p.steps.map((s) => stepTitle(s)).join(", "), preset: p });
      return out;
    }
    if (level.kind === "root") {
      const out: Item[] = suggested.map((o) => opItem(o, column ? `Suggested for "${column}"` : "Suggested for your data", true));
      for (const c of CATEGORIES) out.push({ key: `cat:${c.id}`, section: "Tools", icon: CATEGORY_ICONS[c.id], title: c.title, description: c.tagline, next: { kind: "category", id: c.id } });
      for (const p of presets)
        out.push({ key: `preset:${p.id}`, section: "Your presets", icon: <Bookmark size={16} />, title: p.name, description: p.description || p.steps.map((s) => stepTitle(s)).join(", "), preset: p });
      return out;
    }
    if (level.kind === "category" && level.id === "transform")
      return GROUPS.map((g) => ({ key: `grp:${g.id}`, section: "Transform", icon: <ChevronRight size={16} />, title: g.title, description: g.tagline, next: { kind: "group", id: g.id } }));
    if (level.kind === "category" && level.id === "source")
      return [
        opItem(operation("source"), "Pipeline source"),
        opItem(operation("lookup"), "Bring in another project source"),
        opItem(operation("join"), "Bring in another project source"),
        opItem(operation("append"), "Bring in another project source"),
      ].map((it) => (it.op?.id === "source" ? { ...it, title: ws.spec.source ? `${ws.spec.source.file}${ws.spec.source.sheet ? ` / ${ws.spec.source.sheet}` : ""}` : "Choose a source", description: "Configure the pipeline's main source" } : it));
    if (level.kind === "category" && level.id === "load")
      return [
        { ...opItem(operation("load"), "Load"), title: "Main Load", description: ws.spec.destination ? "Configure where the pipeline's rows are written" : "Choose where the pipeline's rows are written" },
        { key: "load:branch", section: "Load", icon: OP_ICONS.load, title: "New Load (branch)", description: "Write the selected tool's output to its own destination as well", action: ws.addLoad },
      ];
    if (level.kind === "category") return OPERATIONS.filter((o) => o.category === level.id).map((o) => opItem(o, CATEGORIES.find((c) => c.id === level.id)!.title));
    const g = GROUPS.find((x) => x.id === level.id)!;
    return OPERATIONS.filter((o) => o.group === level.id).map((o) => opItem(o, `Transform > ${g.title}`));
  }, [q, level, suggested, presets, column, ws.spec.source, ws.spec.destination, ws.addLoad]);

  useEffect(() => setActive(0), [q, level]);
  useEffect(() => {
    listRef.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const back = () => {
    if (level.kind === "group") setLevel({ kind: "category", id: "transform" });
    else if (level.kind === "category") setLevel({ kind: "root" });
    inputRef.current?.focus();
  };
  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.next) {
      setLevel(item.next);
      setQ("");
      inputRef.current?.focus();
      return;
    }
    if (item.action) return item.action();
    if (item.preset) return ws.insertPreset(item.preset.steps);
    const o = item.op!;
    if (o.id === "source") return ws.inspect(SOURCE, true);
    if (o.id === "load") return ws.inspect(ws.spec.steps.length, true);
    ws.addStep(o.id as StepType | "lookup", column);
  };

  const crumbs = level.kind === "root" ? [] : level.kind === "category" ? [CATEGORIES.find((c) => c.id === level.id)!.title] : ["Transform", GROUPS.find((g) => g.id === level.id)!.title];
  const doc = level.kind === "category" ? CATEGORIES.find((c) => c.id === level.id)!.doc : level.kind === "group" ? `transform-${level.id}` : "getting-started-add-tool";
  let last = "";
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && ws.closePicker()}>
      <div className="modal lg addtool" role="dialog" aria-label="Add tool">
        <div className="palette-input">
          {crumbs.length > 0 && !q ? (
            <button className="btn ghost xs icon" aria-label="Back" onClick={back}>
              <ChevronLeft size={16} />
            </button>
          ) : (
            <Search size={18} color="var(--subtle)" />
          )}
          {crumbs.length > 0 && !q && <span className="addtool-crumb">{crumbs.join(" > ")}</span>}
          <input
            ref={inputRef}
            autoFocus
            placeholder={column ? `Search tools for "${column}"` : "Search tools, e.g. date, pivot, join"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "ArrowRight" && items[active]?.next && !q) {
                e.preventDefault();
                choose(items[active]);
              } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && !q && level.kind !== "root") {
                e.preventDefault();
                back();
              } else if (e.key === "Enter") choose(items[active]);
              else if (e.key === "Escape") {
                if (q) setQ("");
                else if (level.kind !== "root") back();
                else ws.closePicker();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="empty">No tools match "{q}".</div>}
          {items.map((item, i) => {
            const header =
              item.section !== last ? (
                <div className="palette-group row" style={{ gap: 6 }}>
                  {item.section.startsWith("Suggested") && <Sparkles size={12} color="var(--blue)" />}
                  {item.section === "Your presets" && <Bookmark size={12} color="var(--blue)" />}
                  {item.section}
                </div>
              ) : null;
            last = item.section;
            return (
              <div key={item.key}>
                {header}
                <div className={`palette-item ${i === active ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(item)} role="option" aria-selected={i === active}>
                  <div className="ic">{item.icon}</div>
                  <div className="grow">
                    <div className="t">{item.title}</div>
                    <div className="d">{item.path ? <span className="addtool-path">{item.path}</span> : null}{item.path ? ". " : ""}{item.description}</div>
                  </div>
                  {item.next ? <ChevronRight size={15} color="var(--subtle)" /> : i === active && <CornerDownLeft size={14} color="var(--subtle)" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="addtool-foot">
          <span className="subtle">Enter to choose. Arrow keys to move. Backspace to go back.</span>
          <DocLink page={doc} onNavigate={ws.closePicker} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
