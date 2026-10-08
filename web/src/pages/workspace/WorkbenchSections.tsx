// The default Workbench: every deep-inspection panel as a collapsible section. Only the sections that
// matter for the selected node open by default (Extract: Data Preview + Step Configuration; Validate:
// Step Configuration + Quality; ...). A viewer's own open / closed choices are remembered per context.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ListChecks, Code2, SlidersHorizontal } from "lucide-react";
import type { PanelId } from "@/store/model";
import { categoryOf, categoryMeta, type ToolCategory } from "@/engine/taxonomy";
import { DocLink } from "@/components/DocLink";
import { useWs, SOURCE } from "./context";
import { InSection } from "./panels/PanelFrame";
import { PreviewPanel } from "./panels/PreviewPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { BeforeAfterPanel } from "./panels/BeforeAfterPanel";
import { FailedRowsPanel, LogsPanel, ProfilePanel, PythonPanel, QualityPanel, RunsPanel, SpecPanel } from "./panels/misc";

export type WorkbenchMode = "configure" | "review" | "engineer";

export interface SectionDef {
  id: PanelId;
  title: string;
  column: "main" | "side";
  /** Fixed height of the open section (px). "auto" grows with its content. */
  height: number | "auto";
  C: () => JSX.Element;
}

export const SECTIONS: SectionDef[] = [
  { id: "preview", title: "Data Preview", column: "main", height: 440, C: PreviewPanel },
  { id: "beforeAfter", title: "Before / After", column: "main", height: 380, C: BeforeAfterPanel },
  { id: "profile", title: "Profile", column: "main", height: 360, C: ProfilePanel },
  { id: "quality", title: "Quality", column: "main", height: 360, C: QualityPanel },
  { id: "failedRows", title: "Failed Rows", column: "main", height: 360, C: FailedRowsPanel },
  { id: "logs", title: "Run Logs", column: "main", height: 300, C: LogsPanel },
  { id: "runs", title: "Run History", column: "main", height: 300, C: RunsPanel },
  { id: "inspector", title: "Step Configuration", column: "side", height: "auto", C: InspectorPanel },
  { id: "python", title: "Code", column: "side", height: 400, C: PythonPanel },
  { id: "spec", title: "Pipeline Spec", column: "side", height: 360, C: SpecPanel },
];

/** Sections open by default for a node category in a mode. Everything else starts collapsed. */
export function defaultOpen(mode: WorkbenchMode, category: ToolCategory): PanelId[] {
  if (mode === "review") return ["failedRows", "beforeAfter"];
  if (mode === "engineer") return ["python", "spec", "logs"];
  if (category === "validate") return ["inspector", "quality"];
  return ["preview", "inspector"];
}

const STORE_KEY = "forma.workbench.sections";

type Remembered = Record<string, Partial<Record<PanelId, boolean>>>;

function readRemembered(): Remembered {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Remembered;
  } catch {
    return {};
  }
}

function writeRemembered(r: Remembered) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: choices last for this visit */
  }
}

const MODES: { id: WorkbenchMode; label: string; icon: JSX.Element }[] = [
  { id: "configure", label: "Configure", icon: <SlidersHorizontal size={13} /> },
  { id: "review", label: "Review", icon: <ListChecks size={13} /> },
  { id: "engineer", label: "Engineer", icon: <Code2 size={13} /> },
];

export function WorkbenchSections({ mode, onMode }: { mode: WorkbenchMode; onMode: (m: WorkbenchMode) => void }) {
  const ws = useWs();
  const step = ws.sel >= 0 && ws.sel < ws.effective.steps.length ? ws.effective.steps[ws.sel] : undefined;
  const category: ToolCategory = ws.sel === SOURCE ? "source" : step ? categoryOf(step) : "load";
  const contextKey = `${mode}:${category}`;
  const [remembered, setRemembered] = useState<Remembered>(readRemembered);
  // A draft always shows its configuration.
  const draftOpen = !!ws.draft;

  const open = useMemo(() => {
    const base = new Set(defaultOpen(mode, category));
    const mine = remembered[contextKey] ?? {};
    for (const [id, on] of Object.entries(mine)) on ? base.add(id as PanelId) : base.delete(id as PanelId);
    if (draftOpen) base.add("inspector");
    return base;
  }, [mode, category, remembered, contextKey, draftOpen]);

  useEffect(() => writeRemembered(remembered), [remembered]);

  const toggle = (id: PanelId) =>
    setRemembered((r) => {
      const isOpen = open.has(id);
      const def = defaultOpen(mode, category).includes(id);
      const mine = { ...(r[contextKey] ?? {}) };
      // Store only differences from the default, so defaults can evolve.
      if (!isOpen === def) delete mine[id];
      else mine[id] = !isOpen;
      return { ...r, [contextKey]: mine };
    });
  const reset = () => setRemembered((r) => ({ ...r, [contextKey]: {} }));
  const customised = Object.keys(remembered[contextKey] ?? {}).length > 0;

  const column = (c: "main" | "side") => (
    <div className={`wbs-col ${c}`}>
      {SECTIONS.filter((s) => s.column === c).map((s) => {
        const on = open.has(s.id);
        return (
          <section key={s.id} className={`wbs ${on ? "open" : ""}`} data-section={s.id}>
            <button className="wbs-head" aria-expanded={on} onClick={() => toggle(s.id)}>
              {on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>{s.title}</span>
            </button>
            {on && (
              <div className="wbs-body" style={s.height === "auto" ? undefined : { height: s.height }}>
                <InSection.Provider value={true}>
                  <s.C />
                </InSection.Provider>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="wbs-wrap">
      <div className="wbs-bar">
        <div className="seg" role="group" aria-label="Workbench focus">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "on" : ""} aria-pressed={mode === m.id} onClick={() => onMode(m.id)}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <span className="small muted">
          {categoryMeta(category).title}. Sections open for what you are doing; your changes are remembered.
        </span>
        {customised && (
          <button className="btn ghost xs" onClick={reset}>
            Reset sections
          </button>
        )}
        <span className="grow" />
        <DocLink page={mode === "review" ? "review-why" : mode === "engineer" ? "engineering-spec" : categoryMeta(category).doc} />
      </div>
      <div className="wbs-grid">
        {column("main")}
        {column("side")}
      </div>
    </div>
  );
}
