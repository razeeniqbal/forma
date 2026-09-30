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
config["source"]["path"] = str(case / config["source"]["path"])
output, review = mod.run(config)
json.dump(
    {
        "columns": list(output.columns),
        "rowIds": [int(i) for i in output.index],
        "rows": [[mod.to_text(v) for v in row] for row in output.itertuples(index=False, name=None)],
        "reviewRows": mod.RUN_STATS["review_ids"],
        "excludedRows": mod.RUN_STATS["excluded_ids"],
        "issues": len(mod.ISSUES),
        "rules": mod.RULE_RESULTS,
    },
    open(case / "python.json", "w"),
    ensure_ascii=False,
)
