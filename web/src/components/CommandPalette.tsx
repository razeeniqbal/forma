import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Search, Workflow, Plus, Database, History, Settings, FolderInput, CornerDownLeft } from "lucide-react";
import { useApp } from "@/store/app";

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
    const base: PaletteAction[] = [
      { id: "nav-pipelines", group: "Navigate", title: "Pipelines", icon: <Workflow size={16} />, run: go("/pipelines") },
      { id: "nav-new", group: "Navigate", title: "New pipeline", icon: <Plus size={16} />, keywords: "create upload", run: go("/pipelines/new") },
      { id: "nav-sources", group: "Navigate", title: "Sources", icon: <FolderInput size={16} />, run: go("/sources") },
      { id: "nav-dest", group: "Navigate", title: "Destinations & connections", icon: <Database size={16} />, run: go("/destinations") },
      { id: "nav-runs", group: "Navigate", title: "Run history", icon: <History size={16} />, run: go("/runs") },
      { id: "nav-settings", group: "Navigate", title: "Settings", icon: <Settings size={16} />, run: go("/settings") },
    ];
    const pipes: PaletteAction[] = pipelines.map((p) => ({
      id: `pipe-${p.id}`,
      group: "Pipelines",
      title: p.spec.name,
      description: p.spec.source?.file ?? "No source",
      icon: <Workflow size={16} />,
      run: go(`/pipelines/${p.id}`),
    }));
    return [...Object.values(actions).flat(), ...base, ...pipes];
  }, [actions, pipelines, nav]);

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
