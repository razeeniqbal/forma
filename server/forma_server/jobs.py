"""Run queue (thread pool + subprocess per run) and cron schedules."""
from __future__ import annotations

import copy
import json
import os
import secrets
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .settings import Settings
from .store import Store

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


class Jobs:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store
        self.pool = ThreadPoolExecutor(max_workers=settings.max_workers, thread_name_prefix="forma-run")
        self.scheduler = BackgroundScheduler(timezone="UTC")

    # -- scheduling ------------------------------------------------------
    def start(self) -> None:
        self.scheduler.start()
        for p in self.store.list_pipelines():
            self.schedule(p)

    def shutdown(self) -> None:
        self.scheduler.shutdown(wait=False)
        self.pool.shutdown(wait=False, cancel_futures=True)

    def schedule(self, pipeline: dict) -> None:
        job_id = f"pipeline:{pipeline['id']}"
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)
        if pipeline.get("schedule_enabled") and pipeline.get("schedule_cron"):
            self.scheduler.add_job(
                self.trigger_run,
                CronTrigger.from_crontab(pipeline["schedule_cron"], timezone="UTC"),
                args=[pipeline["id"], "schedule"],
                id=job_id,
                coalesce=True,
                misfire_grace_time=300,
                max_instances=1,
            )

    def next_run(self, pipeline_id: str) -> str | None:
        job = self.scheduler.get_job(f"pipeline:{pipeline_id}")
        return job.next_run_time.isoformat() if job and job.next_run_time else None

    # -- runs ------------------------------------------------------------
    def trigger_run(self, pipeline_id: str, trigger: str = "manual") -> str:
        pipeline = self.store.get_pipeline(pipeline_id)
        if not pipeline:
            raise KeyError(pipeline_id)
        now = datetime.now(timezone.utc)
        run_id = f"srv_{now.strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(2)}"
        run_dir = self.settings.data_dir / "runs" / run_id
        self._prepare(pipeline, run_dir)
        self.store.create_run(
            {"id": run_id, "pipeline_id": pipeline_id, "pipeline_name": pipeline["name"], "version": pipeline["version"], "trigger": trigger, "status": "running", "started_at": time.time()}
        )
        self.pool.submit(self._execute, run_id, run_dir)
        return run_id

    def _prepare(self, pipeline: dict, run_dir: Path) -> None:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "pipeline.py").write_text(pipeline["pipeline_py"], encoding="utf-8")
        config = copy.deepcopy(pipeline["config"])
        for key, file_id in (pipeline.get("files") or {}).items():
            f = self.store.get_file(file_id)
            if not f:
                raise FileNotFoundError(f"Source file {file_id} was not uploaded to the server")
            target = config["source"] if key == "source" else config["sources"][key.split(".", 1)[1]]
            target["path"] = f["path"]
        # Linear exports have one "output"; pipelines with connections have "outputs" by Load id.
        for target in [config["output"]] if "output" in config else config.get("outputs", {}).values():
            if target["type"] == "file":
                target["path"] = "output/" + Path(target["path"]).name
        (run_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")

    def _execute(self, run_id: str, run_dir: Path) -> None:
        env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(PACKAGE_ROOT), os.environ.get("PYTHONPATH")]))}
        error = None
        try:
            proc = subprocess.run(
                [self.settings.python, "-m", "forma_server.runner", str(run_dir)],
                capture_output=True,
                text=True,
                timeout=self.settings.run_timeout_s,
                env=env,
                cwd=run_dir,
            )
            (run_dir / "stderr.log").write_text(proc.stderr or "", encoding="utf-8")
        except subprocess.TimeoutExpired:
            error = f"Run exceeded the {self.settings.run_timeout_s}s time limit"
        result_path = run_dir / "result.json"
        result = json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else None
        if result is None:
            tail = (run_dir / "stderr.log").read_text(encoding="utf-8")[-2000:] if (run_dir / "stderr.log").exists() else ""
            error = error or f"Run crashed before producing a result. {tail}"
            self.store.update_run(run_id, status="failed", finished_at=time.time(), error=error)
            return
        self.store.update_run(run_id, status=result["status"], finished_at=time.time(), result=result, error=result.get("error"))
