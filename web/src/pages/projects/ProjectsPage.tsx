import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, FolderKanban, FlaskConical, Loader2 } from "lucide-react";
import { useApp } from "@/store/app";
import { StatusBadge } from "@/components/ui";
import { fmtAgo } from "@/lib/format";
import { lastActivity, projectPath, type ProjectData } from "@/lib/project";
import { createExampleProject } from "@/lib/samples";

type Sort = "recent" | "name" | "created";

/** FORMA home: the index of projects. */
export function ProjectsPage() {
  const projects = useApp((s) => s.projects);
  const sources = useApp((s) => s.sources);
  const pipelines = useApp((s) => s.pipelines);
  const runs = useApp((s) => s.runs);
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const list = projects.map((project) => {
      const d: ProjectData = {
        project,
        sources: sources.filter((s) => s.projectId === project.id),
        pipelines: pipelines.filter((p) => p.projectId === project.id),
        runs: runs.filter((r) => r.projectId === project.id),
      };
      return { ...d, project, activity: lastActivity(d), lastRun: d.runs[0] };
    });
    const needle = q.trim().toLowerCase();
    const filtered = needle ? list.filter((r) => `${r.project.name} ${r.project.description ?? ""}`.toLowerCase().includes(needle)) : list;
    return filtered.sort((a, b) =>
      sort === "name" ? a.project.name.localeCompare(b.project.name) : sort === "created" ? b.project.createdAt - a.project.createdAt : b.activity - a.activity,
    );
  }, [projects, sources, pipelines, runs, q, sort]);

  const openExample = async () => {
    setBusy(true);
    try {
      const { projectId } = await createExampleProject();
      nav(projectPath(projectId));
    } catch (e) {
      useApp.getState().toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!projects.length)
    return (
      <div className="page narrow">
        <div className="first-run">
          <img src="/brand/forma-symbol-blue.svg" width={36} height={36} alt="" />
          <h1>Create your first project</h1>
          <p>
            A project holds the data for one problem — its sources, the pipelines that shape them, and every run. Your pipelines stay readable Python you
            own.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link className="btn primary lg" to="/projects/new">
              <Plus size={16} /> New project
            </Link>
            <button className="btn lg" onClick={openExample} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />} Explore the example project
            </button>
          </div>
          <ol className="flow-hint" aria-label="How FORMA works">
            <li>Project</li>
            <li>Sources</li>
            <li>Pipelines</li>
            <li>Steps</li>
            <li>Runs</li>
          </ol>
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Shape messy data into reliable pipelines.</p>
        </div>
        <div className="actions">
          <Link className="btn primary" to="/projects/new">
            <Plus size={16} /> New project
          </Link>
        </div>
      </div>
      <div className="index">
        <div className="index-tools">
          <div className="row grow" style={{ maxWidth: 320 }}>
            <Search size={15} color="var(--subtle)" />
            <input className="input sm" placeholder="Search projects" aria-label="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="row small muted" style={{ marginLeft: "auto" }}>
            Sort
            <select className="select sm" style={{ width: 150 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort projects">
              <option value="recent">Recent activity</option>
              <option value="name">Name</option>
              <option value="created">Newest</option>
            </select>
          </label>
        </div>
        <table className="table index-table">
          <thead>
            <tr>
              <th>Project</th>
              <th style={{ textAlign: "right", width: 90 }}>Sources</th>
              <th style={{ textAlign: "right", width: 90 }}>Pipelines</th>
              <th style={{ width: 170 }}>Last run</th>
              <th style={{ width: 130 }}>Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.project.id} className="clickable" onClick={() => nav(projectPath(r.project.id))}>
                <td>
                  <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                    <span className="nav-project-mark" aria-hidden style={{ marginTop: 1 }}>
                      {r.project.name.charAt(0).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <Link to={projectPath(r.project.id)} className="index-name" onClick={(e) => e.stopPropagation()}>
                        {r.project.name}
                      </Link>
                      {r.project.description && <div className="small muted clamp-1">{r.project.description}</div>}
                    </div>
                  </div>
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {r.sources.length}
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {r.pipelines.length}
                </td>
                <td>{r.lastRun ? <StatusBadge status={r.lastRun.status} short /> : <span className="subtle small">No runs yet</span>}</td>
                <td className="muted small">{fmtAgo(r.activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty" style={{ padding: 28 }}>
            <FolderKanban size={20} />
            No project matches “{q}”.
          </div>
        )}
      </div>
    </div>
  );
}
