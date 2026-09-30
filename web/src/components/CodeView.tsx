import { useEffect, useMemo, useRef, type ReactNode } from "react";

const KW = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "),
);
const BUILTIN = new Set("print len range list dict set tuple str int float bool enumerate zip any all next isinstance sorted open super".split(" "));

type Tok = { t: string; c?: string };

function tokenizeLine(line: string, state: { inTriple: string | null }): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  if (state.inTriple) {
    const end = line.indexOf(state.inTriple);
    if (end < 0) return [{ t: line, c: "tok-s" }];
    out.push({ t: line.slice(0, end + 3), c: "tok-s" });
    i = end + 3;
    state.inTriple = null;
  }
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if (rest[0] === "#") {
      out.push({ t: rest, c: "tok-c" });
      break;
    }
    if ((m = /^[rbfRBF]{0,2}("""|''')/.exec(rest))) {
      const q = m[1];
      const end = rest.indexOf(q, m[0].length);
      if (end < 0) {
        out.push({ t: rest, c: "tok-s" });
        state.inTriple = q;
        break;
      }
      out.push({ t: rest.slice(0, end + 3), c: "tok-s" });
      i += end + 3;
      continue;
    }
    if ((m = /^[rbfRBF]{0,2}("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(rest))) {
      out.push({ t: m[0], c: "tok-s" });
      i += m[0].length;
      continue;
    }
    if ((m = /^\d+(\.\d+)?/.exec(rest))) {
      out.push({ t: m[0], c: "tok-n" });
      i += m[0].length;
      continue;
    }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const w = m[0];
      const prev = out.length ? out[out.length - 1].t : "";
      const cls = KW.has(w) ? "tok-k" : /\b(def|class)\s*$/.test(prev) ? "tok-f" : BUILTIN.has(w) ? "tok-b" : undefined;
      out.push({ t: w, c: cls });
      i += w.length;
      continue;
    }
    out.push({ t: rest[0] });
    i++;
  }
  return out;
}

export function CodeView({ code, highlight, scrollToLine, wrap }: { code: string; highlight?: [number, number]; scrollToLine?: number; wrap?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => {
    const state = { inTriple: null as string | null };
    return code.replace(/\n$/, "").split("\n").map((l) => tokenizeLine(l, state));
  }, [code]);
  useEffect(() => {
    if (scrollToLine === undefined || !ref.current) return;
    const el = ref.current.querySelectorAll(".ln")[scrollToLine] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "start" });
  }, [scrollToLine, code]);
  return (
    <div className="code" ref={ref} style={wrap ? { minWidth: 0 } : undefined}>
      {lines.map((toks, i) => {
        const hl = highlight && i >= highlight[0] && i <= highlight[1];
        const nodes: ReactNode[] = toks.map((t, k) => (t.c ? <span key={k} className={t.c}>{t.t}</span> : t.t));
        return (
          <span key={i} className={`ln ${hl ? "hl" : ""}`} style={wrap ? { whiteSpace: "pre-wrap" } : undefined}>
            {nodes.length ? nodes : " "}
          </span>
        );
      })}
    </div>
  );
}

/** Line range of a step function inside the generated script. */
export function findStepRange(code: string, fnName: string): [number, number] | undefined {
  const lines = code.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`def ${fnName}(`));
  if (start < 0) return;
  let s = start;
  if (s > 0 && lines[s - 1].startsWith("# ")) s--;
  let e = start + 1;
  while (e < lines.length && lines[e] !== "    return df") e++;
  return [s, Math.min(e, lines.length - 1)];
}
