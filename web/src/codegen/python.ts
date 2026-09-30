// Deterministic Python (pandas) generator (PRD §9). Each pipeline step maps to
// one clearly named function whose header comment matches the visual pipeline.

import type { PipelineSpec, SourceSpec, Step, ValidationRule } from "@/engine/types";
import { STAGE_OF, stepTitle } from "@/engine/registry";
import { isReshaping, ruleLabel } from "@/engine/execute";
import { formulaToPython, parseFormula } from "@/engine/formula";
import { runtimePython } from "./runtime";

export interface GenOptions {
  version?: number;
  generatedAt?: Date;
  connectionEnv?: string;
}

// ---------------------------------------------------------------------------
// Python literal helpers
// ---------------------------------------------------------------------------

export const pyStr = (s: string) => JSON.stringify(s);
export const pyRe = (s: string) =>
  s.includes('"') || s.endsWith("\\") || /[\n\r]/.test(s) ? JSON.stringify(s) : `r"${s}"`;

export function pyLit(v: unknown, indent = ""): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "None";
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return `[${v.map((x) => pyLit(x, indent)).join(", ")}]`;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return "{}";
  const inner = indent + "    ";
  return `{\n${entries.map(([k, x]) => `${inner}${pyStr(k)}: ${pyLit(x, inner)},`).join("\n")}\n${indent}}`;
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "step"
  );
}

/** JS replacement string ($1, $&) → Python re.sub replacement (\g<1>, \g<0>). */
export function jsReplacementToPython(rep: string): string {
  let out = "";
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === "\\") {
      out += "\\\\";
    } else if (c === "$" && i + 1 < rep.length) {
      const n = rep[i + 1];
      if (n === "$") {
        out += "$";
        i++;
      } else if (n === "&") {
        out += "\\g<0>";
        i++;
      } else if (/\d/.test(n)) {
        out += `\\g<${n}>`;
        i++;
      } else out += c;
    } else out += c;
  }
  return out;
}

export function stepFunctionName(step: Step, index: number): string {
  return `step_${String(index + 2).padStart(2, "0")}_${slug(stepTitle(step))}`;
}

// ---------------------------------------------------------------------------
// Per-step code
// ---------------------------------------------------------------------------

function ruleCheck(rule: ValidationRule): string {
  switch (rule.kind) {
    case "matches":
      return `lambda v: re.search(${pyRe(rule.pattern)}, to_text(v), re.ASCII) is not None`;
    case "valid_date":
      return `lambda v: parse_date(v, ANY_DATE_FORMATS) is not None`;
    case "in_set":
      return `lambda v: to_text(v) in ${pyLit(rule.values)}`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[rule.kind];
      return `lambda v: to_num(v) is not None and to_num(v) ${op} ${rule.value}`;
    }
    default:
      return "None";
  }
}

function issueKindForRule(rule: ValidationRule): string {
  if (rule.kind === "not_blank") return "missing_value";
  if (rule.kind === "valid_date") return "invalid_date";
  if (rule.kind === "matches") return "pattern_mismatch";
  return "rule_failed";
}

