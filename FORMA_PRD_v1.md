# FORMA --- Product Requirements Document

**Version:** 1.0\
**Status:** Build-ready product definition\
**Product:** FORMA\
**Tagline:** *Shape messy data into reliable pipelines.*\
**Internal symbol principle:** **FRAGMENT → ALIGN → FORM**

------------------------------------------------------------------------

## 1. Product Summary

FORMA is a visual data workbench for analysts and data engineers to turn
messy real-world data into reliable, repeatable pipelines without hiding
the underlying logic.

Users can inspect raw data, select columns or values directly, extract
structured information, clean and transform data, validate results,
review exceptions, execute pipelines, monitor runs, and export the
resulting pipeline as readable Python.

FORMA should combine the familiarity of a spreadsheet with the
reproducibility of a data pipeline and the transparency of code.

### Product promise

> **See the data. Shape it visually. Verify every change. Keep the
> code.**

FORMA is not intended to replace Python, SQL, or orchestration
platforms. It provides a faster visual layer for building and
understanding deterministic data preparation workflows while keeping the
result portable.

------------------------------------------------------------------------

## 2. Product Principles

### 2.1 Direct manipulation

Users should work with the data itself rather than configuring abstract
pipeline nodes whenever possible.

Core interaction:

**SEE → SELECT → TRANSFORM → VERIFY → RUN**

Selecting a column, range, or value should expose relevant actions such
as Extract, Split, Clean, Replace, Convert, Profile, Formula, and
Validate.

### 2.2 Transparent transformations

Every transformation must expose:

-   what it does;
-   which columns it affects;
-   a preview of the result;
-   the number of affected rows;
-   failures or uncertain rows;
-   its position in the pipeline;
-   the equivalent generated pipeline logic where supported.

### 2.3 Deterministic by default

Standard cleaning, extraction, conversion, validation, and reshaping
operations should be deterministic.

AI-assisted features may suggest transformations or help infer patterns,
but users must be able to inspect and approve the resulting logic.

### 2.4 Visual and code parity

The visual pipeline and generated code are two representations of the
same pipeline specification.

A user should be able to understand:

**visual action → pipeline step → generated code → execution result**

### 2.5 No lock-in

Users must be able to export a useful representation of their work.

Initial export target:

-   readable Python;
-   requirements;
-   configuration template;
-   pipeline specification.

Future targets may include orchestration frameworks.

### 2.6 Review exceptions instead of hiding them

FORMA should surface uncertain, invalid, or failed rows explicitly.

The product should help users improve pipeline rules from exceptions
rather than silently modifying questionable data.

------------------------------------------------------------------------

## 3. Target Users

### Primary --- Data Analyst

Needs to clean Excel, CSV, JSON, API, and database data without
repeatedly writing one-off scripts.

Primary workspace requirements:

-   source viewer;
-   spreadsheet-like interaction;
-   transformations;
-   extraction;
-   before/after comparison;
-   profiling;
-   validation;
-   review queue.

### Secondary --- Data Engineer

Needs reproducible logic, execution visibility, generated code,
configuration, and pipeline portability.

Primary workspace requirements:

-   pipeline step inspector;
-   generated Python;
-   pipeline specification;
-   logs;
-   run diagnostics;
-   connection configuration;
-   export.

### Additional --- Operations / Data Steward

Needs to monitor recurring pipelines and resolve data-quality
exceptions.

Primary requirements:

-   run history;
-   review queue;
-   failed rows;
-   validation results;
-   reruns;
-   monitoring.

------------------------------------------------------------------------

## 4. Information Architecture

### Global navigation

-   **Pipelines**
-   **Sources**
-   **Destinations**
-   **Runs**
-   **Settings**
-   **Help & Feedback**

Workspace should primarily be treated as a **view of a pipeline**,
rather than a completely separate product object.

Within a pipeline, the user can switch workspace presets.

### Pipeline header

