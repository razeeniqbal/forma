import json
import sqlite3
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from forma_server import ai, sources
from forma_server.app import create_app
from forma_server.settings import Settings

# A minimal pipeline with the same interface FORMA generates (STEPS, start_run,
# finish_run, write_output, ...). Real generated pipelines are covered by the
# web parity suite (tests/parity/server.test.ts).
PIPELINE_PY = '''
import csv, os
from pathlib import Path
HERE = Path(__file__).resolve().parent
ISSUES, FINGERPRINTS, RULE_RESULTS, RUN_STATS = [], {}, [], {}
import pandas as pd

def to_text(v):
    return None if v is None else str(v)

def hold_for_review(df):
    return df

def start_run(config):
    rows = list(csv.reader(open(config["source"]["path"])))
    df = pd.DataFrame(rows[1:], columns=rows[0], index=range(2, len(rows) + 1), dtype=object)
    for i, r in zip(df.index, rows[1:]):
        FINGERPRINTS[i] = "\\u241f".join(r)
    return df

def step_02_double(df):
    df = df.copy()
    df["double"] = [int(v) * 2 if v.isdigit() else None for v in df["n"]]
    for i, v in zip(df.index, df["n"]):
        if not v.isdigit():
            ISSUES.append({"row": i, "column": "n", "step": "s1", "kind": "invalid_number", "message": "bad", "value": v})
    return df

def step_03_fail(df):
    if os.environ.get("FORMA_TEST_FAIL"):
        raise ValueError("boom")
    return df

STEPS = [("02 Clean — Double", step_02_double, False), ("03 Transform — Maybe fail", step_03_fail, False)]

def finish_run(df):
    bad = {i["row"] for i in ISSUES}
    RUN_STATS.update(review_ids=sorted(bad), excluded_ids=[])
    return df[[i not in bad for i in df.index]], pd.DataFrame(ISSUES)

def write_output(output, review, config):
    path = HERE / config["output"]["path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(path, index=False)
'''


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    settings = Settings(data_dir=tmp_path / "data")
    with TestClient(create_app(settings)) as c:
        yield c


def wait(client, run_id, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"/api/runs/{run_id}").json()
        if r["status"] != "running":
            return r
        time.sleep(0.1)
    raise TimeoutError(run_id)


def sync(client, schedule=None):
    client.put("/api/files/f1", params={"name": "data.csv"}, content=b"n,label\n1,a\n2,b\nx,c\n").raise_for_status()
    body = {
        "name": "Demo",
        "version": 3,
        "pipeline_py": PIPELINE_PY,
        "config": {"source": {"type": "csv", "path": "data.csv", "header_row": 0, "start_col": 0, "end_col": 1}, "output": {"type": "file", "format": "csv", "path": "output/demo.csv"}, "review_output": "output/review.csv"},
        "files": {"source": "f1"},
        "schedule": schedule,
    }
    r = client.put("/api/pipelines/p1", json=body)
    r.raise_for_status()
    return r.json()


def test_health_reports_features(client):
    h = client.get("/api/health").json()
    assert h["ok"] and h["features"]["ai"] is False and h["features"]["scheduler"] is True


def test_run_records_steps_review_and_output(client):
    sync(client)
    run = client.post("/api/pipelines/p1/runs", json={"trigger": "manual"}).json()
    assert run["status"] == "running"
    done = wait(client, run["id"])
    res = done["result"]
    assert done["status"] == "review", done
    assert res["rows_in"] == 3 and res["rows_out"] == 2 and res["review_count"] == 1
    assert [s["title"] for s in res["steps"]] == ["Double", "Maybe fail"]
    assert res["steps"][0]["issues"] == 1
    assert res["review_source"]["4"] == ["x", "c"]
    assert res["review_values"]["4"]["n"] == "x"
    out = client.get(f"/api/runs/{run['id']}/output")
    assert out.status_code == 200 and out.text.splitlines()[0] == "n,label,double"
    assert [r["id"] for r in client.get("/api/runs", params={"pipeline_id": "p1"}).json()] == [run["id"]]


def test_failing_step_marks_run_failed(client, monkeypatch):
    monkeypatch.setenv("FORMA_TEST_FAIL", "1")
    sync(client)
    done = wait(client, client.post("/api/pipelines/p1/runs").json()["id"])
    assert done["status"] == "failed" and "boom" in done["error"]
    assert done["result"]["steps"][-1]["error"] == "boom"


