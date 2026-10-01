import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Workflow, FolderInput, Play, AlertTriangle, CheckCircle2, XCircle, Upload, PencilLine } from "lucide-react";
import { useProjectData, projectPath } from "@/lib/project";
import { AddSourceOptions, useAddSource } from "@/components/AddSource";
import { fmtAgo, fmtInt, fmtTime } from "@/lib/format";
import { ProjectMap } from "./ProjectMap";
import { ProjectNotFound } from "./common";

interface Activity {
  t: number;
  icon: JSX.Element;
  what: string;
  detail: string;
  to?: string;
  tone?: "green" | "amber" | "red";
}

export function ProjectOverview() {
  const { projectId = "" } = useParams();
  const data = useProjectData(projectId);
  const nav = useNavigate();
  const add = useAddSource(projectId, (metas) => nav(`${projectPath(projectId, "sources")}?source=${metas[0]?.id ?? ""}`));
  const { project, sources, pipelines, runs } = data;

  const activity = useMemo<Activity[]>(() => {
    const a: Activity[] = [
      ...runs.slice(0, 12).map<Activity>((r) => ({
        t: r.finishedAt ?? r.startedAt,
        icon: r.status === "failed" ? <XCircle size={14} /> : r.status === "review" ? <AlertTriangle size={14} /> : r.status === "running" ? <Play size={14} /> : <CheckCircle2 size={14} />,
        what: r.pipelineName,
        detail:
          r.status === "failed" ? "Failed" : r.status === "running" ? "Running" : r.status === "review" ? `${fmtInt(r.reviewCount)} review` : r.status === "cancelled" ? "Cancelled" : `Success · ${fmtInt(r.rowsOut)} rows`,
        to: `/runs/${r.id}`,
        tone: r.status === "failed" ? "red" : r.status === "review" ? "amber" : r.status === "success" ? "green" : undefined,
      })),
      ...sources.map<Activity>((s) => ({ t: s.addedAt, icon: <Upload size={14} />, what: s.name, detail: "Added", to: `${projectPath(projectId, "sources")}?source=${s.id}` })),
      ...pipelines
        .filter((p) => p.updatedAt > p.createdAt + 1000)
        .map<Activity>((p) => ({ t: p.updatedAt, icon: <PencilLine size={14} />, what: p.spec.name, detail: p.dirty ? "Edited (draft)" : `Saved v${p.version}`, to: `/pipelines/${p.id}` })),
      ...pipelines.map<Activity>((p) => ({ t: p.createdAt, icon: <Workflow size={14} />, what: p.spec.name, detail: "Created", to: `/pipelines/${p.id}` })),
    ];
    return a.sort((x, y) => y.t - x.t).slice(0, 8);
  }, [runs, sources, pipelines, projectId]);

  if (!project) return <ProjectNotFound />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          {project.description ? <p>{project.description}</p> : <p className="subtle">Project overview</p>}
        </div>
        {sources.length > 0 && (
          <div className="actions">
            <Link className="btn" to={projectPath(projectId, "sources")}>
              <FolderInput size={15} /> Sources
            </Link>
            <Link className="btn primary" to={projectPath(projectId, "pipelines/new")}>
              <Plus size={16} /> New pipeline
            </Link>
          </div>
        )}
      </div>

      {sources.length === 0 ? (
        <section className="start" aria-label="Start with your data">
          <div className="steps-line" aria-hidden>
            <span className="on">Project</span>
            <span className="on">Add data</span>
            <span>Create pipeline</span>
          </div>
          <h2>Start with your data</h2>
          <p className="muted">Connect the data this project will work with. Files stay in your browser; originals are never modified.</p>
          <AddSourceOptions add={add} />
        </section>
      ) : (
        <>
          {pipelines.length === 0 && (
            <div className="ready-callout">
              <div>
                <b>Your data is ready.</b> Create a pipeline to start shaping it.
              </div>
              <Link className="btn primary sm" to={`${projectPath(projectId, "pipelines/new")}?source=${sources[0].id}`}>
                <Plus size={14} /> Create pipeline
              </Link>
            </div>
          )}
          <section className="section" aria-label="Project map">
            <div className="section-head">
              <h3>Data map</h3>
              <span className="small subtle">How data moves through this project · hover to trace</span>
            </div>
            <ProjectMap sources={sources} pipelines={pipelines} runs={runs} />
          </section>
          <section className="section" aria-label="Recent activity">
            <div className="section-head">
              <h3>Recent activity</h3>
              <Link to={projectPath(projectId, "runs")} className="small">
                All runs
              </Link>
            </div>
            {activity.length === 0 ? (
              <div className="subtle small" style={{ padding: "10px 0" }}>
                Nothing yet.
              </div>
            ) : (
              <ul className="activity">
                {activity.map((a, i) => (
                  <li key={i} className={a.tone ?? ""}>
                    <span className="when" title={new Date(a.t).toLocaleString()}>
                      {Date.now() - a.t < 864e5 ? fmtTime(a.t).slice(0, 5) : fmtAgo(a.t)}
                    </span>
                    <span className="ic">{a.icon}</span>
                    {a.to ? <Link to={a.to}>{a.what}</Link> : <span>{a.what}</span>}
                    <span className="what">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {add.node}
    </div>
  );
}