Example:

`Invoice Processing   Draft`

Actions:

-   Test Run
-   Schedule
-   Run
-   Export Python
-   More
-   Workspace preset selector

### Workspace presets

Initial presets:

-   Analyst
-   Extraction
-   Compare
-   Engineer
-   Monitor
-   Custom

Presets change the arrangement of panels, not the underlying pipeline.

------------------------------------------------------------------------

## 5. Core Product Objects

### Pipeline

A versioned executable definition containing:

-   sources;
-   ordered steps;
-   transformations;
-   validation rules;
-   destination;
-   runtime configuration;
-   connection references;
-   review policy.

### Source

Supported V1 sources:

-   CSV
-   Excel
-   JSON
-   JSONL
-   plain text
-   uploaded local file

Planned connectors:

-   PostgreSQL
-   REST API
-   Google Sheets
-   cloud object storage

### Step

A single ordered operation in a pipeline.

Examples:

-   Select columns
-   Extract fields
-   Standardise date
-   Convert type
-   Replace values
-   Filter rows
-   Rename column
-   Formula
-   Validate
-   Load

Pipeline steps should not be forced into a fixed seven-step structure.
The onboarding example may use:

`Source → Select → Extract → Clean → Transform → Validate → Load`

but the executable model must support arbitrary ordered steps.

### Transformation

A deterministic operation applied to data.

### Validation Rule

A test applied to a column, row, or dataset.

### Run

One execution of a pipeline version.

### Review Item

A row or value requiring human attention because a transformation or
validation could not be completed confidently.

### Workspace Layout

A saved arrangement of panels for a particular workflow.

------------------------------------------------------------------------

## 6. Primary User Journey

### 6.1 Create Pipeline

User selects **New pipeline**.

Screen includes:

-   large file drop zone;
-   Browse files;
-   recent sources;
-   alternative source connectors;
-   pipeline name;
-   workspace;
-   optional destination.

After source selection, FORMA inspects the source and opens the Source
Viewer.

### 6.2 Inspect Source

The Source Viewer should resemble a professional spreadsheet/data-grid
environment.

Capabilities:

-   sheet tabs;
-   grid view;
-   raw view;
-   header detection;
-   merged-cell detection;
-   detected data region;
-   row/column counts;
-   search;
-   zoom;
-   source metadata;
-   quality observations.

FORMA may detect issues such as:

-   mixed date formats;
-   blank values;
-   possible duplicates;
-   mixed types;
-   inconsistent patterns.

Detection is advisory until the user applies a transformation or rule.

### 6.3 Select Data

Users can select:

-   one column;
-   multiple columns;
-   cells;
-   ranges;
-   detected regions.

Selection exposes contextual actions.

Initial actions:

-   Extract
-   Split
-   Clean
-   Replace
-   Convert
-   Profile
-   Formula
-   More

The right inspector displays:

-   inferred type;
-   completeness;
-   uniqueness;
-   examples;
-   detected patterns;
-   suggested actions.

### 6.4 Extract Structured Fields

Users can extract structured values from text.

Methods:

-   Pattern
-   Key-value
-   Split
-   AI Extract

Example source:

`Inv #INV-2231, Due 15/10/2026, Total RM 4,500`

Example output:

  Field          Value
  -------------- ------------
  invoice_no     INV-2231
  invoice_date   2026-10-15
  total          4500.00

Each field includes:

-   name;
-   output type;
-   pattern/rule;
-   match rate;
-   preview.

The user can inspect failed rows before applying the extraction.

### 6.5 Clean and Transform

Initial transformation library should include:

**Clean** - Change type - Standardise date - Fill blanks - Replace
values - Trim - Change case - Remove duplicates

**Text** - Split - Extract - Replace - Parse key-value

**Numeric** - Convert number - Formula - Round - Normalize

**Reshape** - Select - Rename - Reorder - Filter - Sort - Group /
Aggregate - Pivot / Unpivot

