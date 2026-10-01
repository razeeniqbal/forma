import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Workflow, ArrowDownToLine } from "lucide-react";
import type { Pipeline, Run, SourceMeta } from "@/store/model";
import { FileIcon, StatusBadge } from "@/components/ui";
import { specSourceIds } from "@/store/migrate";
import { fmtInt } from "@/lib/format";

interface Edge {
  from: string;
  to: string;
}

const destLabel = (p: Pipeline) => {
  const d = p.spec.destination;
  if (!d) return null;
  if (d.type === "database") return d.table || "database table";
  return d.path || `${(d.format ?? "csv").toUpperCase()} file`;
};

/** Sheets of a source that the project's pipelines read. */
function sheetsRead(s: SourceMeta, pipelines: Pipeline[]): string[] {
  const out = new Set<string>();
  for (const p of pipelines) {
    if (p.spec.source?.fileId === s.id && p.spec.source.sheet) out.add(p.spec.source.sheet);
    for (const st of p.spec.steps) if ((st.type === "join" || st.type === "append") && st.source.fileId === s.id && st.source.sheet) out.add(st.source.sheet);
  }
  return [...out];
}

/**
 * Read-only data map of a project: sources → pipelines → outputs.
 * Informational, not an editor: fixed columns, orthogonal connectors, no handles.
 */
export function ProjectMap({ sources, pipelines, runs }: { sources: SourceMeta[]; pipelines: Pipeline[]; runs: Run[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; key: string; from: string; to: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  const edges = useMemo<Edge[]>(() => {
    const e: Edge[] = [];
    for (const p of pipelines) {
      for (const id of [...new Set(specSourceIds(p.spec))]) if (sources.some((s) => s.id === id)) e.push({ from: `s:${id}`, to: `p:${p.id}` });
      e.push({ from: `p:${p.id}`, to: `o:${p.id}` });
    }
    return e;
  }, [pipelines, sources]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      const rect = (id: string) => box.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect();
      const out: typeof paths = [];
      // Inbound edges to one pipeline share a trunk just left of it.
      for (const e of edges) {
        const a = rect(e.from);
        const z = rect(e.to);
        if (!a || !z) continue;
        const x1 = a.right - b.left;
        const y1 = a.top + a.height / 2 - b.top;
        const x2 = z.left - b.left;
        const y2 = z.top + z.height / 2 - b.top;
        const mid = Math.round(x2 - Math.min(28, (x2 - x1) / 2));
        const r = Math.min(6, Math.abs(y2 - y1) / 2);
        const dir = y2 > y1 ? 1 : -1;
        const d =
          Math.abs(y2 - y1) < 1
            ? `M${x1},${y1} H${x2 - 1}`
            : `M${x1},${y1} H${mid - r} Q${mid},${y1} ${mid},${y1 + dir * r} V${y2 - dir * r} Q${mid},${y2} ${mid + r},${y2} H${x2 - 1}`;
        out.push({ d, key: `${e.from}>${e.to}`, from: e.from, to: e.to });
      }
      setPaths(out);
      setSize({ w: b.width, h: b.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [edges, sources, pipelines]);

  const lit = (id: string) => !!hover && (hover === id || edges.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id)));
  const usedSources = sources.filter((s) => edges.some((e) => e.from === `s:${s.id}`));
  const unused = sources.filter((s) => !usedSources.includes(s));

  return (
    <div className="pmap" ref={boxRef} onMouseLeave={() => setHover(null)}>
      <svg className="pmap-wires" width={size.w} height={size.h} aria-hidden>
        <defs>
          <marker id="pmap-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
          </marker>
        </defs>
        {paths.map((p) => (
          <path key={p.key} d={p.d} className={hover && (p.from === hover || p.to === hover) ? "on" : ""} markerEnd="url(#pmap-arrow)" />
        ))}
      </svg>
      <div className="pmap-col">
        <div className="pmap-head">Sources</div>
        {[...usedSources, ...unused].map((s) => {
          const sheets = sheetsRead(s, pipelines);
          return (
            <div key={s.id} data-node={`s:${s.id}`} className={`pmap-node src ${lit(`s:${s.id}`) ? "lit" : ""} ${unused.includes(s) ? "idle" : ""}`} onMouseEnter={() => setHover(`s:${s.id}`)}>
              <FileIcon kind={s.kind} />
              <div className="pmap-txt">
                <div className="t">{s.name}</div>
                <div className="d">
                  {sheets.length ? sheets.join(" · ") : s.sheets.length > 1 ? `${s.sheets.length} sheets` : `${fmtInt(s.sheets[0]?.rows ?? 0)} rows`}
                  {unused.includes(s) && " · not used yet"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pmap-col">
        <div className="pmap-head">Pipelines</div>
        {pipelines.map((p) => {
          const last = runs.find((r) => r.pipelineId === p.id);
          return (
            <Link key={p.id} to={`/pipelines/${p.id}`} data-node={`p:${p.id}`} className={`pmap-node pipe ${lit(`p:${p.id}`) ? "lit" : ""}`} onMouseEnter={() => setHover(`p:${p.id}`)}>
              <Workflow size={16} color="var(--blue)" />
              <div className="pmap-txt">
                <div className="t">{p.spec.name}</div>
                <div className="d">
                  {p.spec.steps.length + 2} steps{p.dirty ? " · draft" : ` · v${p.version}`}
                </div>
              </div>
              {last && <StatusBadge status={last.status} short />}
            </Link>
          );
        })}
        {!pipelines.length && <div className="pmap-ghost">No pipelines yet</div>}
      </div>
      <div className="pmap-col">
        <div className="pmap-head">Outputs</div>
        {pipelines.map((p) => {
          const label = destLabel(p);
          return (
            <div key={p.id} data-node={`o:${p.id}`} className={`pmap-node out ${label ? "" : "unset"} ${lit(`o:${p.id}`) ? "lit" : ""}`} onMouseEnter={() => setHover(`p:${p.id}`)}>
              <ArrowDownToLine size={15} color={label ? "var(--green-text)" : "var(--subtle)"} />
              <div className="pmap-txt">
                <div className={`t ${label ? "mono" : ""}`}>{label ?? "No destination yet"}</div>
                <div className="d">{p.spec.destination?.type === "database" ? "database" : label ? "file" : "set it in the Load step"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