function stepBody(step: Step): string[] {
  const id = pyStr(step.id);
  switch (step.type) {
    case "select":
      return [`before = set(df.index)`, `df = df[${pyLit(step.columns)}].copy()`, `prune_issues(df, before)`];
    case "rename":
      return [`mapping = ${pyLit(step.mapping, "    ")}`, `df = df.rename(columns=mapping)`, `rename_issues(mapping)`];
    case "trim": {
      const fn = step.collapseSpaces ? `re.sub(r"\\s+", " ", v.strip())` : `v.strip()`;
      return [
        `df = df.copy()`,
        `for name in ${pyLit(step.columns)}:`,
        `    df[name] = column((${fn} if isinstance(v, str) else v for v in df[name]), df.index)`,
      ];
    }
    case "change_case": {
      const fn = step.mode === "upper" ? "v.upper()" : step.mode === "lower" ? "v.lower()" : "title_case(v)";
      return [
        `df = df.copy()`,
        `for name in ${pyLit(step.columns)}:`,
        `    df[name] = column((${fn} if isinstance(v, str) else v for v in df[name]), df.index)`,
      ];
    }
    case "replace": {
      const col = pyStr(step.column);
      if (step.match === "exact")
        return [
          `df = df.copy()`,
          `df[${col}] = column((${pyStr(step.replace)} if to_text(v) == ${pyStr(step.find)} else v for v in df[${col}]), df.index)`,
        ];
      if (step.match === "contains")
        return step.find === ""
          ? [`# Empty search text: nothing to replace`]
          : [
              `df = df.copy()`,
              `df[${col}] = column(`,
              `    (to_text(v).replace(${pyStr(step.find)}, ${pyStr(step.replace)}) if to_text(v) is not None else v for v in df[${col}]),`,
              `    df.index,`,
              `)`,
            ];
      return [
        `df = df.copy()`,
        `pattern = re.compile(${pyRe(step.find)}, re.ASCII)`,
        `df[${col}] = column(`,
        `    (pattern.sub(${pyStr(jsReplacementToPython(step.replace))}, to_text(v)) if to_text(v) is not None else v for v in df[${col}]),`,
        `    df.index,`,
        `)`,
      ];
    }
    case "fill_blanks": {
      const col = pyStr(step.column);
      return [`df = df.copy()`, `df[${col}] = column((${pyStr(step.value)} if is_blank(v) else v for v in df[${col}]), df.index)`];
    }
    case "convert_number": {
      const col = pyStr(step.column);
      const round = step.decimals === null ? "n" : `round_half_even(n, ${step.decimals})`;
      return [
        `def convert(v):`,
        `    if is_blank(v):`,
        `        return None`,
        `    n = parse_money(v)`,
        `    if n is None:`,
        `        raise Flag("invalid_number", f'"{to_text(v)}" is not a valid number')`,
        `    return ${round}`,
        ``,
        `df = df.copy()`,
        `df[${col}] = map_column(df, ${col}, convert, step=${id})`,
      ];
    }
    case "standardise_date": {
      const col = pyStr(step.column);
      return [
        `input_formats = ${pyLit(step.inputFormats)}`,
        ``,
        `def standardise(v):`,
        `    if is_blank(v):`,
        `        return None`,
        `    ymd = parse_date(v, input_formats)`,
        `    if ymd is None:`,
        `        raise Flag("invalid_date", f'Date value "{to_text(v)}" is not valid')`,
        `    return format_date(ymd, ${pyStr(step.outputFormat)})`,
        ``,
        `df = df.copy()`,
        `df[${col}] = map_column(df, ${col}, standardise, step=${id})`,
      ];
    }
    case "extract": {
      const col = pyStr(step.column);
      const lines = [`patterns = {`];
      for (const f of step.fields) lines.push(`    ${pyStr(f.name)}: ${pyRe(f.pattern)},`);
      lines.push(`}`, `out = {name: [] for name in patterns}`, `for row, value in zip(df.index, df[${col}]):`, `    text = to_text(value)`);
      for (const f of step.fields) {
        const n = pyStr(f.name);
        lines.push(
          `    raw = regex_extract(text, patterns[${n}]${f.ignoreCase ? ", ignore_case=True" : ""})`,
          `    if raw is None:`,
          `        kind = "missing_value" if text is None else "pattern_mismatch"`,
          `        flag(row, ${n}, ${id}, kind, f'Could not extract ${f.name.replace(/[{}'\\]/g, "")} from "{text or ""}"', text)`,
          `        out[${n}].append(None)`,
        );
        if (f.type === "number")
          lines.push(
            `    else:`,
            `        n = parse_money(raw)`,
            `        if n is None:`,
            `            flag(row, ${n}, ${id}, "invalid_number", f'"{raw}" is not a valid number', raw)`,
            `        out[${n}].append(n)`,
          );
        else if (f.type === "date")
          lines.push(
            `    else:`,
            `        ymd = parse_date(raw, ANY_DATE_FORMATS)`,
            `        if ymd is None:`,
            `            flag(row, ${n}, ${id}, "invalid_date", f'Date value "{raw}" is not valid', raw)`,
            `        out[${n}].append(format_date(ymd, "YYYY-MM-DD") if ymd else None)`,
          );
        else lines.push(`    else:`, `        out[${n}].append(raw)`);
      }
      lines.push(`df = df.copy()`, `for name, values in out.items():`, `    df[name] = column(values, df.index)`);
      return lines;
    }
    case "extract_kv": {
      const col = pyStr(step.column);
      return [
        `keys = ${pyLit(Object.fromEntries(step.keys.map((k) => [k.name, k.key.trim().toLowerCase()])), "    ")}`,
        `out = {name: [] for name in keys}`,
        `for row, value in zip(df.index, df[${col}]):`,
        `    text = to_text(value)`,
        `    found = {}`,
        `    if text is not None:`,
        `        for part in text.split(${pyStr(step.pairSeparator)}):`,
        `            key, sep, val = part.partition(${pyStr(step.kvSeparator)})`,
        `            if sep and key.strip().lower() not in found:`,
        `                found[key.strip().lower()] = val.strip()`,
        `    for name, key in keys.items():`,
        `        if key not in found:`,
        `            flag(row, name, ${id}, "missing_value", f'Key "{key}" not found', text)`,
        `        out[name].append(found.get(key))`,
        `df = df.copy()`,
        `for name, values in out.items():`,
        `    df[name] = column(values, df.index)`,
      ];
    }
    case "split": {
      const col = pyStr(step.column);
      return [
        `names = ${pyLit(step.into)}`,
        `out = {name: [] for name in names}`,
        `for value in df[${col}]:`,
        `    text = to_text(value)`,
        `    parts = text.split(${pyStr(step.delimiter)}, len(names) - 1) if text is not None else []`,
        `    for k, name in enumerate(names):`,
        `        piece = parts[k].strip() if k < len(parts) else ""`,
        `        out[name].append(piece or None)`,
        `df = df.copy()`,
        `for name, values in out.items():`,
        `    df[name] = column(values, df.index)`,
      ];
    }
    case "filter": {
      const col = pyStr(step.column);
      const v = pyStr(step.value);
      const cond: Record<string, string> = {
        equals: `to_text(v) == ${v}`,
        not_equals: `to_text(v) != ${v}`,
        contains: `to_text(v) is not None and ${v} in to_text(v)`,
        not_contains: `to_text(v) is None or ${v} not in to_text(v)`,
        is_blank: `is_blank(v)`,
        not_blank: `not is_blank(v)`,
      };
      const numOp = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[step.op as "gt"];
      const test = cond[step.op] ?? `to_num(v) is not None and to_num(${v}) is not None and to_num(v) ${numOp} to_num(${v})`;
      return [`before = set(df.index)`, `keep = [${test} for v in df[${col}]]`, `df = df[keep].copy()`, `prune_issues(df, before)`];
    }
    case "sort": {
      const col = pyStr(step.column);
      return [
        `def sort_key(v):`,
        `    return (0, float(v), "") if is_number(v) else (1, 0.0, to_text(v))`,
        ``,
        `values = list(df[${col}])`,
        `filled = [i for i, v in enumerate(values) if not is_blank(v)]`,
        `blanks = [i for i, v in enumerate(values) if is_blank(v)]`,
        `filled.sort(key=lambda i: sort_key(values[i])${step.direction === "desc" ? ", reverse=True" : ""})`,
        `df = df.iloc[filled + blanks]  # blanks last`,
      ];
    }
    case "remove_duplicates": {
      const cols = step.columns.length ? pyLit(step.columns) : "list(df.columns)";
      return [
        `before = set(df.index)`,
        `key_columns = ${cols}`,
        `keys = [tuple(to_text(v) for v in row) for row in df[key_columns].itertuples(index=False, name=None)]`,
        `seen, keep = set(), []`,
        `for k in keys:`,
        `    keep.append(k not in seen)`,
        `    seen.add(k)`,
        `df = df[keep].copy()`,
        `prune_issues(df, before)`,
      ];
    }
    case "formula": {
      const expr = formulaToPython(parseFormula(step.expression), (c) => `numeric(df, ${pyStr(c)})`);
      return [`# ${step.output} = ${step.expression.replace(/[\r\n]+/g, " ")}`,`df = df.copy()`, `df[${pyStr(step.output)}] = from_numeric(${expr}, df.index)`];
    }
    case "round": {
      const col = pyStr(step.column);
      return [
        `df = df.copy()`,
        `df[${col}] = column((round_half_even(to_num(v), ${step.decimals}) if to_num(v) is not None else v for v in df[${col}]), df.index)`,
      ];
    }
    case "group":
      return [
        `by = ${pyLit(step.by)}`,
        `aggregations = [  # (column, function, output name)`,
        ...step.aggs.map((a) => `    (${pyStr(a.column)}, ${pyStr(a.fn)}, ${pyStr(a.as || `${a.column}_${a.fn}`)}),`),
        `]`,
        `return group_rows(df, by, aggregations)`,
      ];
    case "pivot":
      return [`return pivot_rows(df, index=${pyLit(step.index)}, column=${pyStr(step.column)}, value=${pyStr(step.value)}, fn=${pyStr(step.fn)})`];
    case "unpivot":
      return [
        `return unpivot_rows(df, keep=${pyLit(step.keep)}, columns=${pyLit(step.columns)}, name_column=${pyStr(step.nameColumn || "variable")}, value_column=${pyStr(step.valueColumn || "value")})`,
      ];
    case "join":
      return [
        `other = side_source(${pyStr(step.id)})  # ${step.source.file}`,
        `return combine_rows(`,
        `    df,`,
        `    other,`,
        `    on=${pyLit(step.on.map((o) => [o.left, o.right]))},`,
        `    columns=${pyLit(step.columns)},`,
        `    prefix=${pyStr(step.prefix)},`,
        `    how=${pyStr(step.how)},`,
        `    mode=${pyStr(step.mode)},`,
        `    flag_unmatched=${step.flagUnmatched ? "True" : "False"},`,
        `    step=${id},`,
        `    source_name=${pyStr(step.source.file)},`,
        `)`,
      ];
    case "append":
      return [`other = side_source(${pyStr(step.id)})  # ${step.source.file}`, `return append_rows(df, other)`];
    case "validate": {
      const lines: string[] = [`rules = [`];
      for (const r of step.rules) {
        lines.push(
          `    # ${r.column}: ${ruleLabel(r)}`,
          `    (${pyStr(r.id)}, ${pyStr(r.column)}, ${pyStr(r.kind)}, ${pyStr(issueKindForRule(r))}, ${pyStr(ruleLabel(r))}, ${ruleCheck(r)}),`,
        );
      }
      lines.push(
        `]`,
        `for rule_id, name, kind, issue_kind, label, check in rules:`,
        `    evaluated = passed = 0`,
        `    seen = set()`,
        `    for row, v in zip(df.index, df[name]):`,
        `        if kind == "not_blank":`,
        `            ok = not is_blank(v)`,
        `        elif is_blank(v):`,
        `            continue  # blanks are only checked by "not blank" rules`,
        `        elif kind == "unique":`,
        `            ok = to_text(v) not in seen`,
        `            seen.add(to_text(v))`,
        `        else:`,
        `            ok = check(v)`,
        `        evaluated += 1`,
        `        if ok:`,
        `            passed += 1`,
        `        else:`,
        `            shown = to_text(v) if to_text(v) is not None else "blank"`,
        `            flag(row, name, ${id}, issue_kind, f"{label} (value: {shown})", v)`,
        `    RULE_RESULTS.append({"rule": rule_id, "column": name, "evaluated": evaluated, "passed": passed})`,
      );
      return lines;
    }
  }
}