**Combine --- later V1.x** - Join - Append - Lookup

Every transformation requires a preview before application.

### 6.6 Transformation Picker

The **Add transformation** command opens a searchable transformation
palette.

Structure:

-   Suggested for your data
-   Clean
-   Text
-   Numeric
-   Reshape
-   Combine
-   Advanced

Suggested actions are derived from the current selection and detected
data characteristics.

The picker should scale to many operations without filling the primary
interface with buttons.

### 6.7 Before / After

Every transformation should support a comparison view.

Display:

-   original value;
-   transformed value;
-   changed-value highlighting;
-   invalid values;
-   unchanged values;
-   affected-row count.

Users can preview all rows before committing the transformation.

### 6.8 Validate

Users define explicit validation rules.

Examples:

-   invoice number matches `INV-[number]`;
-   date is valid;
-   total \> 0;
-   customer cannot be blank;
-   value belongs to allowed set;
-   uniqueness;
-   custom expression.

The validation screen includes:

-   column profiles;
-   pass/fail counts;
-   failed rows;
-   rule list;
-   quality dimensions.

Avoid presenting an unexplained universal "data quality score."

Preferred summary:

**Validation health**

with explicit context such as:

`97.8% of evaluated values passed configured quality rules.`

Supporting dimensions may include:

-   completeness;
-   validity;
-   uniqueness;
-   consistency.

### 6.9 Review Queue

Rows that cannot be transformed or validated reliably enter the Review
Queue.

Categories may include:

-   invalid date;
-   missing value;
-   pattern mismatch;
-   invalid amount;
-   other.

For each item show:

-   original value;
-   extracted/transformed values;
-   issue;
-   explanation;
-   confidence when applicable;
-   available actions.

Actions:

-   Correct value
-   Keep original
-   Exclude row
-   Ignore warning
-   Apply decision
-   Apply same decision to similar rows

Future enhancement:

**Update rule from correction**

A user correction may propose an updated deterministic rule and preview
its impact on similar rows before changing the pipeline.

### 6.10 Run Pipeline

Run modes:

-   Test Run
-   Manual Run
-   Scheduled Run --- V1.x

A run records:

-   pipeline version;
-   trigger;
-   start/end time;
-   duration;
-   rows in/out;
-   step results;
-   warnings;
-   failures;
-   destination;
-   logs.

### 6.11 Run Summary

The run page should contain:

-   execution timeline;
-   duration;
-   input rows;
-   loaded rows;
-   review rows;
-   failed rows;
-   per-step details;
-   run logs;
-   rerun;
-   review;
-   output data;
-   comparison with previous run.

Statuses:

-   Running
-   Success
-   Completed with review items
-   Failed
-   Cancelled

### 6.12 Export

Primary V1 export:

**Python project**

Contents:

``` text
pipeline.py
requirements.txt
config.yaml
README.md
pipeline.json
```

Optional quick export:

**Single Python script**

Export principles:

-   readable;
-   deterministic;
-   minimal unnecessary framework code;
-   credentials never embedded;
-   configuration separated;
-   generated code should correspond clearly to visual pipeline steps.

Future export adapters:

-   Airflow DAG
-   Prefect flow

------------------------------------------------------------------------

## 7. Customizable Workspace

FORMA uses a panel-based workbench.

Available panels:

-   Source Viewer
-   Data Preview
-   Pipeline
-   Step Inspector
-   Before / After
-   Data Profile
-   Quality
-   Failed Rows
-   Python
-   SQL
-   Pipeline Spec
-   Run Logs

Users can:

-   show/hide panels;
-   resize panels;
-   move panels;
-   save layouts;
-   save as new layout;
-   reset layout.

### Analyst preset

Primary focus:

-   Source Viewer
-   Step Inspector
-   Before / After
-   Data Profile

### Extraction preset

Primary focus:

