# FORMA

**Shape messy data into reliable pipelines.**

FORMA is a visual data workbench. Create a project for a data problem, connect its data, build pipelines you can see step by step, review exceptions instead of losing them, run them, and export readable Python that produces exactly the same output.

> See the data. Shape it visually. Verify every change. Keep the code.

The product definition is in [`FORMA_PRD_v1.md`](FORMA_PRD_v1.md). The design concepts are in [`Forma Asset/`](Forma%20Asset).

## Quick start

Requires Node.js 18+ (20+ recommended).

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

Choose **Explore the example project** on the Projects home for the prebuilt Invoice Processing scenario, or **New project** to build it yourself (tick *Start from example* for the sample data).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Typecheck and build to `web/dist` |
| `npm test` | Engine unit tests |
| `npm run parity` | Runs the TypeScript engine **and** the generated pandas code on the same files and compares every cell (needs Python with `pandas`, `openpyxl`, `pyyaml`) |
| `npm run check` | Typecheck + unit + parity tests |
| `npm run e2e` | Browser walkthroughs: the canonical project → pipeline → run journey, sheets, reshape, schedules/presets/rule suggestions, shell and data migration (needs `npm run build && npx vite preview --port 4173` running; `tests/e2e/server.mjs` also needs a FORMA server) |
| `npm run sample` / `npm run brand` | Regenerate the sample workbook / brand assets |

## How FORMA is organised

**PROJECT → SOURCE → PIPELINE → STEP → RUN**

- **Projects** are the home screen. A project holds the sources, pipelines and runs for one data problem, plus its settings (name, description, default execution target).
- **Sources** belong to a project and are stored once. Pipelines *reference* them, so several pipelines can read the same file, and Join / Lookup / Append pick from the project's sources (or add a new one to the project). Every sheet of a workbook is its own selectable source.
- **The project overview** is a read-only data map — sources → pipelines → outputs — with recent activity.
- **Pipelines open in Pipeline view**: the ordered flow of steps with status and row impact. Interaction follows **PIPELINE → PREVIEW → EXPAND**: click a step for a quick preview (input → output examples, ready / review counts, Edit), expand it into the panel workbench for deep work, and come back.
- **Runs are visible events.** The engine reports the source load and each completed step; the flow shows them in order with their real row counts and timings, then summarises *1,001 input · 986 ready · 15 review*. Review counts link straight to that step's rows in the review queue.
- **Execution** is explicit: *Local* (runs in this browser) or *FORMA Server* (runs through the connected execution server), per project and per run.

Data stored before projects existed is migrated once, deterministically, into **My FORMA Project** with every pipeline id, version, review decision and run kept.

## What's in V1

The full V1 loop from PRD §28 works end to end:

**SOURCE → INSPECT → SELECT → TRANSFORM → VALIDATE → REVIEW → RUN → EXPORT**

