"""Parity harness: run a generated FORMA pipeline and dump canonical output."""
import importlib.util
import json
import sys
from pathlib import Path

case = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("pipeline", case / "pipeline.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
config = mod.load_config()


def dump(output):
    return {
        "columns": list(output.columns),
        "rowIds": [int(i) for i in output.index],
        "rows": [[mod.to_text(v) for v in row] for row in output.itertuples(index=False, name=None)],
    }


if hasattr(mod, "run_all"):
    # Graph pipeline: every Load's output. Source paths resolve next to pipeline.py.
    outputs, review = mod.run_all(config)
    result = {"loads": {k: dump(v) for k, v in outputs.items()}}
    first = next(iter(outputs.values()))
else:
    config["source"]["path"] = str(case / config["source"]["path"])
    first, review = mod.run(config)
    result = {}
result.update(dump(first))
result.update(
    {
        "reviewRows": mod.RUN_STATS["review_ids"],
        "excludedRows": mod.RUN_STATS["excluded_ids"],
        "issues": len(mod.ISSUES),
        "issueKeys": [[i["row"], i["column"], i["step"], i["kind"]] for i in mod.ISSUES],
        "rules": mod.RULE_RESULTS,
    }
)
json.dump(result, open(case / "python.json", "w"), ensure_ascii=False)