-   Source Viewer
-   Extract configuration
-   Extraction preview
-   Failed rows

### Compare preset

Primary focus:

-   Before / After
-   data profile
-   validation differences

### Engineer preset

Primary focus:

-   Pipeline Steps
-   Data Preview
-   Python Code
-   Run Logs

### Monitor preset

Primary focus:

-   Run history
-   status
-   warnings/errors
-   throughput
-   review queue

The workspace should feel like a professional workbench, not a
dashboard-card builder.

Prefer shared panes and dividers over excessive nested cards.

------------------------------------------------------------------------

## 8. Pipeline Model

The internal pipeline specification is the source of truth.

Example:

``` yaml
name: Invoice Processing
version: 7

source:
  type: excel
  file: invoices.xlsx
  sheet: Invoices

steps:
  - id: select_details
    type: select

  - id: extract_invoice_fields
    type: extract
    input: Details
    fields:
      - invoice_no
      - invoice_date
      - total

  - id: standardise_date
    type: convert_date
    input: invoice_date
    format: YYYY-MM-DD

  - id: convert_total
    type: convert_number
    input: total

  - id: validate_invoice
    type: validate

destination:
  type: database
  target: warehouse.fact_invoices
```

The UI, execution engine, and code generator should all operate from
this model.

------------------------------------------------------------------------

## 9. Code Generation

Generated Python should prioritize readability over cleverness.

Initial execution engine:

**Pandas**

Potential later engine:

**Polars**

Each pipeline step should map to a clearly identifiable function or code
block.

Example:

``` python
def standardise_invoice_date(df):
    df = df.copy()
    df["invoice_date"] = pd.to_datetime(
        df["invoice_date"],
        dayfirst=True,
        errors="coerce"
    ).dt.strftime("%Y-%m-%d")
    return df
```

Generated code should contain step comments matching the visual
pipeline.

Example:

``` python
# 04 Clean — Standardise invoice_date
```

------------------------------------------------------------------------

## 10. AI Assistance

AI is an assistant, not the hidden execution engine.

Allowed uses:

-   suggest extraction patterns;
-   infer likely field structures;
-   propose transformations;
-   explain errors;
-   suggest validation rules;
-   generate a deterministic transformation proposal;
-   explain generated code.

Any AI-generated transformation must be previewable and inspectable.

For V1, FORMA should prefer deterministic execution after the user
accepts an AI suggestion.

Do not make the core workflow dependent on an LLM.

------------------------------------------------------------------------

## 11. Connections and Secrets

Connections are reusable references to external systems.

Examples:

-   PostgreSQL connection
-   API credential
-   warehouse connection

Secrets must never be written into generated code.

Generated projects should reference environment variables, for example:

``` text
WAREHOUSE_URL
API_TOKEN
```

The export screen should explicitly state that credentials are not
included.

------------------------------------------------------------------------

## 12. Versioning

Pipeline edits create draft state.

Initial model:

-   Draft
-   Versioned on successful save/publish/run milestone
-   Run records reference immutable pipeline version

Users should be able to inspect prior versions and compare them in a
later release.

------------------------------------------------------------------------

## 13. Design System

### Visual direction

Professional desktop data workbench.

Characteristics:

-   predominantly white/light neutral interface;
-   high information density without clutter;
-   restrained use of blue;
-   thin borders/dividers;
-   compact controls;
-   spreadsheet familiarity;
-   strong typography hierarchy;
-   minimal decoration;
-   no unnecessary gradients;
-   no "AI magic" visual language.

### Brand colors

``` text
FORMA Blue   #146BFF
Near Black   #0A0D12
Warm White   #F7F8FA
```

Semantic colors should be separate from brand blue:

-   green --- success / valid;
-   amber --- warning / review;
-   red --- error / invalid;
-   grey --- neutral / inactive.

### Logo

Approved concept:

**fragmented geometric elements progressively aligning into structured
form.**

Internal principle:

