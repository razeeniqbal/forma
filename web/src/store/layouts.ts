import type { PanelId, PresetId, WorkspaceLayout } from "./model";

export const PANEL_TITLES: Record<PanelId, string> = {
  source: "Source Viewer",
  preview: "Data Preview",
  pipeline: "Pipeline",
  inspector: "Step Inspector",
  beforeAfter: "Before / After",
  profile: "Data Profile",
  quality: "Quality",
  failedRows: "Failed Rows",
  python: "Python",
  sql: "SQL",
  spec: "Pipeline Spec",
  logs: "Run Logs",
  runs: "Run History",
};

export const ALL_PANELS = Object.keys(PANEL_TITLES) as PanelId[];

export const PRESETS: Record<Exclude<PresetId, "custom">, WorkspaceLayout> = {
  analyst: {
    id: "analyst",
    name: "Analyst",
    builtIn: true,
    columns: [
      { panels: ["pipeline"], size: 17 },
      { panels: ["preview", "beforeAfter"], size: 52, heights: [58, 42] },
      { panels: ["inspector", "profile"], size: 31, heights: [66, 34] },
    ],
  },
  extraction: {
    id: "extraction",
    name: "Extraction",
    builtIn: true,
    columns: [
      { panels: ["source", "failedRows"], size: 56, heights: [62, 38] },
      { panels: ["inspector"], size: 44 },
    ],
  },
  compare: {
    id: "compare",
    name: "Compare",
    builtIn: true,
    columns: [
      { panels: ["beforeAfter", "preview"], size: 60 },
      { panels: ["profile", "quality"], size: 40 },
    ],
  },
  engineer: {
    id: "engineer",
    name: "Engineer",
    builtIn: true,
    columns: [
      { panels: ["pipeline"], size: 18 },
      { panels: ["preview", "logs"], size: 44, heights: [60, 40] },
      { panels: ["python"], size: 38 },
    ],
  },
  monitor: {
    id: "monitor",
    name: "Monitor",
    builtIn: true,
    columns: [
      { panels: ["runs", "logs"], size: 60 },
      { panels: ["quality", "failedRows"], size: 40 },
    ],
  },
};

export const PRESET_ORDER: PresetId[] = ["analyst", "extraction", "compare", "engineer", "monitor", "custom"];
export const PRESET_LABEL: Record<PresetId, string> = {
  analyst: "Analyst",
  extraction: "Extraction",
  compare: "Compare",
  engineer: "Engineer",
  monitor: "Monitor",
  custom: "Custom",
};

export function cloneLayout(l: WorkspaceLayout): WorkspaceLayout {
  return { ...l, columns: l.columns.map((c) => ({ ...c, panels: c.panels.slice(), heights: c.heights?.slice() })) };
}
