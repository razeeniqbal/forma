import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Eye, Download, Trash2, Sheet, Workflow, FolderInput, Database, Network, FileUp, ChevronDown, Combine, Layers } from "lucide-react";
import { useApp } from "@/store/app";
import { getRawFile } from "@/store/db";
import { confirmAction, FileIcon, useMenu } from "@/components/ui";
import { AddSourceOptions, useAddSource } from "@/components/AddSource";
import { SourcePreviewModal } from "@/components/SourcePreviewModal";
import { download, fmtAgo, fmtBytes, fmtDateTime, fmtInt } from "@/lib/format";
import { pipelinesUsing, projectPath, useProjectData } from "@/lib/project";
import type { Pipeline, SourceMeta } from "@/store/model";
import { ProjectNotFound } from "./common";

const KIND_LABEL: Record<string, string> = {
  excel: "Excel workbook",
  csv: "CSV",
  json: "JSON",
  jsonl: "JSON Lines",
  text: "Text",
  database: "Database query",
  api: "API / URL",
};

export function ProjectSources() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { project, sources, pipelines } = useProjectData(projectId);
  const nav = useNavigate();
  const menu = useMenu();
  const [preview, setPreview] = useState<{ meta: SourceMeta; sheet?: string } | null>(null);
  const select = (id: string, sheet?: string) => setParams(sheet ? { source: id, sheet } : { source: id }, { replace: true });
  const add = useAddSource(projectId, (metas) => metas[0] && select(metas[0].id));
  const [adding, setAdding] = useState(false);

  if (!project) return <ProjectNotFound />;
  const current = sources.find((s) => s.id === params.get("source")) ?? sources[0];
  const sheetParam = params.get("sheet") ?? undefined;

  const addMenu = (r: DOMRect) =>
    menu.open(r, [
      { label: "Upload file…", icon: <FileUp size={15} />, onClick: add.browse },
      { label: "Database query…", icon: <Database size={15} />, onClick: () => (add.serverReady ? add.openServer("database") : nav("/settings")), hint: add.serverReady ? undefined : "needs server" },
      { label: "API / Google Sheets…", icon: <Network size={15} />, onClick: () => (add.serverReady ? add.openServer("api") : nav("/settings")), hint: add.serverReady ? undefined : "needs server" },
    ]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sources</h1>
          <p>The data this project works with. Stored once, immutable, shared by every pipeline that reads it.</p>
        </div>
        {sources.length > 0 && (
          <div className="actions">
            <button className="btn primary" onClick={(e) => addMenu(e.currentTarget.getBoundingClientRect())}>
              <Plus size={16} /> Add source <ChevronDown size={14} />
            </button>
          </div>
        )}
      </div>

      {sources.length === 0 ? (
        <section className="start">
          <h2>Add a data source</h2>
          <p className="muted">Files, databases and APIs. A workbook's sheets each become a source you can build pipelines on.</p>
          <AddSourceOptions add={add} />
        </section>
      ) : (
        <div className="master-detail">
          <div className="md-list" role="listbox" aria-label="Project sources">
            {sources.map((s) => {
              const multi = s.sheets.length > 1;
              const on = current?.id === s.id;
              return (
                <div key={s.id} className="src-group">
                  <button role="option" aria-selected={on && !sheetParam} className={`src-row ${on && !sheetParam ? "on" : ""}`} onClick={() => select(s.id)}>
                    <FileIcon kind={s.kind} />
                    <span className="grow">
                      <span className="t">{s.name}</span>
                      <span className="d">
                        {KIND_LABEL[s.kind] ?? s.kind} · {multi ? `${s.sheets.length} sheets` : `${fmtInt(s.sheets[0]?.rows ?? 0)} rows`}
                      </span>
                    </span>
                    {pipelinesUsing(s.id, pipelines).length > 0 && (
                      <span className="small subtle" title="Pipelines reading this source">
                        {pipelinesUsing(s.id, pipelines).length} pipeline{pipelinesUsing(s.id, pipelines).length === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>
                  {multi &&
                    s.sheets.map((sh) => (
                      <button
                        key={sh.name}
                        role="option"
                        aria-selected={on && sheetParam === sh.name}
                        className={`src-row sheet ${on && sheetParam === sh.name ? "on" : ""}`}
                        onClick={() => select(s.id, sh.name)}
                      >
                        <Sheet size={14} color={sh.rows ? "var(--green-text)" : "var(--subtle)"} />
                        <span className="grow t">{sh.name}</span>
                        <span className="small subtle num">{sh.rows ? fmtInt(sh.rows) : "empty"}</span>
                      </button>
                    ))}
                </div>
              );
            })}
            <button className="src-row add" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <Plus size={15} /> <span className="t">Add source</span>
            </button>
            {adding && (
              <div style={{ padding: 8 }}>
                <AddSourceOptions add={add} compact />
              </div>
            )}
          </div>
          {current && (
            <SourceDetail
              key={current.id + (sheetParam ?? "")}
              meta={current}
              sheet={sheetParam && current.sheets.some((x) => x.name === sheetParam) ? sheetParam : undefined}
              projectId={projectId}
              onPreview={(sheet) => setPreview({ meta: current, sheet })}
            />
          )}
        </div>
      )}
      {preview && <SourcePreviewModal meta={preview.meta} initialSheet={preview.sheet} onClose={() => setPreview(null)} />}
      {add.node}
      {menu.node}
    </div>
  );
}

/** Sheets of a workbook a pipeline reads (main source and join / lookup / append steps). */
function sheetsReadBy(p: Pipeline, meta: SourceMeta): string[] {
  const first = meta.sheets[0]?.name;
  const out: string[] = [];
  if (p.spec.source?.fileId === meta.id) out.push(p.spec.source.sheet ?? first);
  for (const st of p.spec.steps) if ((st.type === "join" || st.type === "append") && st.source.fileId === meta.id) out.push(st.source.sheet ?? first);
  return out;
}

function SourceDetail({ meta, sheet, projectId, onPreview }: { meta: SourceMeta; sheet?: string; projectId: string; onPreview: (sheet?: string) => void }) {
  const { pipelines } = useProjectData(projectId);
  const nav = useNavigate();
  const menu = useMenu();
  const { deleteSource, toast } = useApp.getState();
  const using = pipelinesUsing(meta.id, pipelines);
  const multi = meta.sheets.length > 1;
  const sh = sheet ? meta.sheets.find((x) => x.name === sheet) : multi ? undefined : meta.sheets[0];
  const createHref = `${projectPath(projectId, "pipelines/new")}?source=${meta.id}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`;

  const useIn = (r: DOMRect) =>
    menu.open(
      r,
      pipelines.length
        ? pipelines.flatMap((p) => [
            { label: `Lookup into ${p.spec.name}`, icon: <Combine size={15} />, onClick: () => nav(`/pipelines/${p.id}?use=${meta.id}&as=lookup${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`) },
            { label: `Append to ${p.spec.name}`, icon: <Layers size={15} />, onClick: () => nav(`/pipelines/${p.id}?use=${meta.id}&as=append${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`) },
          ])
        : [{ label: "No pipelines yet — create one first", disabled: true, onClick: () => undefined }],
    );

  const perSheet = async () => {
    const app = useApp.getState();
    const sheets = meta.sheets.filter((x) => x.rows > 0);
    const base = meta.name.replace(/\.[^.]+$/, "");
    for (const x of sheets) await app.createPipeline(projectId, `${base} – ${x.name}`, meta, undefined, null, x.name);
    toast("success", `Created ${sheets.length} pipelines — one per sheet of ${meta.name}`);
    nav(projectPath(projectId, "pipelines"));
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: "Delete source?",
      body: using.length
        ? `${using.length} pipeline(s) read this source (${using.map((p) => p.spec.name).join(", ")}) and will need another source before they can run.`
        : "The stored file is removed from this browser.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await deleteSource(meta.id);
  };

  return (
    <div className="md-detail" aria-label="Source detail">
      <div className="md-head">
        <FileIcon kind={meta.kind} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="clamp-1">
            {meta.name}
            {sh && multi && <span className="muted"> / {sh.name}</span>}
          </h2>
          <div className="small muted">
            {KIND_LABEL[meta.kind] ?? meta.kind} · {fmtBytes(meta.size)} · added {fmtAgo(meta.addedAt)}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => onPreview(sheet)}>
          <Eye size={15} /> Preview
        </button>
        <Link className="btn primary" to={createHref} aria-disabled={!!sh && !sh.rows}>
          <Plus size={15} /> Create pipeline
        </Link>
        <button className="btn" onClick={(e) => useIn(e.currentTarget.getBoundingClientRect())}>
          <Workflow size={15} /> Use in pipeline <ChevronDown size={14} />
        </button>
        <button
          className="btn ghost icon"
          aria-label="Download original"
          title="Download original"
          onClick={async () => {
            const raw = await getRawFile(meta.id);
            if (raw) download(meta.name, raw, raw.type);
            else toast("warning", "The original bytes are not stored for this source.");
          }}
        >
          <Download size={15} />
        </button>
        <button className="btn ghost icon" aria-label="Delete source" title="Delete source" onClick={remove}>
          <Trash2 size={15} />
        </button>
      </div>

      <dl className="kv md-kv">
        <dt>Type</dt>
        <dd>{KIND_LABEL[meta.kind] ?? meta.kind}</dd>
        {sh ? (
          <>
            <dt>Rows</dt>
            <dd className="num">{fmtInt(sh.rows)}</dd>
            <dt>Columns</dt>
            <dd className="num">{sh.cols}</dd>
          </>
        ) : (
          <>
            <dt>Sheets</dt>
            <dd>{meta.sheets.length}</dd>
          </>
        )}
        <dt>Added</dt>
        <dd>{fmtDateTime(meta.addedAt)}</dd>
        {meta.kind === "database" && (
          <>
            <dt>Read</dt>
            <dd>Live at run time on the FORMA server; this is a snapshot for building.</dd>
          </>
        )}
      </dl>

      {multi && (
        <div className="section">
          <div className="section-head">
            <h3>Sheets</h3>
            <span className="small subtle">Each sheet is its own source</span>
            <button className="btn ghost xs" onClick={perSheet} disabled={meta.sheets.filter((x) => x.rows > 0).length < 2}>
              <Plus size={13} /> One pipeline per sheet
            </button>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Sheet</th>
                <th style={{ textAlign: "right" }}>Rows</th>
                <th style={{ textAlign: "right" }}>Columns</th>
                <th>Used by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {meta.sheets.map((x) => {
                const by = using.filter((p) => sheetsReadBy(p, meta).includes(x.name));
                return (
                  <tr key={x.name} className={x.name === sheet ? "selected" : ""}>
                    <td>
                      <span className="row">
                        <Sheet size={14} color={x.rows ? "var(--green-text)" : "var(--subtle)"} /> {x.name}
                      </span>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {x.rows ? fmtInt(x.rows) : <span className="subtle">empty</span>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {x.cols}
                    </td>
                    <td className="small">{by.length ? by.map((p) => p.spec.name).join(", ") : <span className="subtle">—</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn ghost xs" onClick={() => onPreview(x.name)}>
                        <Eye size={13} /> Preview
                      </button>
                      <Link
                        className="btn ghost xs"
                        aria-label={`Create pipeline from ${x.name}`}
                        aria-disabled={!x.rows}
                        to={`${projectPath(projectId, "pipelines/new")}?source=${meta.id}&sheet=${encodeURIComponent(x.name)}`}
                      >
                        <Plus size={13} /> Pipeline
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h3>Pipelines using this source</h3>
        </div>
        {using.length ? (
          <ul className="plain-list">
            {using.map((p) => (
              <li key={p.id}>
                <Workflow size={14} color="var(--blue)" />
                <Link to={`/pipelines/${p.id}`}>{p.spec.name}</Link>
                <span className="small subtle">
                  {p.spec.source?.fileId === meta.id ? `main source${p.spec.source.sheet && multi ? ` · ${p.spec.source.sheet}` : ""}` : "lookup / append"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="small subtle">
            <FolderInput size={14} style={{ verticalAlign: -2 }} /> Not used yet.{" "}
            <Link to={createHref}>Create a pipeline</Link> from it.
          </div>
        )}
      </div>
      {menu.node}
    </div>
  );
}