**FRAGMENT → ALIGN → FORM**

Required production assets:

``` text
/public/brand/
  forma-symbol-blue.svg
  forma-symbol-black.svg
  forma-symbol-white.svg

  forma-logo-primary.svg
  forma-logo-black.svg
  forma-logo-white.svg

  forma-logo-tagline.svg

  forma-favicon.svg
  favicon-16.png
  favicon-32.png
  favicon-48.png

  forma-app-icon-192.png
  forma-app-icon-512.png
```

Normal UI usage should use the standalone symbol without an enclosing
blue square. A rounded-square container is reserved for dedicated
application icons.

------------------------------------------------------------------------

## 14. Interaction States

Every major component must define:

-   default;
-   hover;
-   focus;
-   selected;
-   active;
-   disabled;
-   loading;
-   empty;
-   success;
-   warning;
-   error.

Data-specific states must additionally include:

-   selected cell;
-   selected column;
-   selected range;
-   changed value;
-   invalid value;
-   review-required value;
-   filtered row;
-   excluded row.

Skeletons should preserve layout to avoid interface movement during
loading.

------------------------------------------------------------------------

## 15. Keyboard and Productivity

FORMA is a desktop productivity application and should support
keyboard-heavy workflows.

Initial shortcuts:

-   `Cmd/Ctrl + K` --- global command/search
-   `Cmd/Ctrl + Z` --- undo
-   `Cmd/Ctrl + Shift + Z` --- redo
-   `Cmd/Ctrl + S` --- save
-   `Delete` --- remove selected step where safe
-   arrow keys --- navigate grid
-   `Enter` --- inspect/edit
-   `Esc` --- close panel/dialog or clear transient selection

A command palette should eventually expose transformations, navigation,
and pipeline actions.

------------------------------------------------------------------------

## 16. Undo / Redo

Visual transformations must be reversible.

The user should be able to undo:

-   transformations;
-   renames;
-   filters;
-   step deletion;
-   step reorder;
-   validation-rule changes.

Undo should operate on pipeline state rather than directly mutating the
original source.

Source data remains immutable.

------------------------------------------------------------------------

## 17. Data Safety

Core rules:

-   original uploaded source is immutable;
-   transformations create derived pipeline state;
-   credentials are never embedded in exported code;
-   destructive actions require confirmation where recovery is not
    trivial;
-   review decisions are auditable;
-   pipeline versions used by completed runs remain immutable.

------------------------------------------------------------------------

## 18. Performance Requirements

Initial targets:

-   common UI interactions respond within 100 ms where no backend
    operation is required;
-   source preview should use virtualization;
-   opening large files must not render every row into the DOM;
-   transformations should operate on preview samples before full
    execution;
-   long-running operations expose progress;
-   the UI remains responsive while jobs execute.

Initial practical file target:

**up to 500 MB per uploaded file**, subject to implementation
benchmarking.

Large-file processing should move to server-side or worker execution
rather than relying entirely on browser memory.

------------------------------------------------------------------------

## 19. Suggested Technical Architecture

### Frontend

Recommended:

-   React
-   TypeScript
-   Vite or Next.js
-   TanStack Table / virtualized data grid
-   Zustand or equivalent focused client state
-   React Query / TanStack Query for server state
-   resizable panel system
-   Monaco Editor for generated Python/SQL

### Backend

Recommended:

-   Python
-   FastAPI
-   Pandas initially
-   Polars evaluation for large datasets
-   background job execution for pipeline runs

### Persistence

Recommended:

-   PostgreSQL for metadata;
-   object storage for uploaded files and run artifacts;
-   secret manager/environment-backed credentials;
-   structured pipeline specification stored as JSON/JSONB.

### Execution architecture

``` text
Browser
   │
   ▼
FORMA API
   │
   ├── Pipeline Metadata
   │
   ├── Source Storage
   │
   ├── Preview Engine
   │
   └── Job Queue
          │
          ▼
    Pipeline Worker
          │
          ├── Execute steps
          ├── Validate
          ├── Generate artifacts
          └── Write destination
```