def test_sync_requires_uploaded_files(client):
    r = client.put("/api/pipelines/p2", json={"name": "x", "version": 1, "pipeline_py": "", "config": {}, "files": {"source": "missing"}})
    assert r.status_code == 409


def test_schedule_is_registered_and_validated(client):
    info = sync(client, {"cron": "0 6 * * 1-5", "enabled": True})
    assert info["nextRun"] and info["nextRun"].endswith("+00:00")
    assert client.get("/api/pipelines").json()[0]["schedule"] == {"cron": "0 6 * * 1-5", "enabled": True}
    bad = client.put("/api/pipelines/p1", json={"name": "x", "version": 1, "pipeline_py": "", "config": {}, "schedule": {"cron": "every day"}})
    assert bad.status_code == 422


def test_scheduled_trigger_runs_pipeline(client):
    sync(client)
    jobs = client.app.state.jobs
    run_id = jobs.trigger_run("p1", "schedule")  # what the cron job calls
    assert wait(client, run_id)["trigger"] == "schedule"


def test_auth_token(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMA_API_TOKEN", "s3cret")
    with TestClient(create_app(Settings(data_dir=tmp_path / "d"))) as c:
        assert c.get("/api/runs").status_code == 401
        assert c.get("/api/runs", headers={"Authorization": "Bearer s3cret"}).status_code == 200
        assert c.get("/api/health").status_code == 200


def test_database_source_snapshot(client, tmp_path, monkeypatch):
    db = tmp_path / "wh.db"
    con = sqlite3.connect(db)
    con.execute("create table invoices (no text, amount numeric, due date)")
    con.executemany("insert into invoices values (?, ?, ?)", [("INV-1", 4500.5, "2026-10-15"), ("INV-2", None, None)])
    con.commit()
    monkeypatch.setenv("WAREHOUSE_URL", f"sqlite:///{db}")
    r = client.post("/api/sources/query", json={"kind": "database", "url_env": "WAREHOUSE_URL", "query": "select * from invoices order by no"}).json()
    assert r["grid"] == [["no", "amount", "due"], ["INV-1", 4500.5, "2026-10-15"], ["INV-2", None, None]]
    assert client.post("/api/connections/test", json={"url_env": "WAREHOUSE_URL"}).json() == {"ok": True}
    missing = client.post("/api/connections/test", json={"url_env": "NOPE_URL"}).json()
    assert missing["ok"] is False and "NOPE_URL" in missing["error"]


def test_google_sheet_url():
    assert sources.google_sheet_csv_url("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=42") == "https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=42"
    assert sources.google_sheet_csv_url("https://example.com/x.json") == "https://example.com/x.json"


def test_records_to_grid_matches_generated_code():
    assert sources.records_to_grid([{"a": 1, "b": {"x": 1}}, {"c": ""}]) == [["a", "b", "c"], [1, '{"x":1}', None], [None, None, None]]


class FakeAI:
    def __init__(self, payload, stop_reason="end_turn"):
        self.calls = []
        self.payload, self.stop_reason = payload, stop_reason
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop_reason, content=[SimpleNamespace(type="text", text=json.dumps(self.payload))])


def test_ai_suggestions_are_validated_and_measured():
    fake = FakeAI(
        {
            "fields": [
                {"name": "Invoice No", "type": "text", "pattern": r"INV-?\d+", "explanation": "id"},
                {"name": "bad", "type": "text", "pattern": r"(?P<x>\d+)", "explanation": "python-only"},
                {"name": "total", "type": "number", "pattern": r"RM\s*([\d,.]+)", "explanation": "amount"},
            ]
        }
    )
    out = ai.suggest_patterns(["Inv #INV-1, Total RM 4,500", "INV2 RM 10", "nothing here"], client=fake)
    assert [f["name"] for f in out] == ["invoice_no", "total"]
    assert out[0]["sample_match_rate"] == pytest.approx(2 / 3)
    call = fake.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["fallbacks"] == "default"
    assert call["output_config"]["format"]["type"] == "json_schema"


def test_ai_refusal_and_endpoint(tmp_path):
    with pytest.raises(ai.AIError):
        ai.suggest_patterns(["x"], client=FakeAI({"fields": []}, stop_reason="refusal"))
    fake = FakeAI({"fields": [{"name": "id", "type": "text", "pattern": r"\d+", "explanation": ""}]})
    with TestClient(create_app(Settings(data_dir=tmp_path / "d"), ai_client=fake)) as c:
        r = c.post("/api/ai/extract-patterns", json={"samples": ["a 1", "b 2"]}).json()
        assert r["fields"][0]["sample_match_rate"] == 1.0
