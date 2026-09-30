# FORMA

**Shape messy data into reliable pipelines.**

FORMA is a visual data workbench. Upload messy CSV or Excel data, shape it with previewed transformations, validate it, review exceptions, run it, and export the pipeline as readable Python that produces exactly the same output.

> See the data. Shape it visually. Verify every change. Keep the code.

The product definition is in [`FORMA_PRD_v1.md`](FORMA_PRD_v1.md). The design concepts are in [`Forma Asset/`](Forma%20Asset).

## Quick start

Requires Node.js 18+ (20+ recommended).

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

Open **Pipelines → Invoice demo** for the prebuilt acceptance scenario, or **New pipeline → Use sample invoices** to build it yourself.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Typecheck and build to `web/dist` |
| `npm test` | Engine unit tests |
| `npm run parity` | Runs the TypeScript engine **and** the generated pandas code on the same files and compares every cell (needs Python with `pandas`, `openpyxl`, `pyyaml`) |
| `npm run check` | Typecheck + unit + parity tests |
| `npm run e2e` | Browser walkthrough of the PRD §25 acceptance scenario (needs `npm run build && npx vite preview --port 4173` running) |
| `npm run sample` / `npm run brand` | Regenerate the sample workbook / brand assets |

## What's in V1

The full V1 loop from PRD §28 works end to end:

**SOURCE → INSPECT → SELECT → TRANSFORM → VALIDATE → REVIEW → RUN → EXPORT**

- **Sources:** CSV, Excel (multi-sheet, merged cells), JSON, JSONL and text. Header and data-region detection, with advisory quality observations (mixed date formats, blanks, duplicates, stray whitespace). Uploaded files are immutable.
- **Workspace:** a panel-based workbench with Analyst, Extraction, Compare, Engineer and Monitor presets. Panels can be shown/hidden, resized, moved and maximized, and custom layouts can be saved. The 13 panels are: Source Viewer, Data Preview, Pipeline, Step Inspector, Before/After, Data Profile, Quality, Failed Rows, Python, SQL (placeholder), Pipeline Spec, Run Logs and Run History.
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
- **Productivity:** `Ctrl/⌘ K` opens the command palette. Undo/redo cover every pipeline edit. `Ctrl/⌘ S` saves a version, `Delete` removes the selected step, and arrow keys navigate the grid.

## How it's built

```
web/
  src/engine/     Pipeline spec (source of truth), deterministic executor,
                  value semantics, formula language, profiling, detection
  src/codegen/    Spec → readable pandas project (runtime helpers mirror the engine)
  src/parsers/    CSV / Excel / JSON / JSONL / text → raw grids
  src/store/      App state, undo/redo, versions, runs (IndexedDB persistence)
  src/workers/    Full runs execute off the main thread
  src/pages/      Screens; src/pages/workspace/ is the panel workbench
  tests/          Unit, parity (TS ≡ Python) and browser e2e tests
```

- **One spec, two engines.** The UI, the in-browser executor and the code generator all work from the same `PipelineSpec` (PRD §8). The parity suite runs both engines on the same files and checks they agree cell for cell, including row IDs, review rows and rule counts. Exported projects can check themselves: `python pipeline.py --check expected/forma_output.csv`.
- **Browser-first.** Everything runs locally and all data stays in the browser. Previews run on a configurable sample; full runs process every row in a Web Worker.

## Not in this build yet

These are marked "Later" or "V1.x" in the PRD and shown as such in the UI:

- scheduling
- database/API/Google Sheets/cloud **sources**
- SQL and Polars targets
- Airflow and Prefect exports
- collaboration, comments and approvals
- "update rule from correction"
- AI-assisted extraction (field suggestions are deterministic pattern detection)

Database **destinations** are configured in FORMA and written by the exported Python project. The browser cannot reach databases.

The recommended scale-out architecture (PRD §19: FastAPI, PostgreSQL metadata, object storage, a job queue and workers for 500 MB files) is the next step. The engine and spec are already separated from the UI to make that move straightforward.