function stepDoc(step: Step): string {
  switch (step.type) {
    case "extract":
      return `Extract ${step.fields.map((f) => f.name).join(", ")} from ${step.column}. Rows that don't match are flagged for review.`;
    case "standardise_date":
      return `Convert ${step.column} to ${step.outputFormat}. Accepted input formats: ${step.inputFormats.join(", ")}.`;
    case "convert_number":
      return `Convert ${step.column} to a number (currency symbols and thousands separators are removed).`;
    case "validate":
      return `Check configured data-quality rules; failing values are flagged for review.`;
    default:
      return stepTitle(step) + ".";
  }
}

export function generateStep(step: Step, index: number): string {
  const n = String(index + 2).padStart(2, "0");
  const header = `# ${n} ${STAGE_OF[step.type]} — ${stepTitle(step)}`;
  let body: string[];
  try {
    body = stepBody(step);
  } catch (e) {
    body = [`raise ValueError(${pyStr(`Step could not be generated: ${(e as Error).message}`)})`];
  }
  const doc = stepDoc(step).replace(/\\/g, "\\\\").replace(/"""/g, "'''").replace(/[\r\n]+/g, " ");
  return [
    header,
    `def ${stepFunctionName(step, index)}(df: pd.DataFrame) -> pd.DataFrame:`,
    `    """${doc}"""`,
    ...body.map((l) => (l ? "    " + l : "")),
    ...(body.some((l) => l.startsWith("return ")) ? [] : [`    return df`]),
  ].join("\n");
}

function sourceConfig(s: SourceSpec) {
  return {
    path: s.file,
    type: s.type,
    ...(s.sheet ? { sheet: s.sheet } : {}),
    header_row: s.headerRow,
    start_col: s.startCol,
    end_col: s.endCol,
    ...(s.type === "csv" ? { delimiter: s.csvDelimiter ?? "," } : {}),
  };
}

export function outputConfig(spec: PipelineSpec, opts: GenOptions = {}) {
  const d = spec.destination;
  if (d?.type === "database")
    return { type: "database", url_env: opts.connectionEnv ?? "WAREHOUSE_URL", table: d.table ?? slug(spec.name), if_exists: d.ifExists ?? "append" };
  const format = d?.format ?? "csv";
  return { type: "file", format, path: d?.path || `output/${slug(spec.name)}.${format}` };
}

/** Steps that read an additional source file (join / lookup / append). */
export function sideSteps(spec: PipelineSpec) {
  return spec.steps.filter((s): s is Extract<Step, { type: "join" | "append" }> => s.type === "join" || s.type === "append");
}

export function configObject(spec: PipelineSpec, opts: GenOptions = {}) {
  return {
    source: sourceConfig(spec.source!),
    ...(sideSteps(spec).length ? { sources: Object.fromEntries(sideSteps(spec).map((s) => [s.id, sourceConfig(s.source)])) } : {}),
    output: outputConfig(spec, opts),
    review_output: "output/review_items.csv",
  };
}

export function generatePython(spec: PipelineSpec, opts: GenOptions = {}): string {
  const version = opts.version ?? 1;
  const when = (opts.generatedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 19);
  const steps = spec.steps.map((s, i) => generateStep(s, i));
  const calls = spec.steps.flatMap((s, i) => [
    ...(isReshaping(s) ? [`    df = hold_for_review(df)  # rows with open issues are held before row identity changes`] : []),
    `    df = ${stepFunctionName(s, i)}(df)`,
  ]);
  const decisions = spec.reviewDecisions.map((d) => ({
    row: d.row,
    column: d.column,
    action: d.action,
    ...(d.value !== undefined ? { value: d.value } : {}),
    ...(d.fingerprint !== undefined ? { fingerprint: d.fingerprint } : {}),
  }));
  const usesDb = spec.destination?.type === "database";

  return `"""
${spec.name} — generated by FORMA
Pipeline version: v${version}
Generated on: ${when} UTC

Shape messy data into reliable pipelines. Your pipeline. Your code. Your data.

Usage:
    pip install -r requirements.txt
    python pipeline.py                         # uses config.yaml / defaults below
    python pipeline.py --source new_file.xlsx  # rerun on a compatible file
    python pipeline.py --check expected/forma_output.csv  # verify parity with FORMA

Credentials are never written into this file. Database destinations read
their connection URL from an environment variable (see config).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
from datetime import date, datetime, time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent

# Defaults; config.yaml (if present) and command-line flags override these.
CONFIG = ${pyLit(configObject(spec, opts))}

# Review decisions recorded in FORMA. A decision only applies while the source
# row still has exactly the same content it had when the decision was made.
REVIEW_DECISIONS: list[dict] = ${decisions.length ? pyLit(decisions) : "[]"}

RULE_RESULTS: list[dict] = []
RUN_STATS: dict = {}


${runtimePython()}

# ---------------------------------------------------------------------------
# Pipeline steps (in the same order as the FORMA pipeline)
# ---------------------------------------------------------------------------

${steps.join("\n\n\n")}


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def run(config: dict = CONFIG):
    """Execute the pipeline. Returns (output, review_items)."""
    for state in (ISSUES, FINGERPRINTS, RULE_RESULTS, HELD["review"], HELD["excluded"], RUN_CONFIG):
        state.clear()
    RUN_CONFIG.update(config)
    df = load_source(config["source"])
    NEXT_ROW_ID[0] = int(max(df.index)) + 1 if len(df) else 1
${calls.join("\n") || "    pass"}
    output, review_ids, excluded_ids = apply_review_gate(df, REVIEW_DECISIONS)
    review_ids = HELD["review"] + review_ids
    excluded_ids = HELD["excluded"] + excluded_ids
    RUN_STATS.update(review_ids=review_ids, excluded_ids=excluded_ids)
    review_set = set(review_ids)
    review = pd.DataFrame([i for i in ISSUES if i["row"] in review_set], columns=["row", "column", "step", "kind", "message", "value"])
    print(f"Loaded {len(output)} rows · {len(review_ids)} rows need review · {len(excluded_ids)} excluded", file=sys.stderr)
    return output, review


def write_output(output: pd.DataFrame, review: pd.DataFrame, config: dict = CONFIG) -> None:
    target = config["output"]
    if target["type"] == "database":
${
  usesDb
    ? `        from sqlalchemy import create_engine

        url = os.environ.get(target["url_env"])
        if not url:
            raise SystemExit(f"Set the {target['url_env']} environment variable to the database URL.")
        schema, _, table = target["table"].rpartition(".")
        output.to_sql(table, create_engine(url), schema=schema or None, if_exists=target.get("if_exists", "append"), index=False)`
    : `        raise SystemExit("Database output requires sqlalchemy; regenerate the project with a database destination.")`
}
    else:
        path = HERE / target["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        text = output.apply(lambda s: s.map(to_text))
        if target["format"] == "xlsx":
            output.to_excel(path, index=False)
        elif target["format"] == "json":
            text.where(text.notna(), None).to_json(path, orient="records", indent=2, force_ascii=False)
        else:
            text.to_csv(path, index=False)
        print(f"Wrote {path}", file=sys.stderr)
    if len(review):
        review_path = HERE / config["review_output"]
        review_path.parent.mkdir(parents=True, exist_ok=True)
        review.to_csv(review_path, index=False)
        print(f"Wrote {review_path}", file=sys.stderr)


def check_parity(output: pd.DataFrame, expected_csv: str) -> bool:
    """Compare this run's output with FORMA's output (exported as CSV), cell by cell."""
    with open(expected_csv, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    header, body = rows[0], rows[1:]
    problems = []
    if header != list(output.columns):
        problems.append(f"columns differ: FORMA {header} vs Python {list(output.columns)}")
    if len(body) != len(output):
        problems.append(f"row count differs: FORMA {len(body)} vs Python {len(output)}")
    for r, (want, got) in enumerate(zip(body, output.itertuples(index=False, name=None))):
        got_text = [to_text(v) or "" for v in got]
        if want != got_text:
            problems.append(f"row {r + 1}: FORMA {want} vs Python {got_text}")
        if len(problems) > 10:
            break
    if problems:
        print("Parity check FAILED:", *problems, sep="\\n  ", file=sys.stderr)
        return False
    print(f"Parity check passed: {len(output)} rows x {len(output.columns)} columns match FORMA exactly.", file=sys.stderr)
    return True


def load_config() -> dict:
    config = json.loads(json.dumps(CONFIG))
    config_file = HERE / "config.yaml"
    if config_file.exists():
        import yaml

        loaded = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
        for key, value in loaded.items():
            if isinstance(value, dict) and isinstance(config.get(key), dict):
                config[key].update(value)
            else:
                config[key] = value
    return config


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=${pyStr(spec.name)})
    parser.add_argument("--source", help="path to a compatible source file")
    parser.add_argument("--output", help="output file path (file destinations)")
    parser.add_argument("--check", metavar="EXPECTED_CSV", help="compare the output with FORMA's exported output and exit")
    args = parser.parse_args(argv)
    config = load_config()
    if args.source:
        config["source"]["path"] = args.source
    if args.output:
        config["output"]["path"] = args.output
    output, review = run(config)
    if args.check:
        sys.exit(0 if check_parity(output, args.check) else 1)
    write_output(output, review, config)


if __name__ == "__main__":
    main()
`;
}

export function generateRequirements(spec: PipelineSpec): string {
  const lines = ["pandas>=2.1", "numpy>=1.24", "pyyaml>=6.0"];
  if (spec.source?.type === "excel" || sideSteps(spec).some((s) => s.source.type === "excel") || spec.destination?.format === "xlsx") lines.push("openpyxl>=3.1");
  if (spec.destination?.type === "database") lines.push("sqlalchemy>=2.0", "psycopg2-binary>=2.9");
  return lines.join("\n") + "\n";
}

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}

export function generateConfigYaml(spec: PipelineSpec, opts: GenOptions = {}): string {
  const cfg = configObject(spec, opts) as Record<string, unknown>;
  const lines = [`# ${spec.name} — FORMA configuration`, `# Credentials are never stored here: use environment variables.`, ""];
  const walk = (obj: Record<string, unknown>, indent: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = /^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        lines.push(`${indent}${key}:`);
        walk(v as Record<string, unknown>, indent + "  ");
      } else lines.push(`${indent}${key}: ${yamlScalar(v)}`);
    }
  };
  walk(cfg, "");
  return lines.join("\n") + "\n";
}

