import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Workflow, FolderInput, History, Settings, BookOpen, Search, PanelLeftClose, PanelLeftOpen, ArrowLeft, LayoutDashboard, SlidersHorizontal, FolderKanban } from "lucide-react";
import { useApp, useProject } from "@/store/app";
import { projectPath, useCurrentProjectId } from "@/lib/project";
import { usePalette } from "./CommandPalette";
import { MOD } from "@/lib/format";
import { useHotkeys } from "@/lib/hooks";

const SIDEBAR_KEY = "forma.sidebar";
const NARROW = "(max-width: 1100px)";

function readSidebarPref(): "open" | "collapsed" | null {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    return v === "open" || v === "collapsed" ? v : null;
  } catch {
    return null;
  }
}

/** Sidebar collapsed to an icon rail: the viewer's choice (remembered in this browser), else collapsed on narrow windows. */
function useSidebar() {
  const [pref, setPref] = useState(readSidebarPref);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const collapsed = pref ? pref === "collapsed" : narrow;
  const toggle = () => {
    const next = collapsed ? "open" : "collapsed";
    setPref(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  return { collapsed, toggle };
}

interface NavEntry {
  to: string;
  label: string;
  icon: typeof Workflow;
  active: boolean;
}

export function Shell() {
  const user = useApp((s) => s.settings.userName);
  const openPalette = usePalette((s) => s.setOpen);
  const { pathname } = useLocation();
  const initials = user.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "U";
  const { collapsed, toggle } = useSidebar();
  useHotkeys({ "mod+b": toggle }, [collapsed]);
  const tip = (label: string) => (collapsed ? label : undefined);
  const projectId = useCurrentProjectId();
  const project = useProject(projectId);

  const base = project ? projectPath(project.id) : "";
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  const nav: NavEntry[] = project
    ? [
        { to: base, label: "Overview", icon: LayoutDashboard, active: pathname === base },
        { to: `${base}/sources`, label: "Sources", icon: FolderInput, active: under(`${base}/sources`) },
        { to: `${base}/pipelines`, label: "Pipelines", icon: Workflow, active: under(`${base}/pipelines`) || under("/pipelines") },
        { to: `${base}/runs`, label: "Runs", icon: History, active: under(`${base}/runs`) || under("/runs") },
        { to: `${base}/settings`, label: "Project Settings", icon: SlidersHorizontal, active: under(`${base}/settings`) },
      ]
    : [{ to: "/projects", label: "Projects", icon: FolderKanban, active: under("/projects") || pathname === "/" }];

  const item = ({ to, label, icon: Icon, active }: NavEntry) => (
    <Link key={to} to={to} title={tip(label)} aria-label={label} aria-current={active ? "page" : undefined} className={`nav-item ${active ? "active" : ""}`}>
      <Icon size={17} />
      <span className="nav-label">{label}</span>
    </Link>
  );

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <header className="topbar">
        <Link to="/projects" className="brand" aria-label="FORMA home">
          <img src="/brand/forma-symbol-blue.svg" alt="" />
          <span className="brand-name">FORMA</span>
        </Link>
        <span className="tagline">Shape messy data into reliable pipelines.</span>
        <button className="search-trigger" onClick={() => openPalette(true)}>
          <Search size={15} />
          Search projects, pipelines, sources…
          <kbd>{MOD} K</kbd>
        </button>
        <div className="user-chip">
          <div className="avatar">{initials}</div>
          <span>{user}</span>
        </div>
      </header>
      <nav className="sidebar" aria-label="Main">
        {project && (
          <>
            <Link to="/projects" className="nav-item nav-back" title={tip("All projects")} aria-label="All projects">
              <ArrowLeft size={16} />
              <span className="nav-label">Projects</span>
            </Link>
            <div className="nav-project" title={project.name}>
              <span className="nav-project-mark" aria-hidden>
                {project.name.trim().charAt(0).toUpperCase() || "P"}
              </span>
              <span className="nav-label nav-project-name">{project.name}</span>
            </div>
          </>
        )}
        {nav.map(item)}
        <div className="spacer" />
        {item({ to: "/settings", label: "Settings", icon: Settings, active: under("/settings") || under("/destinations") })}
        {item({ to: "/docs", label: "Docs", icon: BookOpen, active: under("/docs") })}
        <button
          className="nav-item nav-toggle"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} sidebar (${MOD}+B)`}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span className="nav-label">Collapse</span>
        </button>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
