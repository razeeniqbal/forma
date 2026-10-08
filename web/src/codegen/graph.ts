// Readable Python for graph pipelines (GRAPH_ENGINE_DESIGN.md §10). One function per node, plain DataFrames,
// and a driver that reads like the pipeline. A small @node decorator mirrors engine/graph/execute.ts: it gates
// a node's inputs and carries the review issues of each path. Keep the two in lock-step.
import type { Destination } from "@/engine/types";
import { isReshaping } from "@/engine/execute";
import { stageOf, stepTitle } from "@/engine/registry";
import { asStep, executionOrder, inputsOf, nodeById, nodeTitle, stepOf } from "@/engine/graph/model";
import { RANK_BASE, type GraphNode, type LoadNode, type PipelineSpecV2, type SourceNode, type StepNode } from "@/engine/graph/types";
import { generateStep, pyLit, pyStr, slug, sourceConfig, stepFunctionName, type GenOptions } from "./python";
import { runtimePython } from "./runtime";

const RESERVED = new Set(
  "df other others pd np re os sys csv io json math date datetime time config outputs column node functools and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield none true false".split(" "),
);

function graphRuntime(): string {
  return String.raw`# ---------------------------------------------------------------------------
# FORMA graph runtime
# Each node is a function decorated with @node. Before it runs, the decorator
# holds rows with open review issues where FORMA does (before steps that change
# row identity, and on the second input of a join, lookup or append), and it
# carries the review issues raised along each path, so a row flagged in one
# branch is not held in another.
# ---------------------------------------------------------------------------

RANK_BASE = ${RANK_BASE}
NODE_ISSUES: dict = {}


def issue_key(i: dict) -> tuple:
    return (i["row"], i["column"], i["step"], i["kind"], i["message"])


def merge_issues(lists: list) -> list:
    """Issues of a node's inputs: the primary input's as they are, then any not already present."""
    if not lists:
        return []
    out = [dict(i) for i in lists[0]]
    seen = {issue_key(i) for i in out}
    for issues in lists[1:]:
        for i in issues:
            key = issue_key(i)
            if key not in seen:
                seen.add(key)
                out.append(dict(i))
    return out


def review_gate(df: pd.DataFrame, issues: list) -> pd.DataFrame:
    """Hold rows with open issues on this path; apply recorded review decisions."""
    ISSUES[:] = issues
    out, review_ids, excluded_ids = apply_review_gate(df, REVIEW_DECISIONS)
    HELD["review"].extend(review_ids)
    HELD["excluded"].extend(excluded_ids)
    return out


def node(node_id: str):
    """Run a function as pipeline node node_id (see NODES)."""

    def wrap(fn):
        @functools.wraps(fn)
        def run(*inputs):
            spec = NODES[node_id]
            inputs = [review_gate(df, NODE_ISSUES[src]) if gate else df for df, src, gate in zip(inputs, spec["inputs"], spec["gates"])]
            ISSUES[:] = merge_issues([NODE_ISSUES[src] for src in spec["inputs"]])
            out = fn(*inputs)
            NODE_ISSUES[node_id] = list(ISSUES)
            return out

        return run

    return wrap


def read_source(node_id: str) -> pd.DataFrame:
    """Load a source node. Rank 0 keeps source row numbers as row ids; rank k uses k * RANK_BASE + row number."""
    rank = NODES[node_id]["rank"]
    df = load_source(RUN_CONFIG["sources"][node_id], record=False)
    if rank:
        df.index = [rank * RANK_BASE + int(i) for i in df.index]
    for row_id, values in zip(df.index, df.itertuples(index=False, name=None)):
        FINGERPRINTS[int(row_id)] = fingerprint(list(values))
    if rank == 0:
        NEXT_ROW_ID[0] = int(max(df.index)) + 1 if len(df) else 1
    return df`;
}

