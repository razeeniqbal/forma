import { useState } from "react";
import { Plus, ChevronUp, ChevronDown, Trash2, Pencil, Database, FileSpreadsheet, MoreHorizontal, Bookmark } from "lucide-react";
import { useApp } from "@/store/app";
import { describeStep, stageOf, stepTitle } from "@/engine/registry";
import type { StepResult } from "@/engine/types";
import { useMenu } from "@/components/ui";
import { useWs, SOURCE } from "../context";
import { PanelFrame } from "./PanelFrame";

export function stepState(r: StepResult | undefined): "ok" | "warn" | "err" | "" {
  if (!r) return "";
  if (r.error) return "err";
  if (r.issues) return "warn";
  return "ok";
}

export function PipelinePanel() {
  const ws = useWs();
  const steps = ws.effective.steps;
  const results = ws.preview.result?.steps ?? [];
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const menu = useMenu();
  const dest = ws.spec.destination;

  return (
    <PanelFrame
      id="pipeline"
      title="Pipeline steps"
      actions={
        <button className="btn ghost xs icon" aria-label="Add transformation" title="Add transformation" onClick={() => ws.openPicker()}>
          <Plus size={15} />
        </button>
      }
    >
      <div className="steps-list">
        <div className={`step-item ${ws.spec.source ? "ok" : ""} ${ws.sel === SOURCE ? "on" : ""}`} onClick={() => ws.setSel(SOURCE)}>
          <span className="n">
            <FileSpreadsheet size={11} />
          </span>
          <div className="grow">
            <div className="t">Source</div>
            <div className="d">{ws.spec.source ? `${ws.spec.source.file}${ws.spec.source.sheet ? ` · ${ws.spec.source.sheet}` : ""}` : "Choose a source"}</div>
          </div>
        </div>
        {steps.map((s, i) => {
          const isDraft = ws.draft?.index === i;
          const r = results[i];
          return (
            <div
              key={s.id + (isDraft ? "-d" : "")}
              className={`step-item ${stepState(r)} ${ws.sel === i ? "on" : ""} ${drag === i ? "dragging" : ""} ${over === i && drag !== null && drag !== i ? "drop-before" : ""}`}
              draggable={!ws.draft}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) ws.moveStep(drag, i);
                setDrag(null);
                setOver(null);
              }}
              onClick={() => !ws.draft && ws.setSel(i)}
              onDoubleClick={() => !ws.draft && ws.editStep(i)}
            >
              <span className="n">{String(i + 2).padStart(2, "0")}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">
                  {stepTitle(s)} {isDraft && <span className="badge blue sm">{ws.draft?.isNew ? "Preview" : "Editing"}</span>}
                </div>
                <div className="d">
                  <span className="subtle">{stageOf(s)} · </span>
                  {r?.error ? <span style={{ color: "var(--red-text)" }}>{r.error}</span> : describeStep(s).detail}
                </div>
              </div>
              {!ws.draft && (
                <div className="acts" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost xs icon" title="Edit" aria-label="Edit step" onClick={() => ws.editStep(i)}>
                    <Pencil size={12} />
                  </button>
                  <button
                    className="btn ghost xs icon"
                    aria-label="More step actions"
                    onClick={(e) =>
                      menu.open(e.currentTarget.getBoundingClientRect(), [
                        { label: "Move up", icon: <ChevronUp size={15} />, disabled: i === 0, onClick: () => ws.moveStep(i, i - 1) },
                        { label: "Move down", icon: <ChevronDown size={15} />, disabled: i === steps.length - 1, onClick: () => ws.moveStep(i, i + 1) },
                        { label: "Insert step after", icon: <Plus size={15} />, onClick: () => { ws.setSel(i); ws.openPicker(); } },
                        { separator: true, label: "" },
                        {
                          label: "Save as preset…",
                          icon: <Bookmark size={15} />,
                          onClick: () => {
                            const name = window.prompt("Preset name", stepTitle(s))?.trim();
                            if (name) {
                              useApp.getState().savePreset(name, [s]);
                              useApp.getState().toast("success", `Saved preset “${name}”`);
                            }
                          },
                        },
                        { separator: true, label: "" },
                        { label: "Delete step", icon: <Trash2 size={15} />, danger: true, hint: "Del", onClick: () => ws.removeStep(i) },
                      ])
                    }
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div className={`step-item ${ws.isLoad ? "on" : ""}`} onClick={() => !ws.draft && ws.setSel(steps.length)}>
          <span className="n">
            <Database size={11} />
          </span>
          <div className="grow">
            <div className="t">Load</div>
            <div className="d">{dest ? (dest.type === "database" ? `Database · ${dest.table || "table not set"}` : `${(dest.format ?? "csv").toUpperCase()} file`) : "Set destination"}</div>
          </div>
        </div>
        <button className="btn soft sm" style={{ margin: "8px 4px" }} onClick={() => ws.openPicker()} disabled={!ws.spec.source}>
          <Plus size={14} /> Add transformation
        </button>
      </div>
      {menu.node}
    </PanelFrame>
  );
}
