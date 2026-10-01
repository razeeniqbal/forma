import { useEffect, useState } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { Workflow, FolderInput, Database, History, Settings, LifeBuoy, Search, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useApp } from "@/store/app";
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

const NAV = [
  { to: "/pipelines", label: "Pipelines", icon: Workflow },
  { to: "/sources", label: "Sources", icon: FolderInput },
  { to: "/destinations", label: "Destinations", icon: Database },
  { to: "/runs", label: "Runs", icon: History },
];

export function Shell() {
  const user = useApp((s) => s.settings.userName);
  const openPalette = usePalette((s) => s.setOpen);
  const loc = useLocation();
  const initials = user.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "U";
  const { collapsed, toggle } = useSidebar();
  useHotkeys({ "mod+b": toggle }, [collapsed]);
  const tip = (label: string) => (collapsed ? label : undefined);
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <header className="topbar">
        <Link to="/pipelines" className="brand" aria-label="FORMA home">
          <img src="/brand/forma-symbol-blue.svg" alt="" />
          <span className="brand-name">FORMA</span>
        </Link>
        <span className="tagline">Shape messy data into reliable pipelines.</span>
        <button className="search-trigger" onClick={() => openPalette(true)}>
          <Search size={15} />
          Search pipelines, sources, transformations…
          <kbd>{MOD} K</kbd>
        </button>
        <div className="user-chip">
          <div className="avatar">{initials}</div>
          <span>{user}</span>
        </div>
      </header>
      <nav className="sidebar" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={tip(label)}
            aria-label={label}
            className={({ isActive }) => `nav-item ${isActive || (to === "/pipelines" && loc.pathname === "/") ? "active" : ""}`}
          >
            <Icon size={17} />
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
        <div className="spacer" />
        <NavLink to="/settings" title={tip("Settings")} aria-label="Settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <Settings size={17} />
          <span className="nav-label">Settings</span>
        </NavLink>
        <NavLink to="/help" title={tip("Help & Feedback")} aria-label="Help & Feedback" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <LifeBuoy size={17} />
          <span className="nav-label">Help &amp; Feedback</span>
        </NavLink>
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
