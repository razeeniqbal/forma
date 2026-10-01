import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Workflow, MoreHorizontal, Copy, Trash2, Code2, Search, FolderInput } from "lucide-react";
import { useApp } from "@/store/app";
import { confirmAction, Empty, FileIcon, StatusBadge, useMenu } from "@/components/ui";
import { fmtAgo, fmtInt } from "@/lib/format";
import { projectPath, useProjectData } from "@/lib/project";
import { ProjectNotFound } from "./common";

export function ProjectPipelines() {
  const { projectId = "" } = useParams();
  const { project, sources, pipelines, runs } = useProjectData(projectId);
  const { duplicatePipeline, deletePipeline, toast } = useApp.getState();
  const nav = useNavigate();
  const menu = useMenu();
  const [q, setQ] = useState("");
  if (!project) return <ProjectNotFound />;
  const list = pipelines.filter((p) => p.spec.name.toLowerCase().includes(q.toLowerCase()));
  const newHref = projectPath(projectId, "pipelines/new");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pipelines</h1>
          <p>How this project's data moves and changes. Every pipeline stays readable Python.</p>
        </div>
        {sources.length > 0 && (
          <div className="actions">
            <Link className="btn primary" to={newHref}>
              <Plus size={16} /> New pipeline
            </Link>
          </div>
        )}
      </div>

      {pipelines.length === 0 ? (
        <div className="card">
          {sources.length === 0 ? (
            <Empty icon={<FolderInput size={22} />} title="Add a data source" action={<Link className="btn primary" to={projectPath(projectId, "sources")}>Go to Sources</Link>}>
              Pipelines are built on project sources. Add a file, database or API first.
            </Empty>
          ) : (
            <Empty icon={<Workflow size={22} />} title="Your data is ready" action={<Link className="btn primary" to={newHref}><Plus size={15} /> Create pipeline</Link>}>
              Create a pipeline to start shaping it.
            </Empty>
          )}
        </div>
      ) : (
        <div className="index">
          <div className="index-tools">
            <div className="row grow" style={{ maxWidth: 320 }}>
              <Search size={15} color="var(--subtle)" />
              <input className="input sm" placeholder="Filter pipelines" aria-label="Filter pipelines" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="muted small" style={{ marginLeft: "auto" }}>
              {list.length} pipeline{list.length === 1 ? "" : "s"}
            </span>
          </div>
          <table className="table index-table">
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Steps</th>
                <th>Last run</th>
                <th style={{ textAlign: "right" }}>Review</th>
                <th>Updated</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const last = runs.find((r) => r.pipelineId === p.id);
                const src = p.spec.source;
                return (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/pipelines/${p.id}`)}>
                    <td>
                      <div className="row">
                        <Workflow size={16} color="var(--blue)" />
                        <Link to={`/pipelines/${p.id}`} className="index-name" onClick={(e) => e.stopPropagation()}>
                          {p.spec.name}
                        </Link>
                        {p.dirty ? <span className="badge sm">Draft</span> : <span className="badge outline sm">v{p.version}</span>}
                      </div>
                    </td>
                    <td>
                      {src ? (
                        <span className="row small">
                          <FileIcon kind={src.type} />
                          {src.file}
                          {src.sheet && <span className="subtle">/ {src.sheet}</span>}
                        </span>
                      ) : (
                        <span className="subtle small">No source</span>
                      )}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {p.spec.steps.length + 2}
                    </td>
                    <td>{last ? <StatusBadge status={last.status} short /> : <span className="subtle small">Never run</span>}</td>
                    <td className="num" style={{ textAlign: "right", color: last?.reviewCount ? "var(--amber-text)" : undefined }}>
                      {last ? fmtInt(last.reviewCount) : "—"}
                    </td>
                    <td className="muted small">{fmtAgo(p.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn ghost sm icon"
                        aria-label={`More actions for ${p.spec.name}`}
                        onClick={(e) =>
                          menu.open(e.currentTarget.getBoundingClientRect(), [
                            { label: "Open", icon: <Workflow size={15} />, onClick: () => nav(`/pipelines/${p.id}`) },
                            { label: "Export Python", icon: <Code2 size={15} />, onClick: () => nav(`/pipelines/${p.id}/export`) },
                            { label: "Duplicate", icon: <Copy size={15} />, onClick: () => duplicatePipeline(p.id) },
                            { separator: true, label: "" },
                            {
                              label: "Delete",
                              icon: <Trash2 size={15} />,
                              danger: true,
                              onClick: async () => {
                                if (await confirmAction({ title: "Delete pipeline?", body: `"${p.spec.name}" and its versions will be deleted. Run history and project sources are kept.`, confirmLabel: "Delete", danger: true })) {
                                  deletePipeline(p.id);
                                  toast("success", "Pipeline deleted");
                                }
                              },
                            },
                          ])
                        }
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {menu.node}
    </div>
  );
}
