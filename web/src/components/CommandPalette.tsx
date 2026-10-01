import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Search, Workflow, Plus, Database, History, Settings, FolderInput, CornerDownLeft, FolderKanban, LayoutDashboard } from "lucide-react";
import { useApp } from "@/store/app";
import { projectPath, useCurrentProjectId } from "@/lib/project";

export interface PaletteAction {
  id: string;
  group: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

/** Views (e.g. a pipeline workspace) register contextual actions here. */
export const usePalette = create<{ open: boolean; actions: Record<string, PaletteAction[]>; setOpen: (v: boolean) => void; register: (key: string, a: PaletteAction[]) => void; unregister: (key: string) => void }>((set) => ({
  open: false,
  actions: {},
  setOpen: (open) => set({ open }),
  register: (key, a) => set((s) => ({ actions: { ...s.actions, [key]: a } })),
  unregister: (key) =>
    set((s) => {
      const next = { ...s.actions };
      delete next[key];
      return { actions: next };
    }),
}));

export function usePaletteActions(key: string, actions: PaletteAction[]) {
  const register = usePalette((s) => s.register);
  const unregister = usePalette((s) => s.unregister);
  useEffect(() => {
    register(key, actions);
    return () => unregister(key);
  }, [key, actions, register, unregister]);
}

function score(a: PaletteAction, q: string): number {
  if (!q) return 1;
  const hay = `${a.title} ${a.description ?? ""} ${a.keywords ?? ""} ${a.group}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += a.title.toLowerCase().startsWith(w) ? 3 : a.title.toLowerCase().includes(w) ? 2 : 1;
  }
  return s;
}

export function CommandPalette() {
  const { open, setOpen, actions } = usePalette();
  const nav = useNavigate();
  const pipelines = useApp((s) => s.pipelines);
  const projects = useApp((s) => s.projects);
  const currentProjectId = useCurrentProjectId();
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const all = useMemo<PaletteAction[]>(() => {
    const go = (path: string) => () => nav(path);
    const pid = currentProject?.id;
    const base: PaletteAction[] = [
      ...(pid
        ? [
            { id: "nav-overview", group: currentProject!.name, title: "Overview", keywords: "project map", icon: <LayoutDashboard size={16} />, run: go(projectPath(pid)) },
            { id: "nav-sources", group: currentProject!.name, title: "Sources", keywords: "files uploads data", icon: <FolderInput size={16} />, run: go(projectPath(pid, "sources")) },
            { id: "nav-pipelines", group: currentProject!.name, title: "Pipelines", icon: <Workflow size={16} />, run: go(projectPath(pid, "pipelines")) },
            { id: "nav-new", group: currentProject!.name, title: "New pipeline", keywords: "create", icon: <Plus size={16} />, run: go(projectPath(pid, "pipelines/new")) },
            { id: "nav-runs", group: currentProject!.name, title: "Runs", keywords: "runs executions logs history", icon: <History size={16} />, run: go(projectPath(pid, "runs")) },
          ]
        : []),
      { id: "nav-projects", group: "Navigate", title: "Projects", icon: <FolderKanban size={16} />, run: go("/projects") },
      { id: "nav-new-project", group: "Navigate", title: "New project", keywords: "create", icon: <Plus size={16} />, run: go("/projects/new") },
      { id: "nav-dest", group: "Navigate", title: "Destinations & connections", keywords: "database connection warehouse", icon: <Database size={16} />, run: go("/destinations") },
      { id: "nav-settings", group: "Navigate", title: "Settings", icon: <Settings size={16} />, run: go("/settings") },
    ];
    const projectList: PaletteAction[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      group: "Projects",
      title: p.name,
      description: p.description,
      icon: <FolderKanban size={16} />,
      run: go(projectPath(p.id)),
    }));
    const pipes: PaletteAction[] = pipelines.map((p) => ({
      id: `pipe-${p.id}`,
      group: "Pipelines",
      title: p.spec.name,
      description: `${projects.find((x) => x.id === p.projectId)?.name ?? ""} · ${p.spec.source?.file ?? "No source"}`,
      icon: <Workflow size={16} />,
      run: go(`/pipelines/${p.id}`),
    }));
    return [...Object.values(actions).flat(), ...base, ...projectList, ...pipes];
  }, [actions, pipelines, projects, currentProject, nav]);

  const results = useMemo(
    () =>
      all
        .map((a) => ({ a, s: score(a, q) }))
        .filter((x) => x.s > 0)
        .sort((x, y) => (q ? y.s - x.s : 0))
        .map((x) => x.a)
        .slice(0, 60),
    [all, q],
  );

  useEffect(() => {
    listRef.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const run = (a: PaletteAction | undefined) => {
    if (!a || a.disabled) return;
    setOpen(false);
    a.run();
  };
  let lastGroup = "";
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal lg" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={18} color="var(--subtle)" />
          <input
            autoFocus
            placeholder="Search pipelines, transformations and actions…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") run(results[active]);
              else if (e.key === "Escape") setOpen(false);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="empty">No matches for “{q}”.</div>}
          {results.map((a, i) => {
            const header = a.group !== lastGroup ? <div className="palette-group">{a.group}</div> : null;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {header}
                <div className={`palette-item ${i === active ? "active" : ""} ${a.disabled ? "disabled" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => run(a)}>
                  <div className="ic">{a.icon ?? <CornerDownLeft size={15} />}</div>
                  <div className="grow">
                    <div className="t">{a.title}</div>
                    {a.description && <div className="d">{a.description}</div>}
                  </div>
                  {i === active && <CornerDownLeft size={14} color="var(--subtle)" />}
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
