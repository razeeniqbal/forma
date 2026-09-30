import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { History, Trash2 } from "lucide-react";
import { useApp } from "@/store/app";
import type { RunStatus } from "@/store/model";
import { confirmAction, Empty, StatusBadge } from "@/components/ui";
import { fmtDateTime, fmtDuration, fmtInt } from "@/lib/format";

export function RunsPage() {
  const runs = useApp((s) => s.runs);
  const pipelines = useApp((s) => s.pipelines);
  const del = useApp((s) => s.deleteRun);
  const nav = useNavigate();
  const [status, setStatus] = useState<RunStatus | "all">("all");
  const [pipe, setPipe] = useState("all");
  const list = runs.filter((r) => (status === "all" || r.status === status) && (pipe === "all" || r.pipelineId === pipe));
  const count = (s: RunStatus) => runs.filter((r) => r.status === s).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <p>Every run references an immutable pipeline version and records step-level results.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div className="chips">
            <button className={`chip ${status === "all" ? "on" : ""}`} onClick={() => setStatus("all")}>
              All <span className="count">({runs.length})</span>
            </button>
            {(["success", "review", "failed", "cancelled"] as RunStatus[]).map((s) => (
              <button key={s} className={`chip ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>
                {{ success: "Success", review: "With review items", failed: "Failed", cancelled: "Cancelled", running: "Running" }[s]} <span className="count">({count(s)})</span>
              </button>
            ))}
          </div>
          <select className="select sm" style={{ width: 220, marginLeft: "auto" }} value={pipe} onChange={(e) => setPipe(e.target.value)}>
            <option value="all">All pipelines</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.spec.name}
              </option>
            ))}
          </select>
        </div>
        {list.length === 0 ? (
          <Empty icon={<History size={22} />} title="No runs">
            Run a pipeline from its workspace to see it here.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Pipeline</th>
                <th>Version</th>
                <th>Mode</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Input</th>
                <th style={{ textAlign: "right" }}>Loaded</th>
                <th style={{ textAlign: "right" }}>Review</th>
                <th style={{ textAlign: "right" }}>Duration</th>
                <th>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => nav(`/runs/${r.id}`)}>
                  <td className="mono small">{r.id}</td>
                  <td>
                    <Link to={`/pipelines/${r.pipelineId}`} onClick={(e) => e.stopPropagation()}>
                      {r.pipelineName}
                    </Link>
                  </td>
                  <td>{r.mode === "test" ? <span className="badge">Draft</span> : <span className="badge outline">v{r.version}</span>}</td>
                  <td className="small">{r.mode === "test" ? "Test" : "Manual"}</td>
                  <td>
                    <StatusBadge status={r.status} short />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>{fmtInt(r.rowsIn)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmtInt(r.rowsOut)}</td>
                  <td className="num" style={{ textAlign: "right", color: r.reviewCount ? "var(--amber-text)" : undefined }}>{fmtInt(r.reviewCount)}</td>
                  <td className="num small muted" style={{ textAlign: "right" }}>{r.finishedAt ? fmtDuration(r.finishedAt - r.startedAt) : "…"}</td>
                  <td className="small muted">{fmtDateTime(r.startedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm icon" aria-label="Delete run" onClick={async () => (await confirmAction({ title: "Delete run record?", body: "The run log and stored output for this run are removed. Pipeline versions are unaffected.", confirmLabel: "Delete", danger: true })) && del(r.id)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
