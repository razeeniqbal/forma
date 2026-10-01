import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Workflow, Sparkles, MoreHorizontal, Copy, Trash2, Play, Code2, Search } from "lucide-react";
import { useApp } from "@/store/app";
import { createInvoiceDemo } from "@/lib/samples";
import { confirmAction, Empty, FileIcon, StatusBadge, useMenu } from "@/components/ui";
import { fmtAgo } from "@/lib/format";

export function PipelinesPage() {
  const pipelines = useApp((s) => s.pipelines);
  const runs = useApp((s) => s.runs);
  const { duplicatePipeline, deletePipeline, toast } = useApp.getState();
  const nav = useNavigate();
  const menu = useMenu();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const openDemo = async () => {
    setBusy(true);
    try {
      nav(`/pipelines/${await createInvoiceDemo()}`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = pipelines.filter((p) => p.spec.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pipelines</h1>
          <p>See the data. Shape it visually. Verify every change. Keep the code.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={openDemo} disabled={busy}>
            <Sparkles size={15} /> Invoice demo
          </button>
          <Link className="btn primary" to="/pipelines/new">
            <Plus size={16} /> New pipeline
          </Link>
        </div>
      </div>

      {pipelines.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Workflow size={24} />}
            title="Build your first pipeline"
            action={
              <div className="row" style={{ marginTop: 6 }}>
                <Link className="btn primary" to="/pipelines/new">
                  <Plus size={16} /> New pipeline
                </Link>
                <button className="btn" onClick={openDemo} disabled={busy}>
                  <Sparkles size={15} /> Open the Invoice Processing demo
                </button>
              </div>
            }
          >
            Upload a messy CSV or Excel file, shape it with previewed transformations, validate it, and export readable Python.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <div className="row grow" style={{ maxWidth: 320 }}>
              <Search size={15} color="var(--subtle)" />
              <input className="input sm" placeholder="Filter pipelines" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="muted small" style={{ marginLeft: "auto" }}>
              {list.length} pipeline{list.length === 1 ? "" : "s"}
            </span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Source</th>
                <th>Steps</th>
                <th>Last run</th>
                <th>Updated</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const last = runs.find((r) => r.pipelineId === p.id);
                return (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/pipelines/${p.id}`)}>
                    <td>
                      <div className="row">
                        <Workflow size={16} color="var(--blue)" />
                        <b style={{ color: "var(--ink)" }}>{p.spec.name}</b>
                      </div>
                    </td>
                    <td>
                      {p.version ? <span className="badge outline">v{p.version}</span> : null} {p.dirty && <span className="badge">Draft</span>}
                    </td>
                    <td>
                      {p.spec.source ? (
                        <div className="row">
                          <FileIcon kind={p.spec.source.type} />
                          <span>{p.spec.source.file}</span>
                        </div>
                      ) : (
                        <span className="subtle">No source</span>
                      )}
                    </td>
                    <td className="num">{p.spec.steps.length}</td>
                    <td>{last ? <StatusBadge status={last.status} short /> : <span className="subtle">Never run</span>}</td>
                    <td className="muted">{fmtAgo(p.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn ghost sm icon"
                        aria-label="More"
                        onClick={(e) =>
                          menu.open(e.currentTarget.getBoundingClientRect(), [
                            { label: "Open workspace", icon: <Workflow size={15} />, onClick: () => nav(`/pipelines/${p.id}`) },
                            { label: "Run", icon: <Play size={15} />, onClick: async () => {
                              const r = await useApp.getState().runPipeline(p.id, "manual");
                              if (r) nav(`/runs/${r.id}`);
                            } },
                            { label: "Export Python", icon: <Code2 size={15} />, onClick: () => nav(`/pipelines/${p.id}/export`) },
                            { label: "Duplicate", icon: <Copy size={15} />, onClick: () => duplicatePipeline(p.id) },
                            { separator: true, label: "" },
                            {
                              label: "Delete",
                              icon: <Trash2 size={15} />,
                              danger: true,
                              onClick: async () => {
                                if (await confirmAction({ title: "Delete pipeline?", body: `"${p.spec.name}" and its versions will be deleted. Run history is kept. Source files are not affected.`, confirmLabel: "Delete", danger: true })) {
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
