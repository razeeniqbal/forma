"""Executes one pipeline run in an isolated subprocess.

    python -m forma_server.runner <run_dir>

<run_dir> holds the exact pipeline.py FORMA generated (the same file users
export) and config.json. Each FORMA step runs in order, with timings, row
counts and flagged values recorded per step, then the review gate and the
destination write. The result is written to <run_dir>/result.json.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
import traceback
from pathlib import Path

MAX_REVIEW_ROWS = 2000


def _load(run_dir: Path):
    spec = importlib.util.spec_from_file_location("pipeline", run_dir / "pipeline.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["pipeline"] = module
    spec.loader.exec_module(module)
    return module


def _json_value(p, v):
    """Plain JSON value for an issue (NaN/numpy/datetime become canonical text)."""
    if v is None or isinstance(v, (str, bool)) or (isinstance(v, (int, float)) and v == v and abs(v) != float("inf")):
        return v
    return p.to_text(v)


def execute(run_dir: Path) -> dict:
    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    result: dict = {"status": "running", "steps": [], "logs": [], "rows_in": 0, "rows_out": 0, "review_count": 0, "excluded_count": 0}

    def log(level: str, step: str, message: str) -> None:
        result["logs"].append({"t": time.time(), "level": level, "step": step, "message": message})

    started = time.time()
    try:
        p = _load(run_dir)
        gated = []
        hold = p.hold_for_review

        def recording_hold(df):
            gated.append(df.copy())
            return hold(df)

        p.hold_for_review = recording_hold
        log("info", "System", "Starting pipeline run on the FORMA server")
        df = p.start_run(config)
        source_columns = list(df.columns)
        result["rows_in"] = len(df)
        log("success", "Source", f"Loaded {len(df):,} rows, {len(df.columns)} columns")

        for label, fn, holds_review in p.STEPS:
            if holds_review:
                df = p.hold_for_review(df)
            rows_in, issues_before, t = len(df), len(p.ISSUES), time.time()
            title = label.split(" — ", 1)[-1]
            try:
                df = fn(df)
            except Exception as e:  # a failing step stops the run, like in FORMA
                result["steps"].append({"label": label, "title": title, "rows_in": rows_in, "rows_out": 0, "issues": 0, "duration_ms": (time.time() - t) * 1000, "error": str(e)})
                log("error", title, str(e))
                raise
            flagged = max(0, len(p.ISSUES) - issues_before)
            result["steps"].append({"label": label, "title": title, "rows_in": rows_in, "rows_out": len(df), "issues": flagged, "duration_ms": (time.time() - t) * 1000})
            if flagged:
                log("warning", title, f"{flagged:,} values flagged for review")
            else:
                log("success", title, f"{rows_in:,} → {len(df):,} rows")

        gated.append(df.copy())
        output, review = p.finish_run(df)
        p.write_output(output, review, config)
        review_ids = p.RUN_STATS["review_ids"]
        result.update(
            rows_out=len(output),
            review_count=len(review_ids),
            excluded_count=len(p.RUN_STATS["excluded_ids"]),
            columns=[str(c) for c in df.columns],
            source_columns=[str(c) for c in source_columns],
            rule_results=list(p.RULE_RESULTS),
        )
        # Review detail for the FORMA review queue.
        keep = set(review_ids[:MAX_REVIEW_ROWS])
        result["review_issues"] = [
            {"row": i["row"], "column": i["column"], "stepId": i["step"], "kind": i["kind"], "message": i["message"], "value": _json_value(p, i["value"])}
            for i in p.ISSUES
            if i["row"] in keep
        ][:5000]
        result["review_source"] = {str(r): [v if v != "" else None for v in p.FINGERPRINTS.get(r, "").split("␟")] for r in keep if r in p.FINGERPRINTS}
        values = {}
        for frame in reversed(gated):
            for r in keep - values.keys():
                if r in frame.index:
                    values[r] = {str(c): p.to_text(v) for c, v in frame.loc[r].items()}
        result["review_values"] = {str(r): v for r, v in values.items()}
        # Canonical text output for FORMA (download / view).
        output.apply(lambda s: s.map(p.to_text)).to_csv(run_dir / "forma_output.csv", index=False)
        target = config["output"]
        log("success", "Load", f"Loaded {len(output):,} rows to " + (target.get("table", "database") if target["type"] == "database" else target["path"]))
        if review_ids:
            log("warning", "Review", f"{len(review_ids):,} rows need review and were not loaded.")
        result["status"] = "review" if review_ids else "success"
    except Exception as e:
        result["status"] = "failed"
        result["error"] = str(e) or e.__class__.__name__
        result["traceback"] = traceback.format_exc()[-4000:]
        if not any(l["level"] == "error" for l in result["logs"]):
            log("error", "System", result["error"])
    result["duration_ms"] = (time.time() - started) * 1000
    log("error" if result["status"] == "failed" else "info", "System", "Pipeline failed." if result["status"] == "failed" else f"Pipeline completed in {result['duration_ms'] / 1000:.1f} seconds.")
    (run_dir / "result.json").write_text(json.dumps(result, default=str), encoding="utf-8")
    return result


if __name__ == "__main__":
    res = execute(Path(sys.argv[1]))
    sys.exit(1 if res["status"] == "failed" else 0)
