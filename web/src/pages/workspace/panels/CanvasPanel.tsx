import { useCallback, useMemo } from "react";
import { Workflow } from "lucide-react";
import { deriveGraph, LOAD_ID, SOURCE_ID } from "@/canvas/graph";
import { useWs, SOURCE } from "../context";
import { useFlow } from "../PipelineView";
import { PipelineCanvas } from "../canvas/PipelineCanvas";
import { PanelFrame } from "./PanelFrame";

/** The pipeline canvas inside the workbench. Selecting a node selects its step, so Python shows its code. */
export function CanvasPanel() {
  const ws = useWs();
  const flow = useFlow();
  const graph = useMemo(() => deriveGraph(ws.effective), [ws.effective]);
  const steps = ws.effective.steps;
  const selectedId = ws.sel === SOURCE ? SOURCE_ID : ws.sel >= steps.length ? LOAD_ID : steps[ws.sel]?.id ?? null;
  const indexFor = (id: string) => {
    const g = graph.nodes.find((n) => n.id === id);
    return g?.index ?? (g?.side ? steps.findIndex((s) => s.id === g.side!.consumers[0]) : undefined);
  };
  const open = useCallback(
    (id: string | null) => {
      if (id === null || ws.draft) return;
      const i = indexFor(id);
      if (i !== undefined && i >= -1) ws.setSel(i);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, ws.draft, ws.setSel],
  );
  const addAfter = useCallback(
    (i: number) => {
      ws.setSel(i);
      ws.openPicker();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.setSel, ws.openPicker],
  );
  return (
    <PanelFrame id="canvas" title="Pipeline canvas" icon={<Workflow size={15} color="var(--blue)" />}>
      <PipelineCanvas flow={flow} openId={selectedId} onOpen={open} onExpand={open} onAddAfter={addAfter} embedded />
    </PanelFrame>
  );
}
