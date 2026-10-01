"""FORMA server HTTP API."""
from __future__ import annotations

import hmac
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import __version__, ai, sources
from .jobs import Jobs
from .settings import Settings
from .store import Store


class ScheduleIn(BaseModel):
    cron: str
    enabled: bool = True


class PipelineIn(BaseModel):
    name: str
    version: int
    pipeline_py: str = Field(description="Generated pipeline.py (exactly what FORMA exports)")
    config: dict
    files: dict[str, str] = Field(default_factory=dict, description='{"source" | "sources.<step id>": file id}')
    schedule: ScheduleIn | None = None


class RunIn(BaseModel):
    trigger: Literal["manual", "schedule", "api"] = "manual"


class QueryIn(BaseModel):
    kind: Literal["database", "api"]
    url_env: str | None = None
    query: str | None = None
    url: str | None = None
    format: Literal["json", "csv"] = "json"
    token_env: str | None = None
    limit: int | None = 100000


class ConnectionTestIn(BaseModel):
    url_env: str


class SuggestIn(BaseModel):
    samples: list[str]
    hint: str | None = None


def create_app(settings: Settings | None = None, ai_client=None) -> FastAPI:
    settings = settings or Settings()
    store = Store(settings.database_url)
    jobs = Jobs(settings, store)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        jobs.start()
        yield
        jobs.shutdown()

    app = FastAPI(title="FORMA server", version=__version__, lifespan=lifespan)
    app.state.settings, app.state.store, app.state.jobs = settings, store, jobs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def auth(authorization: str | None = Header(default=None)) -> None:
        if not settings.api_token:
            return
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(token, settings.api_token):
            raise HTTPException(401, "Invalid or missing API token")

    def run_view(r: dict) -> dict:
        return {
            "id": r["id"],
            "pipelineId": r["pipeline_id"],
            "pipelineName": r["pipeline_name"],
            "version": r["version"],
            "trigger": r["trigger"],
            "status": r["status"],
            "startedAt": r["started_at"],
            "finishedAt": r["finished_at"],
            "error": r["error"],
            "result": r["result"],
        }

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__, "features": {"ai": settings.ai_enabled, "scheduler": True, "database": True, "api": True}, "auth": bool(settings.api_token)}

    @app.put("/api/files/{file_id}", dependencies=[Depends(auth)])
    async def put_file(file_id: str, request: Request, name: str):
        safe = Path(name).name or "source"
        folder = settings.data_dir / "files" / "".join(c for c in file_id if c.isalnum() or c in "_-")
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / safe
        size = 0
        with path.open("wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                fh.write(chunk)
        store.put_file({"id": file_id, "name": safe, "path": str(path), "size": size})
        return {"id": file_id, "size": size}

    @app.get("/api/files/{file_id}", dependencies=[Depends(auth)])
    def head_file(file_id: str):
        f = store.get_file(file_id)
        if not f:
            raise HTTPException(404, "File not uploaded")
        return {"id": f["id"], "name": f["name"], "size": f["size"]}

    @app.put("/api/pipelines/{pipeline_id}", dependencies=[Depends(auth)])
    def put_pipeline(pipeline_id: str, body: PipelineIn):
        if body.schedule:
            try:
                from apscheduler.triggers.cron import CronTrigger

                CronTrigger.from_crontab(body.schedule.cron, timezone="UTC")
            except ValueError as e:
                raise HTTPException(422, f"Invalid cron expression: {e}") from e
        missing = [fid for fid in body.files.values() if not store.get_file(fid)]
        if missing:
            raise HTTPException(409, {"missing_files": missing})
        row = {
            "id": pipeline_id,
            "name": body.name,
            "version": body.version,
            "pipeline_py": body.pipeline_py,
            "config": body.config,
            "files": body.files,
            "schedule_cron": body.schedule.cron if body.schedule else None,
            "schedule_enabled": int(bool(body.schedule and body.schedule.enabled)),
        }
        store.put_pipeline(row)
        jobs.schedule(row)
        return {"id": pipeline_id, "version": body.version, "nextRun": jobs.next_run(pipeline_id)}

    @app.get("/api/pipelines", dependencies=[Depends(auth)])
    def list_pipelines():
        return [
            {"id": p["id"], "name": p["name"], "version": p["version"], "schedule": {"cron": p["schedule_cron"], "enabled": bool(p["schedule_enabled"])} if p["schedule_cron"] else None, "nextRun": jobs.next_run(p["id"])}
            for p in store.list_pipelines()
        ]

    @app.delete("/api/pipelines/{pipeline_id}", dependencies=[Depends(auth)])
    def delete_pipeline(pipeline_id: str):
        p = store.get_pipeline(pipeline_id)
        if p:
            jobs.schedule({**p, "schedule_enabled": 0})
            store.delete_pipeline(pipeline_id)
        return {"ok": True}

    @app.post("/api/pipelines/{pipeline_id}/runs", dependencies=[Depends(auth)])
    def start_run(pipeline_id: str, body: RunIn | None = None):
        try:
            run_id = jobs.trigger_run(pipeline_id, (body or RunIn()).trigger)
        except KeyError:
            raise HTTPException(404, "Pipeline not synced to the server") from None
        except FileNotFoundError as e:
            raise HTTPException(409, str(e)) from e
        return run_view(store.get_run(run_id))

    @app.get("/api/runs", dependencies=[Depends(auth)])
    def list_runs(pipeline_id: str | None = None, limit: int = 100, summary: bool = True):
        out = []
        for r in store.list_runs(pipeline_id, limit):
            v = run_view(r)
            if summary and v["result"]:
                v["result"] = {k: v["result"].get(k) for k in ("status", "rows_in", "rows_out", "review_count", "excluded_count", "duration_ms")}
            out.append(v)
        return out

    @app.get("/api/runs/{run_id}", dependencies=[Depends(auth)])
    def get_run(run_id: str):
        r = store.get_run(run_id)
        if not r:
            raise HTTPException(404, "Run not found")
        return run_view(r)

    @app.get("/api/runs/{run_id}/output", dependencies=[Depends(auth)])
    def run_output(run_id: str):
        path = settings.data_dir / "runs" / run_id / "forma_output.csv"
        if not path.exists():
            raise HTTPException(404, "No output for this run")
        return FileResponse(path, media_type="text/csv", filename=f"{run_id}.csv")

    @app.delete("/api/runs/{run_id}", dependencies=[Depends(auth)])
    def delete_run(run_id: str):
        shutil.rmtree(settings.data_dir / "runs" / run_id, ignore_errors=True)
        return {"ok": True}

    @app.post("/api/sources/query", dependencies=[Depends(auth)])
    def query_source(body: QueryIn):
        try:
            if body.kind == "database":
                if not body.url_env or not body.query:
                    raise HTTPException(422, "url_env and query are required")
                grid = sources.database_grid(body.url_env, body.query, body.limit)
            else:
                if not body.url:
                    raise HTTPException(422, "url is required")
                url = sources.google_sheet_csv_url(body.url)
                fmt = "csv" if url != body.url else body.format
                grid = sources.api_grid(url, fmt, body.token_env)
                return {"grid": grid, "url": url, "format": fmt}
        except sources.SourceError as e:
            raise HTTPException(400, str(e)) from e
        return {"grid": grid}

    @app.post("/api/connections/test", dependencies=[Depends(auth)])
    def test_connection(body: ConnectionTestIn):
        try:
            sources.test_connection(body.url_env)
        except sources.SourceError as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True}

    @app.post("/api/ai/extract-patterns", dependencies=[Depends(auth)])
    def ai_patterns(body: SuggestIn):
        if not settings.ai_enabled and ai_client is None:
            raise HTTPException(503, "AI assistance is not configured on this server (set ANTHROPIC_API_KEY).")
        try:
            return {"fields": ai.suggest_patterns(body.samples, body.hint, client=ai_client), "model": ai.MODEL}
        except ai.AIError as e:
            raise HTTPException(422, str(e)) from e

    return app