- **Sources:** CSV, Excel (multi-sheet, merged cells), JSON, JSONL and text. Every sheet of a workbook is its own source: pick the sheet when creating a pipeline (or create one pipeline per sheet), switch it from the preview header, and add other sheets with Append or Lookup / Join. Header and data-region detection, with advisory quality observations (mixed date formats, blanks, duplicates, stray whitespace). Uploaded files are immutable.
- **Views:** Pipeline view (default) plus the panel workbench views Analyst, Extraction, Compare, Engineer and Monitor. Workbench panels can be shown/hidden, resized, moved and maximized, and custom layouts can be saved. The 12 panels are: Source Viewer, Data Preview, Pipeline, Step Inspector, Before/After, Data Profile, Quality, Failed Rows, Python, Pipeline Spec, Run Logs and Run History. At phone width FORMA shows the pipeline, run status and review rather than the workbench.
- **Direct manipulation:** select a column to see its profile, detected patterns and suggested actions. A floating action bar offers Extract, Split, Clean, Replace, Convert, Profile and Formula, and there's a right-click menu plus a searchable transformation picker.
- **Transformations** (each one previews before it's applied):
  - select/reorder, rename, trim, change case, replace (exact/contains/regex), fill blanks
  - convert to number (currency-aware), standardise date (format detection)
  - pattern extraction with live match rates and failed-row inspection, key-value parsing, split
  - filter, sort, remove duplicates, formula, round
  - group/aggregate (sum, average, min, max, count, count distinct, first), pivot, unpivot
  - lookup/join against another file (first match or every match, keep or drop unmatched rows, optional review of unmatched rows), append
  - Rows with open review items are held back *before* any step that changes row identity (group, pivot, unpivot, join). Bad rows never distort aggregates, and review corrections flow into totals on the next run.
- **Validation:** explicit rules (not blank, pattern, valid date, numeric bounds, allowed set, unique). "Validation health" is reported with its context and quality dimensions, never as an unexplained score.
- **Review queue:** rows that can't be transformed or validated confidently are held back instead of silently loaded. For each one you can correct the value, keep the original, exclude the row, ignore the warning, or apply the same decision to similar rows. Decisions are fingerprinted to the source row, so they never carry over to a changed row.
- **Runs:** test runs execute the draft on a sample. Manual runs execute on every row in a Web Worker against an immutable version, and record a timeline, per-step metrics, logs, output data and a comparison with the previous run. You can rerun on a new compatible file without repeating any cleaning.
- **Export:** a single `pipeline.py` or a full project (`pipeline.py`, `requirements.txt`, `config.yaml`, `README.md`, `pipeline.json`, plus FORMA's output as a parity reference). The code has one function per step, and its comments match the visual pipeline, e.g. `# 04 Clean — Standardise invoice_date`. Credentials are never written into code; database destinations read an environment variable.
- **Update rules from review:** the review queue proposes deterministic rule changes, such as accepting a date format, turning a correction into a Replace step, or allowing a recurring value. Each one previews on every row how many review rows it resolves, and what else it changes, before you apply it.
- **Schedules & orchestration:** set a cron schedule per pipeline, then export an **Airflow** DAG or a **Prefect** flow (each FORMA step becomes a Prefect task) alongside the Python project.
- **Reusable presets:** save a step or a whole pipeline's steps as a preset and insert it from the transformation picker.
- **Productivity:** `Ctrl/⌘ K` opens the command palette. Undo/redo cover every pipeline edit. `Ctrl/⌘ S` saves a version, `Delete` removes the selected step, and arrow keys navigate the grid.

## FORMA server (optional)

`server/` is a Python backend (FastAPI) that adds large-file and scheduled runs, database and API/Google Sheets sources, database destinations and AI-assisted extraction. It runs the exact exported `pipeline.py`, so its output matches the app. See [`server/README.md`](server/README.md), then connect it under **Settings → FORMA server**.

## How it's built

```
web/
  src/engine/     Pipeline spec (source of truth), deterministic executor,
                  value semantics, formula language, profiling, detection
  src/codegen/    Spec → readable pandas project (runtime helpers mirror the engine)
  src/parsers/    CSV / Excel / JSON / JSONL / text → raw grids
  src/store/      App state: projects, sources, pipelines, runs, undo/redo, versions,
                  migrations (IndexedDB persistence)
  src/workers/    Full runs execute off the main thread and report step progress
  src/pages/      Screens; src/pages/projects/ is the project layer,
                  src/pages/workspace/ the pipeline view and panel workbench
  tests/          Unit, parity (TS ≡ Python) and browser e2e tests
```

- **One spec, two engines.** The UI, the in-browser executor and the code generator all work from the same `PipelineSpec` (PRD §8). The parity suite runs both engines on the same files and checks they agree cell for cell, including row IDs, review rows and rule counts. Exported projects can check themselves: `python pipeline.py --check expected/forma_output.csv`.
- **Browser-first, server optional.** Without a server, everything runs locally and all data stays in the browser. Previews run on a configurable sample, and full runs process every row in a Web Worker. With the FORMA server connected, runs can execute there instead.

## Not in this build yet

- collaboration, comments and approvals (need multi-user accounts)
- SQL and Polars code targets
- branching pipelines (a pipeline is an ordered list of steps)
- an in-browser Python parity check (use `python pipeline.py --check` locally)
- lineage and Git integration

The wordmark in `web/public/brand` uses live Inter text; a designer should outline it for final production assets.
