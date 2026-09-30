import { useMemo, useState } from "react";
import { Lightbulb, Loader2, Check, ChevronDown, ChevronUp } from "lucide-react";
import { useApp, loadSideSheets } from "@/store/app";
import { getSourceFile } from "@/store/db";
import { executeInWorker } from "@/lib/runner";
import { sheetOf, useFullExecution } from "@/lib/hooks";
import { measureImpact, suggestRuleUpdates, type Impact } from "@/lib/ruleSuggestions";
import { fmtInt } from "@/lib/format";

/** Review-queue card: deterministic rule updates derived from review items and corrections. */
export function RuleSuggestions({ pipelineId }: { pipelineId: string }) {
  const pipeline = useApp((s) => s.pipelines.find((p) => p.id === pipelineId));
  const updateSpec = useApp((s) => s.updateSpec);
  const toast = useApp((s) => s.toast);
  const base = useFullExecution(pipeline?.spec);
  const [open, setOpen] = useState(true);
  const [impacts, setImpacts] = useState<Record<string, Impact | "loading">>({});
  const suggestions = useMemo(() => (pipeline && base.result ? suggestRuleUpdates(pipeline.spec, base.result) : []), [pipeline, base.result]);

  if (!pipeline || (!base.loading && suggestions.length === 0)) return null;

  const preview = async (id: string) => {
    const sug = suggestions.find((s) => s.id === id);
    if (!sug || !base.result || !pipeline.spec.source) return;
    setImpacts((m) => ({ ...m, [id]: "loading" }));
    const next = sug.apply(pipeline.spec);
    const file = await getSourceFile(next.source!.fileId);
    const res = await executeInWorker(next, sheetOf(file, next.source!.sheet)!, undefined, await loadSideSheets(next));
    setImpacts((m) => ({ ...m, [id]: measureImpact(base.result!, res) }));
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <Lightbulb size={16} color="var(--amber)" />
        <h3>
          Update rules from review {base.loading ? <Loader2 size={13} className="spin" /> : <span className="badge sm amber">{suggestions.length}</span>}
        </h3>
        <span className="small muted">Deterministic changes proposed from these review items and your corrections — preview the impact before applying.</span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </div>
      {open && (
        <table className="table">
          <tbody>
            {suggestions.slice(0, 8).map((s) => {
              const imp = impacts[s.id];
              return (
                <tr key={s.id}>
                  <td style={{ width: "42%" }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{s.title}</div>
                    <div className="small muted">{s.detail}</div>
                  </td>
                  <td className="small">
                    {imp === "loading" ? (
                      <span className="row">
                        <Loader2 size={13} className="spin" /> Running on all rows…
                      </span>
                    ) : imp ? (
                      <span>
                        Resolves <b style={{ color: "var(--green-text)" }}>{fmtInt(imp.resolved)}</b> review rows · {fmtInt(imp.stillOpen)} still open
                        {imp.newlyFlagged > 0 && <span style={{ color: "var(--red-text)" }}> · {fmtInt(imp.newlyFlagged)} newly flagged</span>}
                        {imp.changedCells > 0 && <span> · changes {fmtInt(imp.changedCells)} loaded values</span>}
                      </span>
                    ) : (
                      <span className="muted">Aimed at ~{fmtInt(s.targets)} review rows</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {!imp && (
                      <button className="btn sm" onClick={() => preview(s.id)}>
                        Preview impact
                      </button>
                    )}{" "}
                    <button
                      className="btn sm primary"
                      disabled={imp === "loading" || !imp}
                      title={!imp ? "Preview the impact first" : undefined}
                      onClick={() => {
                        updateSpec(pipeline.id, (spec) => s.apply(spec));
                        setImpacts({});
                        toast("success", "Pipeline updated (draft). Rerun to load the resolved rows.");
                      }}
                    >
                      <Check size={13} /> Apply
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
