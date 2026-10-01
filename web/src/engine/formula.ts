// Minimal, deterministic formula language for the Formula transformation.
//   [Amount] * 1.06
//   round([total] - [discount], 2)
//   abs([delta]) / 100
// Column references use [brackets]. Supported: + - * / ( ), numbers,
// round(x, n), abs(x), min(a, b), max(a, b). Blank/invalid inputs yield blank.

import type { Cell } from "./types";
import { roundHalfEven, toNum } from "./values";

export type Expr =
  | { k: "num"; v: number }
  | { k: "col"; name: string }
  | { k: "neg"; e: Expr }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr }
  | { k: "call"; fn: "round" | "abs" | "min" | "max"; args: Expr[] };

type Tok =
  | { t: "num"; v: number }
  | { t: "col"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const FUNCS = { round: [1, 2], abs: [1, 1], min: [2, 2], max: [2, 2] } as const;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new Error("Missing closing ] for column reference");
      out.push({ t: "col", v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new Error(`Invalid number at ${i + 1}`);
      out.push({ t: "num", v: parseFloat(m[1]) });
      i += m[1].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ("+-*/(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}" at ${i + 1}`);
    }
  }
  return out;
}

export function parseFormula(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v: string) => {
    const t = toks[p];
    if (!t || t.t !== "op" || t.v !== v) throw new Error(`Expected "${v}"`);
    p++;
  };
  const expr = (): Expr => {
    let a = term();
    for (let t = peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      p++;
      a = { k: "bin", op: t.v as "+" | "-", a, b: term() };
    }
    return a;
  };
  const term = (): Expr => {
    let a = unary();
    for (let t = peek(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      p++;
      a = { k: "bin", op: t.v as "*" | "/", a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr => {
    const t = peek();
    if (t && t.t === "op" && t.v === "-") {
      p++;
      return { k: "neg", e: unary() };
    }
    if (t && t.t === "op" && t.v === "+") {
      p++;
      return unary();
    }
    return atom();
  };
  const atom = (): Expr => {
    const t = toks[p++];
    if (!t) throw new Error("Unexpected end of formula");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "col") return { k: "col", name: t.v };
    if (t.t === "op" && t.v === "(") {
      const e = expr();
      eat(")");
      return e;
    }
    if (t.t === "id") {
      const fn = t.v as keyof typeof FUNCS;
      if (!(fn in FUNCS)) throw new Error(`Unknown function "${t.v}". Use [brackets] for column names.`);
      eat("(");
      const args: Expr[] = [expr()];
      while (peek()?.t === "op" && peek()!.v === ",") {
        p++;
        args.push(expr());
      }
      eat(")");
      const [lo, hi] = FUNCS[fn];
      if (args.length < lo || args.length > hi) throw new Error(`${fn}() takes ${lo === hi ? lo : `${lo}–${hi}`} argument(s)`);
      if (fn === "round" && args[1] && args[1].k !== "num") throw new Error("round() digits must be a number");
      return { k: "call", fn, args };
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const e = expr();
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: unknown }).v}"`);
  return e;
}

export function formulaColumns(e: Expr, acc = new Set<string>()): Set<string> {
  switch (e.k) {
    case "col":
      acc.add(e.name);
      break;
    case "neg":
      formulaColumns(e.e, acc);
      break;
    case "bin":
      formulaColumns(e.a, acc);
      formulaColumns(e.b, acc);
      break;
    case "call":
      e.args.forEach((a) => formulaColumns(a, acc));
      break;
  }
  return acc;
}

export function evalFormula(e: Expr, get: (col: string) => Cell): number | null {
  const ev = (x: Expr): number | null => {
    switch (x.k) {
      case "num":
        return x.v;
      case "col":
        return toNum(get(x.name));
      case "neg": {
        const v = ev(x.e);
        return v === null ? null : -v;
      }
      case "bin": {
        const a = ev(x.a);
        const b = ev(x.b);
        if (a === null || b === null) return null;
        let r: number;
        if (x.op === "+") r = a + b;
        else if (x.op === "-") r = a - b;
        else if (x.op === "*") r = a * b;
        else r = a / b;
        return Number.isFinite(r) ? r : null;
      }
      case "call": {
        const vals = x.args.map(ev);
        if (vals.some((v) => v === null)) return null;
        const [a, b] = vals as number[];
        if (x.fn === "abs") return Math.abs(a);
        if (x.fn === "min") return Math.min(a, b);
        if (x.fn === "max") return Math.max(a, b);
        return roundHalfEven(a, x.args[1] ? (x.args[1] as { v: number }).v : 0);
      }
    }
  };
  return ev(e);
}

const pyNum = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** Emit a pandas expression. `col(name)` renders a numeric Series for a column. */
export function formulaToPython(e: Expr, col: (name: string) => string): string {
  const py = (x: Expr): string => {
    switch (x.k) {
      case "num":
        return pyNum(x.v);
      case "col":
        return col(x.name);
      case "neg":
        return `(-${py(x.e)})`;
      case "bin":
        if (x.op === "/") return `_safe_div(${py(x.a)}, ${py(x.b)})`;
        return `(${py(x.a)} ${x.op} ${py(x.b)})`;
      case "call": {
        const [a, b] = x.args.map(py);
        if (x.fn === "abs") return `np.abs(${a})`;
        if (x.fn === "min") return `np.minimum(${a}, ${b})`;
        if (x.fn === "max") return `np.maximum(${a}, ${b})`;
        return `np.round(${a}, ${x.args[1] ? (x.args[1] as { v: number }).v : 0})`;
      }
    }
  };
  return py(e);
}
