import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Sheet } from "lucide-react";
import { useApp } from "@/store/app";
import { FileIcon } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { projectPath, useProjectData } from "@/lib/project";
import type { SourceMeta } from "@/store/model";
import { ProjectNotFound } from "./common";

const titleCase = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Suggested pipeline name for a source / sheet: "Clean Invoices". */
export function suggestName(meta: SourceMeta | undefined, sheet?: string): string {
  if (!meta) return "";
  return `Clean ${titleCase(sheet && meta.sheets.length > 1 ? sheet : meta.name)}`;
}

/** Create a pipeline on a project source. Project, source and sheet are already known — nothing is re-uploaded. */
export function CreatePipelinePage() {
  const { projectId = "" } = useParams();
  const [params] = useSearchParams();
  const { project, sources } = useProjectData(projectId);
  const nav = useNavigate();
  const initial = sources.find((s) => s.id === params.get("source")) ?? sources[0];
  const [sourceId, setSourceId] = useState(initial?.id ?? "");
  const meta = sources.find((s) => s.id === sourceId);
  const firstUsable = (m?: SourceMeta) => (m?.sheets.find((x) => x.rows > 0) ?? m?.sheets[0])?.name;
  const [sheet, setSheet] = useState<string | undefined>(
    initial && initial.sheets.some((x) => x.name === params.get("sheet")) ? params.get("sheet")! : firstUsable(initial),
  );
  const [name, setName] = useState(suggestName(initial, sheet));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!project) return <ProjectNotFound />;
  if (!sources.length)
    return (
      <div className="page narrow">
        <div className="form-sheet">
          <h1>Create pipeline</h1>
          <p className="muted">Pipelines are built on project sources. Add one first.</p>
          <Link className="btn primary" to={projectPath(projectId, "sources")} style={{ alignSelf: "flex-start" }}>
            Add a data source
          </Link>
        </div>
      </div>
    );

  const pick = (m: SourceMeta, sh?: string) => {
    setSourceId(m.id);
    setSheet(sh);
    if (!touched) setName(suggestName(m, sh));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta || !name.trim()) return;
    setBusy(true);
    const p = await useApp.getState().createPipeline(projectId, name.trim(), meta, undefined, null, meta.sheets.length > 1 ? sheet : undefined);
    nav(`/pipelines/${p.id}`);
  };

  return (
    <div className="page narrow">
      <div className="crumbs">
        <Link to={projectPath(projectId, "pipelines")} className="row">
          <ArrowLeft size={15} /> Pipelines
        </Link>
      </div>
      <form className="form-sheet" onSubmit={create}>
        <h1>Create pipeline</h1>
        <dl className="kv">
          <dt>Project</dt>
          <dd>{project.name}</dd>
        </dl>
        <div className="field">
          <label id="src-label">Source</label>
          <div className="src-pick" role="radiogroup" aria-labelledby="src-label">
            {sources.map((s) =>
              s.sheets.length > 1 ? (
                <div key={s.id} className="src-pick-group">
                  <div className="src-pick-file">
                    <FileIcon kind={s.kind} /> {s.name}
                  </div>
                  {s.sheets.map((x) => (
                    <button
                      type="button"
                      key={x.name}
                      role="radio"
                      aria-checked={sourceId === s.id && sheet === x.name}
                      disabled={!x.rows}
                      className={`src-pick-row sheet ${sourceId === s.id && sheet === x.name ? "on" : ""}`}
                      onClick={() => pick(s, x.name)}
                    >
                      <Sheet size={14} color={x.rows ? "var(--green-text)" : "var(--subtle)"} />
                      <span className="grow">
                        {s.name} / {x.name}
                      </span>
                      <span className="small subtle num">{x.rows ? `${fmtInt(x.rows)} rows · ${x.cols} cols` : "empty"}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  key={s.id}
                  role="radio"
                  aria-checked={sourceId === s.id}
                  className={`src-pick-row ${sourceId === s.id ? "on" : ""}`}
                  onClick={() => pick(s)}
                >
                  <FileIcon kind={s.kind} />
                  <span className="grow">{s.name}</span>
                  <span className="small subtle num">
                    {fmtInt(s.sheets[0]?.rows ?? 0)} rows · {s.sheets[0]?.cols ?? 0} cols
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="pipe-name">Pipeline name</label>
          <input
            id="pipe-name"
            className="input lg"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
            }}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <Link className="btn" to={projectPath(projectId, "pipelines")}>
            Cancel
          </Link>
          <button className="btn primary" type="submit" disabled={!meta || !name.trim() || busy}>
            {busy && <Loader2 size={15} className="spin" />} Create Pipeline
          </button>
        </div>
      </form>
    </div>
  );
}