/** Python names for every node: functions and the driver's dataset variables. */
function names(spec: PipelineSpecV2, order: string[]) {
  const { graph } = spec;
  const used = new Set<string>();
  const unique = (base: string) => {
    let b = base || "data";
    if (/^\d/.test(b)) b = `data_${b}`;
    if (RESERVED.has(b)) b = `${b}_data`;
    let n = b;
    for (let k = 2; used.has(n); k++) n = `${b}_${k}`;
    used.add(n);
    return n;
  };
  const fn = new Map<string, string>();
  const stepIndex = new Map<string, number>();
  let k = 0;
  for (const id of order) {
    const n = nodeById(graph, id)!;
    if (n.kind === "step") {
      stepIndex.set(id, k);
      fn.set(id, unique(stepFunctionName(stepOf(graph, n), k++)));
    } else if (n.kind === "source") fn.set(id, unique(`read_${slug(n.source.file.replace(/\.[^.]+$/, "")) || "source"}`));
    else fn.set(id, unique(`load_${slug((n.destination?.type === "database" ? n.destination.table : n.destination?.path?.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "")) || "output")}`));
  }
  // Dataset variables: a chain keeps one variable; a fan-out or merge result that cannot reuse its input gets a new one.
  const outdeg = (id: string) => graph.edges.filter((e) => e.from === id).length;
  const variable = new Map<string, string>();
  for (const id of order) {
    const n = nodeById(graph, id)!;
    if (n.kind === "load") continue;
    const primary = inputsOf(graph, id)[0]?.from;
    if (n.kind === "step" && primary && outdeg(primary) === 1 && variable.has(primary)) variable.set(id, variable.get(primary)!);
    else variable.set(id, unique(n.kind === "source" ? slug(n.source.file.replace(/\.[^.]+$/, "")) : slug(nodeTitle(n, graph))));
  }
  return { fn, variable, stepIndex };
}

function loadTarget(d: Destination | null, spec: PipelineSpecV2, opts: GenOptions) {
  if (d?.type === "database") return { type: "database", url_env: opts.connectionEnv ?? "WAREHOUSE_URL", table: d.table ?? slug(spec.name), if_exists: d.ifExists ?? "append" };
  const format = d?.format ?? "csv";
  return { type: "file", format, path: d?.path || `output/${slug(spec.name)}.${format}` };
}

export function graphConfigObject(spec: PipelineSpecV2, opts: GenOptions = {}) {
  const sources = spec.graph.nodes.filter((n): n is SourceNode => n.kind === "source").sort((a, b) => a.rank - b.rank);
  const loads = spec.graph.nodes.filter((n): n is LoadNode => n.kind === "load").sort((a, b) => a.order - b.order);
  return {
    sources: Object.fromEntries(sources.map((s) => [s.id, sourceConfig(s.source)])),
    outputs: Object.fromEntries(loads.map((l) => [l.id, loadTarget(l.destination, spec, opts)])),
    review_output: "output/review_items.csv",
  };
}

function nodeTable(spec: PipelineSpecV2, order: string[], fn: Map<string, string>): string {
  const { graph } = spec;
  const rows = order.map((id) => {
    const n = nodeById(graph, id)!;
    const ins = inputsOf(graph, id).map((e) => e.from);
    const gates = ins.map((_, k) => (n.kind === "load" ? true : n.kind === "step" ? k > 0 || isReshaping(asStep(n.step)) : false));
    const label = n.kind === "step" ? `${stageOf(stepOf(graph, n))}: ${stepTitle(stepOf(graph, n))}` : n.kind === "source" ? `Source: ${nodeTitle(n)}` : "Load";
    const extra = n.kind === "source" ? `, "rank": ${n.rank}` : "";
    return `    ${pyStr(id)}: {"kind": ${pyStr(n.kind)}, "label": ${pyStr(label)}, "function": ${pyStr(fn.get(id)!)}, "inputs": ${pyLit(ins)}, "gates": ${pyLit(gates)}${extra}},`;
  });
  return `# Every node: its inputs (primary first) and whether rows with open issues are held before each input.\nNODES = {\n${rows.join("\n")}\n}`;
}

