"""Database and API sources: fetch a snapshot grid for building pipelines in FORMA.

The cell normalisation here matches `read_grid()` / `normalize_cell()` in the
generated pipeline code, which re-reads the same source live at run time.
"""
from __future__ import annotations

import csv
import io
import json
import os
import urllib.request
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import create_engine, text


class SourceError(Exception):
    pass


def normalize_cell(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d") + " 00:00:00"
    if isinstance(v, time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, str):
        return v if v != "" else None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, float) and (v != v or abs(v) == float("inf")):
        return None
    if isinstance(v, (int, float, bool)):
        return v
    return str(v)


def _json_cell(v):
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    return normalize_cell(v)


def records_to_grid(records) -> list[list]:
    keys: list[str] = []
    for r in records:
        if isinstance(r, dict):
            for k in r:
                if k not in keys:
                    keys.append(k)
    grid = [list(keys)]
    for r in records:
        if isinstance(r, dict):
            grid.append([_json_cell(r.get(k)) for k in keys])
        else:
            grid.append([_json_cell(r)] + [None] * (len(keys) - 1))
    return grid


def database_grid(url_env: str, query: str, limit: int | None = None) -> list[list]:
    url = os.environ.get(url_env)
    if not url:
        raise SourceError(f"The server has no {url_env} environment variable. Set it to a SQLAlchemy database URL and restart the server.")
    try:
        with create_engine(url).connect() as conn:
            result = conn.execute(text(query))
            rows = result.fetchmany(limit) if limit else result.fetchall()
            return [list(result.keys())] + [[normalize_cell(v) for v in row] for row in rows]
    except Exception as e:  # surface driver errors to the user
        raise SourceError(f"Query failed: {e.__class__.__name__}: {str(e).splitlines()[0][:300]}") from e


def api_grid(url: str, fmt: str = "json", token_env: str | None = None) -> list[list]:
    headers = {"Accept": "application/json, text/csv, */*", "User-Agent": "forma-pipeline"}
    if token_env:
        token = os.environ.get(token_env)
        if not token:
            raise SourceError(f"The server has no {token_env} environment variable.")
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as resp:
            body = resp.read().decode("utf-8-sig")
    except Exception as e:
        raise SourceError(f"Request failed: {e}") from e
    if fmt == "csv":
        return [[c if c != "" else None for c in row] for row in csv.reader(io.StringIO(body))]
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise SourceError("The response is not JSON. Choose CSV format for CSV endpoints.") from e
    if isinstance(data, dict):
        data = next((v for v in data.values() if isinstance(v, list)), [data])
    return records_to_grid(data)


def google_sheet_csv_url(url: str) -> str:
    """Turn a Google Sheets link into its CSV export URL (sheet must be shared by link)."""
    import re

    m = re.search(r"/spreadsheets/d/([\w-]+)", url)
    if not m:
        return url
    gid = re.search(r"[#&?]gid=(\d+)", url)
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv" + (f"&gid={gid.group(1)}" if gid else "")


def test_connection(url_env: str) -> None:
    database_grid(url_env, "SELECT 1", limit=1)
