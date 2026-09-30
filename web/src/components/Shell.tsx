import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { Workflow, FolderInput, Database, History, Settings, LifeBuoy, Search } from "lucide-react";
import { useApp } from "@/store/app";
import { usePalette } from "./CommandPalette";
import { MOD } from "@/lib/format";

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
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/pipelines" className="brand" aria-label="FORMA home">
          <img src="/brand/forma-symbol-blue.svg" alt="" />
          FORMA
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
          <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive || (to === "/pipelines" && loc.pathname === "/") ? "active" : ""}`}>
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
        <div className="spacer" />
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <Settings size={17} />
          Settings
        </NavLink>
        <NavLink to="/help" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
          <LifeBuoy size={17} />
          Help &amp; Feedback
        </NavLink>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