function nodeFunction(spec: PipelineSpecV2, n: GraphNode, fnName: string, stepIndex: number | undefined): string {
  const deco = `@node(${pyStr(n.id)})`;
  if (n.kind === "source")
    return [`# Source: ${nodeTitle(n)}`, deco, `def ${fnName}() -> pd.DataFrame:`, `    """Read ${n.source.file}${n.source.sheet ? ` (sheet ${n.source.sheet})` : ""}."""`, `    return read_source(${pyStr(n.id)})`].join("\n");
  if (n.kind === "load")
    return [`# Load: rows that pass review`, deco, `def ${fnName}(df: pd.DataFrame) -> pd.DataFrame:`, `    """Rows reaching this Load after its review gate."""`, `    return df`].join("\n");
  const step = stepOf(spec.graph, n);
  const others = inputsOf(spec.graph, n.id).slice(1);
  if (step.type === "append") {
    const mapping = Object.entries(step.mapping ?? {}).filter(([from, to]) => to && from !== to);
    const num = String(stepIndex! + 2).padStart(2, "0");
    return [
      `# ${num} ${stageOf(step)}: ${stepTitle(step)}`,
      deco,
      `def ${fnName}(df: pd.DataFrame, *others: pd.DataFrame) -> pd.DataFrame:`,
      `    """Stack the rows of ${others.map((e) => nodeTitle(nodeById(spec.graph, e.from)!, spec.graph)).join(", ") || "the other datasets"} below; columns are matched by name."""`,
      `    for other in others:`,
      ...(mapping.length ? [`        # Schema mapping: appended column -> pipeline column`, `        other = rename_appended(other, {${mapping.map(([a, b]) => `${pyStr(a)}: ${pyStr(b)}`).join(", ")}})`] : []),
      `        df = append_rows(df, other)`,
      `    return df`,
    ].join("\n");
  }
  const otherName = others[0] ? nodeTitle(nodeById(spec.graph, others[0].from)!, spec.graph) : "";
  // generateStep names functions by step index; the driver's name may carry a suffix if two titles collide.
  return generateStep(step, stepIndex!, { otherName, decorator: deco }).replace(`def ${stepFunctionName(step, stepIndex!)}(`, `def ${fnName}(`);
}