------------------------------------------------------------------------

## 20. Core Data Model

Initial entities:

``` text
User
Workspace
WorkspaceLayout

Pipeline
PipelineVersion
PipelineStep

Source
Connection
Destination

ValidationRule

Run
RunStep
RunLog

ReviewItem
ReviewDecision

ExportArtifact
```

Relationships should preserve pipeline-version immutability for
historical runs.

------------------------------------------------------------------------

## 21. MVP Scope

### Must Have

-   pipeline creation;
-   CSV and Excel upload;
-   source preview;
-   sheet selection;
-   header/data-region detection;
-   column selection;
-   transformation picker;
-   common cleaning operations;
-   pattern extraction;
-   before/after preview;
-   validation rules;
-   failed/review rows;
-   pipeline step list;
-   test run;
-   manual run;
-   run logs;
-   run summary;
-   generated Python;
-   Python export;
-   Analyst workspace;
-   Engineer workspace;
-   FORMA production branding.

### Should Have

-   JSON/JSONL;
-   database source;
-   database destination;
-   custom workspace layouts;
-   quality profiling;
-   review queue;
-   saved connections;
-   reusable transformation presets.

### Later

-   scheduling;
-   API source;
-   Google Sheets;
-   cloud storage;
-   joins;
-   multi-source workflows;
-   Airflow export;
-   Prefect export;
-   collaboration;
-   comments;
-   approvals;
-   lineage;
-   Git integration;
-   reusable pipeline templates;
-   advanced monitoring.

------------------------------------------------------------------------

## 22. Explicit Non-Goals for Initial Release

V1 is not:

-   a full data warehouse;
-   a notebook replacement;
-   a BI/dashboard platform;
-   a general-purpose workflow automation product;
-   an enterprise orchestration replacement;
-   an autonomous AI agent platform;
-   a full dbt replacement;
-   a collaborative spreadsheet;
-   an ML training platform.

Keeping these boundaries is important to prevent scope creep.

------------------------------------------------------------------------

## 23. MVP Screens

The first build should cover these screens:

1.  Pipeline List
2.  Create Pipeline
3.  Source Viewer
4.  Select / Inspect Column
5.  Extract Fields
6.  Transformation Picker
7.  Clean / Transform
8.  Before / After
9.  Validate
10. Review Queue
11. Analyst Workspace
12. Engineer Workspace
13. Run Summary
14. Run History
15. Export Python
16. Connections / Destinations
17. Settings

The existing visual concepts should be treated as the primary design
direction: light professional data workbench, compact density,
persistent pipeline context, contextual right-side inspectors, and
restrained FORMA blue.

------------------------------------------------------------------------

## 24. Build Sequence

### Phase 0 --- Foundations

-   finalize FORMA SVG assets;
-   design tokens;
-   typography;
-   spacing;
-   icon system;
-   application shell;
-   routing;
-   panel primitives;
-   table/grid primitives;
-   state conventions.

### Phase 1 --- Source Workbench

Build:

-   Create Pipeline;
-   file upload;
-   Excel/CSV parser;
-   Source Viewer;
-   sheet switching;
-   region/header detection;
-   column inspector;
-   profiling.

**Milestone:** User can upload messy data and inspect it comfortably.

### Phase 2 --- Transformation Engine

Build:

-   pipeline specification;
-   transformation registry;
-   selection actions;
-   transformation picker;
-   preview engine;
-   Select;
-   Rename;
-   Type conversion;
-   Date standardisation;
-   Replace;
-   Trim;
-   Fill blanks;
-   Filter;
-   Formula.

**Milestone:** User can visually build a reproducible cleaning pipeline.

### Phase 3 --- Extraction

Build:

