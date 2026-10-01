import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useApp } from "@/store/app";
import { addExampleContent, EXAMPLE_PROJECT } from "@/lib/samples";
import { projectPath } from "@/lib/project";

export function NewProjectPage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [example, setExample] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = useApp.getState().createProject({ name, description });
      if (example) await addExampleContent(project.id);
      nav(projectPath(project.id));
    } catch (err) {
      useApp.getState().toast("error", (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <div className="crumbs">
        <Link to="/projects" className="row">
          <ArrowLeft size={15} /> Projects
        </Link>
      </div>
      <form className="form-sheet" onSubmit={create}>
        <h1>Create project</h1>
        <p className="muted">A project holds the sources, pipelines and runs for one data problem.</p>
        <div className="field">
          <label htmlFor="proj-name">Project name</label>
          <input
            id="proj-name"
            className="input lg"
            autoFocus
            placeholder={EXAMPLE_PROJECT.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="proj-desc">
            Description <span className="subtle">(optional)</span>
          </label>
          <textarea id="proj-desc" className="input" rows={3} placeholder={EXAMPLE_PROJECT.description} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <label className={`option ${example ? "on" : ""}`}>
          <input type="checkbox" checked={example} onChange={(e) => setExample(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--blue)" }} />
          <div>
            <div className="t">Start from example</div>
            <div className="d">Adds the sample invoices workbook, a customers file and a ready “Clean Invoices” pipeline.</div>
          </div>
        </label>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <Link className="btn" to="/projects">
            Cancel
          </Link>
          <button className="btn primary" type="submit" disabled={!name.trim() || busy}>
            {busy && <Loader2 size={15} className="spin" />} Create Project
          </button>
        </div>
      </form>
    </div>
  );
}
