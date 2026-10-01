"""Metadata store (SQLite by default, PostgreSQL via FORMA_DATABASE_URL)."""
from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import JSON, Column, Float, Integer, MetaData, String, Table, Text, create_engine, select

metadata = MetaData()

pipelines = Table(
    "pipelines",
    metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("version", Integer, nullable=False),
    Column("pipeline_py", Text, nullable=False),
    Column("config", JSON, nullable=False),
    Column("files", JSON, nullable=False),
    Column("schedule_cron", String),
    Column("schedule_enabled", Integer, default=0),
    Column("updated_at", Float, nullable=False),
)

files = Table(
    "files",
    metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("path", String, nullable=False),
    Column("size", Integer, nullable=False),
    Column("created_at", Float, nullable=False),
)

runs = Table(
    "runs",
    metadata,
    Column("id", String, primary_key=True),
    Column("pipeline_id", String, index=True, nullable=False),
    Column("pipeline_name", String, nullable=False),
    Column("version", Integer, nullable=False),
    Column("trigger", String, nullable=False),
    Column("status", String, nullable=False),
    Column("started_at", Float, nullable=False),
    Column("finished_at", Float),
    Column("result", JSON),
    Column("error", Text),
)


class Store:
    def __init__(self, url: str):
        self.engine = create_engine(url, future=True)
        metadata.create_all(self.engine)

    # -- pipelines -------------------------------------------------------
    def put_pipeline(self, row: dict[str, Any]) -> None:
        row = {**row, "updated_at": time.time()}
        with self.engine.begin() as c:
            if c.execute(select(pipelines.c.id).where(pipelines.c.id == row["id"])).first():
                c.execute(pipelines.update().where(pipelines.c.id == row["id"]).values(**row))
            else:
                c.execute(pipelines.insert().values(**row))

    def get_pipeline(self, pid: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(pipelines).where(pipelines.c.id == pid)).mappings().first()
            return dict(r) if r else None

    def list_pipelines(self) -> list[dict]:
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(select(pipelines)).mappings()]

    def delete_pipeline(self, pid: str) -> None:
        with self.engine.begin() as c:
            c.execute(pipelines.delete().where(pipelines.c.id == pid))

    # -- files -----------------------------------------------------------
    def put_file(self, row: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(files.delete().where(files.c.id == row["id"]))
            c.execute(files.insert().values(**row, created_at=time.time()))

    def get_file(self, fid: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(files).where(files.c.id == fid)).mappings().first()
            return dict(r) if r else None

    # -- runs ------------------------------------------------------------
    def create_run(self, row: dict[str, Any]) -> None:
        with self.engine.begin() as c:
            c.execute(runs.insert().values(**row))

    def update_run(self, rid: str, **values: Any) -> None:
        with self.engine.begin() as c:
            c.execute(runs.update().where(runs.c.id == rid).values(**values))

    def get_run(self, rid: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(runs).where(runs.c.id == rid)).mappings().first()
            return dict(r) if r else None

    def list_runs(self, pipeline_id: str | None = None, limit: int = 100) -> list[dict]:
        q = select(runs).order_by(runs.c.started_at.desc()).limit(limit)
        if pipeline_id:
            q = q.where(runs.c.pipeline_id == pipeline_id)
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(q).mappings()]


def dumps(v: Any) -> str:
    return json.dumps(v, default=str)