export function generateReadme(spec: PipelineSpec, opts: GenOptions = {}): string {
  const out = outputConfig(spec, opts);
  const stepsList = [`01. **Source** — ${spec.source?.file ?? "source"}`, ...spec.steps.map((s, i) => `${String(i + 2).padStart(2, "0")}. **${STAGE_OF[s.type]}** — ${stepTitle(s)}`)].join("\n");
  return `# ${spec.name}

Generated by **FORMA** (pipeline version v${opts.version ?? 1}).

## Setup

\`\`\`bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
\`\`\`

## Run

\`\`\`bash
python pipeline.py                          # uses config.yaml
python pipeline.py --source path/to/new.${spec.source?.type === "excel" ? "xlsx" : spec.source?.type ?? "csv"}   # rerun on a compatible file
\`\`\`

Place the source file (\`${spec.source?.file ?? "source"}\`)${sideSteps(spec).length ? ` and ${[...new Set(sideSteps(spec).map((s) => `\`${s.source.file}\``))].join(", ")}` : ""} next to \`pipeline.py\` or pass \`--source\`.

${
  out.type === "database"
    ? `## Credentials\n\nSet \`${(out as { url_env: string }).url_env}\` to a SQLAlchemy database URL before running. Credentials are **not** included in this export.\n`
    : `Output is written to \`${(out as { path: string }).path}\`.`
}
Rows that need review are written to \`output/review_items.csv\` instead of being loaded.

## Steps

${stepsList || "_No steps yet._"}

## Files

| File | Purpose |
| --- | --- |
| \`pipeline.py\` | Pipeline code — one function per FORMA step |
| \`requirements.txt\` | Python dependencies |
| \`config.yaml\` | Source, output and review settings |
| \`pipeline.json\` | FORMA pipeline specification (source of truth) |
`;
}

export function generatePipelineJson(spec: PipelineSpec, version = 1): string {
  return JSON.stringify({ formaSpec: 1, version, ...spec }, null, 2) + "\n";
}