-   pattern extraction;
-   split;
-   key-value extraction;
-   multiple output fields;
-   match rate;
-   failed-row inspection.

**Milestone:** User can convert semi-structured text into structured
columns.

### Phase 4 --- Validation & Review

Build:

-   validation rules;
-   validation health;
-   failed rows;
-   Review Queue;
-   correction decisions;
-   exclusions.

**Milestone:** User can understand and resolve data problems before
loading.

### Phase 5 --- Execution

Build:

-   test run;
-   full run;
-   worker execution;
-   run timeline;
-   step metrics;
-   logs;
-   output artifact.

**Milestone:** Visual pipelines become repeatable executable workflows.

### Phase 6 --- Code & Export

Build:

-   deterministic Python generator;
-   code viewer;
-   pipeline JSON;
-   requirements generation;
-   configuration template;
-   downloadable project.

**Milestone:** Users can take their pipeline outside FORMA.

### Phase 7 --- Workspaces

Build:

-   Analyst preset;
-   Engineer preset;
-   Extraction preset;
-   resizable panels;
-   layout persistence;
-   Custom workspace.

**Milestone:** FORMA becomes a customizable professional workbench.

### Phase 8 --- Integrations & Operations

After the core experience is stable:

-   database connections;
-   destinations;
-   scheduling;
-   monitoring;
-   API;
-   cloud sources;
-   orchestration exports.

------------------------------------------------------------------------

## 25. MVP Acceptance Scenario

The canonical V1 demo is **Invoice Processing**.

Given an Excel workbook containing:

-   Customer
-   Details
-   Amount
-   Status
-   Remarks
-   Created At

where `Details` contains text such as:

`Inv #INV-2231, Due 15/10/2026, Total RM 4,500`

the user must be able to:

1.  upload the workbook;
2.  inspect the detected sheet and region;
3.  select `Details`;
4.  extract `invoice_no`, `invoice_date`, and `total`;
5.  preview extraction success/failures;
6.  standardise the date;
7.  convert the amount to a number;
8.  clean selected text fields;
9.  validate invoice number, date, total, and customer;
10. review invalid rows;
11. run the complete pipeline;
12. inspect step-level execution;
13. inspect resulting data;
14. view generated Python;
15. export the pipeline as a readable Python project.

The workflow is accepted when the same pipeline can be rerun on a
compatible source file without manually repeating the cleaning
operations.

------------------------------------------------------------------------

## 26. Success Metrics

Early product metrics:

-   time from source upload to first successful pipeline;
-   percentage of pipeline steps created through direct manipulation;
-   transformation preview → apply rate;
-   percentage of review items resolved;
-   successful run rate;
-   rerun success on new compatible data;
-   Python export usage;
-   number of pipelines reused more than once.

Qualitative success:

> A data analyst should feel that FORMA is faster than writing a one-off
> cleaning script, while a data engineer should still be able to inspect
> exactly what FORMA will execute.

------------------------------------------------------------------------

## 27. Product Identity Summary

### Name

**FORMA**

The name reflects forming, shaping, and structuring data.

### Product tagline

**Shape messy data into reliable pipelines.**

### Symbol principle

**FRAGMENT → ALIGN → FORM**

### Interaction principle

**SEE → SELECT → TRANSFORM → VERIFY → RUN**

### Ownership principle

**YOUR PIPELINE. YOUR CODE. YOUR DATA.**

Together these should govern the product experience, interface,
generated code, documentation, and brand identity.

------------------------------------------------------------------------

## 28. Definition of V1 Done

FORMA V1 is ready when a user can take a messy CSV/Excel source through
the complete lifecycle:

**SOURCE → INSPECT → SELECT → TRANSFORM → VALIDATE → REVIEW → RUN →
EXPORT**

without needing to write code, while still being able to inspect and
export the deterministic Python representation of the resulting
pipeline.

That end-to-end loop is more important than maximizing the number of
connectors or transformation types in the first release.
