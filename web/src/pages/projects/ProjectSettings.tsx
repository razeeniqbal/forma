import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Trash2, Monitor, Server, Database } from "lucide-react";
import { useApp } from "@/store/app";
import { confirmAction } from "@/components/ui";
import { useServerHealth } from "@/components/server";
import { useProjectData } from "@/lib/project";
import type { ExecutionTarget } from "@/store/model";
import { ProjectNotFound } from "./common";

export function ProjectSettings() {
  const { projectId = "" } = useParams();
  const { project, sources, pipelines, runs } = useProjectData(projectId);
  const nav = useNavigate();
  const { updateProject, deleteProject, toast } = useApp.getState();
  const { configured, health } = useServerHealth();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  if (!project) return <ProjectNotFound />;
  const execution: ExecutionTarget = project.execution ?? "local";
  const dirty = name.trim() !== project.name || (description.trim() || undefined) !== project.description;

  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete “${project.name}”?`,
      body: `This deletes ${pipelines.length} pipeline(s), ${sources.length} source file(s) and ${runs.length} run record(s) stored in this browser. Exported Python projects are not affected.`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    await deleteProject(project.id);
    toast("success", `Deleted ${project.name}`);
    nav("/projects");
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Project settings</h1>
          <p>{project.name}</p>
        </div>
      </div>
      <form
        className="settings-block"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          updateProject(project.id, { name: name.trim(), description: description.trim() || undefined });
          toast("success", "Project updated");
        }}
      >
        <h3>Project</h3>
        <div className="field">
          <label htmlFor="ps-name">Name</label>
          <input id="ps-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ps-desc">Description</label>
          <textarea id="ps-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <button className="btn primary" type="submit" disabled={!dirty || !name.trim()}>
            Save
          </button>
        </div>
      </form>

      <section className="settings-block">
        <h3>Execution</h3>
        <p className="small muted">Where runs of this project's pipelines execute by default. You can still choose per run.</p>
        <div className="col" style={{ gap: 8 }} role="radiogroup" aria-label="Execution target">
          <label className={`option ${execution === "local" ? "on" : ""}`}>
            <input type="radio" checked={execution === "local"} onChange={() => updateProject(project.id, { execution: "local" })} />
            <Monitor size={18} />
            <div>
              <div className="t">Local</div>
              <div className="d">Runs in this browser.</div>
            </div>
          </label>
          <label className={`option ${execution === "server" ? "on" : ""} ${configured ? "" : "disabled"}`}>
            <input type="radio" disabled={!configured} checked={execution === "server"} onChange={() => updateProject(project.id, { execution: "server" })} />
            <Server size={18} />
            <div>
              <div className="t">FORMA Server</div>
              <div className="d">
                {configured
                  ? health
                    ? "Runs through the connected FORMA execution server."
                    : "A server is configured but not reachable right now — runs fall back to this browser."
                  : <>Connect one in <Link to="/settings">Settings</Link> to run large files, databases and schedules.</>}
              </div>
            </div>
          </label>
        </div>
      </section>

      <section className="settings-block">
        <h3>Connections</h3>
        <p className="small muted">Database connections are shared across projects and store only the name of the environment variable that holds the credentials.</p>
        <div>
          <Link className="btn" to="/destinations">
            <Database size={15} /> Destinations &amp; connections
          </Link>
        </div>
      </section>

      <section className="settings-block danger-zone">
        <h3>Delete project</h3>
        <p className="small muted">Removes the project with its sources, pipelines and run history from this browser.</p>
        <div>
          <button className="btn danger" onClick={remove}>
            <Trash2 size={15} /> Delete project
          </button>
        </div>
      </section>
    </div>
  );
}
