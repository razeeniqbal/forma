# FORMA server

The optional Python backend for FORMA (PRD §19). The app works fully in the browser without it. Connect a server when you need:

- **Large files and real destinations:** runs execute on the server, including writes to database destinations.
- **Scheduled runs:** cron schedules set in the app run here.
- **Database and API sources:** PostgreSQL/MySQL/SQLite queries, JSON/CSV endpoints, Google Sheets shared by link, and public or pre-signed cloud file URLs.
- **AI-assisted extraction:** Claude proposes regex patterns.

The server runs **the exact `pipeline.py` FORMA exports**, which the parity suite verifies against the app's engine. Server results therefore match what you previewed.

## Run it

```bash
cd server
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m forma_server --port 8787
```

Then in FORMA: **Settings → FORMA server → `http://localhost:8787` → Save & test**.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `FORMA_DATA_DIR` | `./forma-data` | Uploaded files, run folders, SQLite metadata |
| `FORMA_DATABASE_URL` | SQLite in the data dir | Metadata store (e.g. `postgresql://…`) |
| `FORMA_CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Where the FORMA app is served from |
| `FORMA_API_TOKEN` | *(none)* | Require `Authorization: Bearer <token>` (set the same token in Settings) |
| `FORMA_MAX_WORKERS` | `2` | Concurrent runs |
| `FORMA_RUN_TIMEOUT` | `3600` | Seconds before a run is stopped |
| `ANTHROPIC_API_KEY` | *(none)* | Enables AI-assisted extraction |
| *your connection variables* | | e.g. `WAREHOUSE_URL=postgresql://user:pass@host/db`. FORMA stores only the variable **name**. |

The server binds to `127.0.0.1` by default. It executes pipeline code you send it, so run it for yourself or your team behind your own network controls. Set `FORMA_API_TOKEN` whenever it is reachable by others.

## How runs work

1. The app uploads the source file(s) once, then the generated `pipeline.py` and `config.yaml` for the saved version.
2. Each run gets its own folder and a subprocess. The runner executes the FORMA steps one by one (`STEPS` in `pipeline.py`) and records per-step timings, row counts and flagged values. It then applies the review gate and writes the destination.
3. Results, logs and review items appear in the app's run history, including scheduled runs.

## AI assistance

`POST /api/ai/extract-patterns` asks `claude-opus-5-5` (structured JSON output, server-side refusal fallbacks) to propose extraction fields. Suggestions are only proposals:

- Every pattern is checked to behave identically in Python and JavaScript.
- Its match rate is measured on the samples.
- The app shows live match rates and failed rows before anything is applied.
- Execution stays plain, deterministic regex.

## Tests

```bash
pip install pytest httpx
python -m pytest -q tests
```

End-to-end checks (the server running real generated pipelines, compared cell by cell with the app's engine) are in `web/tests/parity/server.test.ts` and run with `npm run parity`.