export function generateGraphPython(spec: PipelineSpecV2, opts: GenOptions = {}): string {
  const version = opts.version ?? 1;
  const when = (opts.generatedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 19);
  const { graph } = spec;
  const order = executionOrder(graph);
  const { fn, variable, stepIndex } = names(spec, order);
  const functions = order.map((id) => nodeFunction(spec, nodeById(graph, id)!, fn.get(id)!, stepIndex.get(id)));
  const driver = order.map((id) => {
    const n = nodeById(graph, id)!;
    const args = inputsOf(graph, id).map((e) => variable.get(e.from)!).join(", ");
    if (n.kind === "load") return `    outputs[${pyStr(id)}] = ${fn.get(id)}(${args})`;
    const note = n.kind === "step" && isReshaping(asStep((n as StepNode).step)) ? "  # rows with open issues are held before row identity changes" : "";
    return `    ${variable.get(id)} = ${fn.get(id)}(${args})${note}`;
  });
  const decisions = spec.reviewDecisions.map((d) => ({
    row: d.row,
    column: d.column,
    action: d.action,
    ...(d.value !== undefined ? { value: d.value } : {}),
    ...(d.fingerprint !== undefined ? { fingerprint: d.fingerprint } : {}),
  }));
  const usesDb = graph.nodes.some((n) => n.kind === "load" && n.destination?.type === "database");
  const primary = graph.nodes.find((n): n is SourceNode => n.kind === "source" && n.rank === 0);

  return `"""
${spec.name}, generated by FORMA
Pipeline version: v${version}
Generated on: ${when} UTC

Shape messy data into reliable pipelines. Your pipeline. Your code. Your data.

Usage:
    pip install -r requirements.txt
    python pipeline.py                         # uses config.yaml / defaults below
    python pipeline.py --source new_file.xlsx  # rerun on a compatible main source
    python pipeline.py --check expected/forma_output.csv  # verify parity with FORMA

Credentials are never written into this file. Database sources and destinations
read their connection URL from an environment variable (see config).
"""
from __future__ import annotations

import argparse
import csv
import functools
import io
import json
import math
import os
import re
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent

# Defaults; config.yaml (if present) and command-line flags override these.
CONFIG = ${pyLit(graphConfigObject(spec, opts))}

# Review decisions recorded in FORMA. A decision only applies while the source
# row still has exactly the same content it had when the decision was made.
REVIEW_DECISIONS: list[dict] = ${decisions.length ? pyLit(decisions) : "[]"}

RULE_RESULTS: list[dict] = []
RUN_STATS: dict = {}


${runtimePython()}


${graphRuntime()}


${nodeTable(spec, order, fn)}


# ---------------------------------------------------------------------------
# Pipeline nodes (in execution order)
# ---------------------------------------------------------------------------

${functions.join("\n\n\n")}


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------


def start_run(config: dict = CONFIG) -> None:
    """Reset run state."""
    for state in (ISSUES, FINGERPRINTS, RULE_RESULTS, HELD["review"], HELD["excluded"], RUN_CONFIG, NODE_ISSUES):
        state.clear()
    RUN_CONFIG.update(config)
    NEXT_ROW_ID[0] = 1


def run_all(config: dict = CONFIG):
    """Execute the pipeline. Returns ({load id: output}, review_items)."""
    start_run(config)
    outputs: dict = {}
${driver.join("\n")}
    return finish_run(outputs)


def run(config: dict = CONFIG):
    """Execute the pipeline. Returns (output of the first Load, review_items)."""
    outputs, review = run_all(config)
    return next(iter(outputs.values())), review


def finish_run(outputs: dict):
    """Collect the run: rows held for review and excluded, across every gate."""
    review_ids = list(dict.fromkeys(HELD["review"]))
    excluded_ids = list(dict.fromkeys(HELD["excluded"]))
    ISSUES[:] = merge_issues([NODE_ISSUES[NODES[load_id]["inputs"][0]] for load_id in outputs])
    # The main Load first: run() and orchestrators treat the first output as the pipeline's output.
    if "load" in outputs:
        outputs = {"load": outputs["load"], **{k: v for k, v in outputs.items() if k != "load"}}
    RUN_STATS.update(review_ids=review_ids, excluded_ids=excluded_ids)
    review_set = set(review_ids)
    review = pd.DataFrame([i for i in ISSUES if i["row"] in review_set], columns=["row", "column", "step", "kind", "message", "value"])
    loaded = sum(len(o) for o in outputs.values())
    print(f"Loaded {loaded} rows · {len(review_ids)} rows need review · {len(excluded_ids)} excluded", file=sys.stderr)
    return outputs, review


def write_outputs(outputs: dict, review: pd.DataFrame, config: dict = CONFIG) -> None:
    for load_id, output in outputs.items():
        target = config["outputs"][load_id]
        if target["type"] == "database":
${
  usesDb
    ? `            from sqlalchemy import create_engine

            url = os.environ.get(target["url_env"])
            if not url:
                raise SystemExit(f"Set the {target['url_env']} environment variable to the database URL.")
            schema, _, table = target["table"].rpartition(".")
            output.to_sql(table, create_engine(url), schema=schema or None, if_exists=target.get("if_exists", "append"), index=False)`
    : `            raise SystemExit("Database output requires sqlalchemy; regenerate the project with a database destination.")`
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
    """Compare the first Load's output with FORMA's output (exported as CSV), cell by cell."""
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
    parser.add_argument("--source", help="path to a compatible file for the main source")
    parser.add_argument("--check", metavar="EXPECTED_CSV", help="compare the first output with FORMA's exported output and exit")
    args = parser.parse_args(argv)
    config = load_config()
    if args.source:
        config["sources"][${pyStr(primary?.id ?? "source")}]["path"] = args.source
    outputs, review = run_all(config)
    if args.check:
        sys.exit(0 if check_parity(next(iter(outputs.values())), args.check) else 1)
    write_outputs(outputs, review, config)


if __name__ == "__main__":
    main()
`;
}
