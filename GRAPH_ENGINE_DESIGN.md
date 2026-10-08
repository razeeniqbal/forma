# FORMA Graph Engine: Design

Status: **Phases 8, 9 and 10 implemented.** Every pipeline runs through the graph engine (`web/src/engine/graph/`), connections are editable on the canvas and in the inspector, and a pipeline can branch into several Loads. Pipelines with edited connections export as graph Python (`web/src/codegen/graph.ts`) that the FORMA Server runs node by node, writing and reporting every Load. Cycles and loops remain out of scope by design.

```
POSITION IS VISUAL.
CONNECTION IS LOGICAL.
EXECUTION IS DETERMINISTIC.

ONE PIPELINE MODEL.
TWO EXECUTION REPRESENTATIONS.
```

## 1. Why, and what must not break

Today a pipeline is a `PipelineSpec`: one main source, an ordered list of steps, one destination. Join, Lookup and Append read a second dataset, but that dataset is always a project source exactly as stored. The canvas derives a graph from the spec (`web/src/canvas/graph.ts`) but cannot change it.

The goal is a pipeline that is a real directed acyclic graph:

```
SOURCE A ─→ CLEAN A ─┐
                     ▼
                    JOIN ─→ VALIDATE ─→ LOAD
                     ▲
SOURCE B ─→ CLEAN B ─┘
```

Hard constraints, in priority order:

1. **Existing pipelines produce identical results**: the same output cells, row IDs, review rows, excluded rows, rule counts and issue counts as today, with no user action.
2. **The TypeScript engine and the generated Python agree on every graph**, enforced by parity tests before any graph feature ships.
3. **The generated Python stays readable**: one function per node and plain DataFrames, not an opaque graph runtime.
4. **Review stays traceable** to project, pipeline, run, node and source row, and existing review decisions keep applying.
5. **Canvas positions survive migration.**

## 2. What today's engine actually does

These details decide the design. They are in `web/src/engine/execute.ts` and mirrored in `web/src/codegen/runtime.ts`.

| Mechanism | Today |
| --- | --- |
| Row identity | Main-source rows get IDs `1..N` (data row number). One run-wide counter (`Env.nextId`, Python `NEXT_ROW_ID`) issues IDs for rows created by Group, Pivot, Unpivot, Join (every match) and Append. Lookup keeps the left row IDs. |
| Side sources | Loaded inside the step (`sideSource`). Their row IDs never survive: Append and Join issue new IDs, and Lookup copies values only. Side sources therefore never carry issues. |
| Issues | A single list per run. `reconcileIssues` renames issue columns after Rename and prunes issues of rows removed by Select, Filter, Remove duplicates and inner Join. Python does the same on the global `ISSUES` list (`rename_issues`, `prune_issues`). |
| Review gate | Runs before every identity-changing step (`isReshaping`: Group, Pivot, Unpivot, Join in every-match mode) and once at the end. Held rows leave the dataset and become review rows. Decisions match by row ID and source-row fingerprint. |
| Order | Spec order. Row-ID allocation order is therefore spec order. |
| Server | `server/forma_server/runner.py` imports the exported module and drives `STEPS` itself (`df = fn(df)`), recording per-step metrics. |

Two consequences:

- **The ID counter makes execution order observable.** Two topological orders of the same graph can produce different row IDs. Order must be fixed by the model, not by layout.
- **Issues are global but must become path-scoped.** In a graph, the same source row can flow down two branches. An issue raised in branch A must not hold that row in branch B.

## 3. The model

### 3.1 PipelineGraph

```ts
interface PipelineGraph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

interface PipelineNode {
  id: string;             // stable; migrated nodes keep today's canvas ids
  op: OperationId;        // taxonomy operation: "source", "trim", "join", "lookup", "append", "load", ...
  config: NodeConfig;     // the step fields of today's Step union (without `source` for combine ops)
  order: number;          // creation order; the only tie-break for execution order
  label?: string;
}

interface PipelineEdge {
  id: string;
  from: string;           // producing node
  to: string;             // consuming node
  input: InputRoleId;     // "input" | "left" | "right" | "primary" | "reference" | "datasets"
  slot?: number;          // position among "datasets" inputs (Append), 0-based
}
```

Positions are **not** in the graph. They stay in `PipelineCanvasState`, keyed by node id, exactly as today.

`NodeConfig` reuses today's step shapes, so editors, `describeStep`, `stepColumns`, `makeStep` and the per-operation executor code are reused unchanged. The only structural change: Join, Lookup and Append no longer embed a `source: SourceSpec`; their second input is an edge from any node. A project source becomes a `source` node whose config is today's `SourceSpec`.

`PipelineSpecV2`:

```ts
interface PipelineSpecV2 {
  formaSpec: 2;
  name: string;
  graph: PipelineGraph;
  reviewDecisions: ReviewDecision[];   // unchanged shape, plus optional `node` (see 7)
}
```

The destination moves into the config of each `load` node, so a graph can have several Loads (branching, Phase 10).

### 3.2 Dataset contracts

Contracts already exist in `web/src/engine/taxonomy.ts` (`Operation.contract`). Phase 8 makes them normative:

| Operation | Inputs (role, cardinality) | Output |
| --- | --- | --- |
| Source | none | 1 dataset |
| Extract, Transform (single input), Validate | `input` x1 | 1 dataset |
| Join | `left` x1, `right` x1 | 1 dataset |
| Lookup | `primary` x1, `reference` x1 | 1 dataset |
| Append | `datasets` x2 or more, ordered by `slot` | 1 dataset |
| Load | `input` x1 | destination result (no dataset; terminates a branch) |

A connection is a **dataset dependency**. Conceptually the value on an edge is:

```
Dataset { columns, types, rows, rowIds }  +  lineage (source node per row)  +  open issues on its path
```

### 3.3 Output semantics

- Every node output is immutable. Fan-out (one output, several consumers) shares the value; no consumer can affect another.
- Multi-input operations read their inputs by role, never by edge order or position.
- A node with any missing required input is invalid; the graph does not run (see 6).

## 4. Execution order

**Topological order, with ties broken by `order` (creation order), never by position.**

```
ready = nodes with no unexecuted inputs
repeat: run the ready node with the smallest `order`; add newly ready nodes
```

This is Kahn's algorithm with a deterministic priority queue. Both engines must use this exact function: TypeScript computes it, and the code generator writes the resulting order into the Python file, so Python never recomputes it.

For a migrated linear pipeline, `order` equals today's step index (source -1, steps 0..n-1, side sources after the main source but before their consumer, load last). The topological order then equals spec order, so the row-ID counter allocates exactly as today. This is the property the migration equivalence tests (9.2) assert.

DAG rules:

- Cycles are rejected at edit time and at load time. Message: "This connection would make FORMA run Step 06 before itself. Pipelines run in one direction, so loops are not supported."
- Self edges are rejected.
- Disconnected subgraphs are allowed only if each ends in a Load. A subgraph that ends elsewhere is a warning ("Not used by any Load"), and its nodes are skipped.

## 5. Row identity and lineage

Today's IDs must stay stable, and branch sources need IDs that do not collide with them.

- **Primary source** (the migrated main source, or the first source node by `order`): IDs `1..N` as today.
- **Every other source node**: IDs `k * 10^9 + rowNumber`, where `k` is the source node's rank among source nodes by `order` (1, 2, ...). These IDs do not use the run counter, so loading a second source does not shift any ID the primary path allocates. This keeps migrated pipelines identical (their side sources never kept IDs anyway), keeps IDs stable when a source grows, and makes lineage decodable: `floor(id / 10^9)` names the source and `id % 10^9` gives the source row. The counter starts after `N` and must stay below `10^9`; pipelines anywhere near that size run on the FORMA Server, not in a browser.
- **Created rows** (Group, Pivot, Unpivot, Join every-match, Append): from the run counter, in topological order, exactly as today.
- Fingerprints are recorded for every loaded and created row, as today.

Python mirrors this in `load_source(src, rank)` and `new_rows`.

## 6. Graph validation

Validation is a pure function `validateGraph(graph, schemas) -> Problem[]`. Each problem names a node or edge and a sentence for the UI. It runs on every edit, before preview, and before run. A run with errors is refused before execution starts.

Structural:

- cycle; self edge
- required input missing ("Load requires an input.", "Join needs a right input.")
- too many inputs for a role (single-input roles take exactly one edge)
- Append with fewer than two inputs
- Load with an outgoing edge; Source with an incoming edge
- edge between roles the compatibility table forbids (6.1)
- node unreachable from any source, or not leading to any Load (warning)

Configuration and schema (needs 8):

- Join or Lookup keys missing, or not present in the schema of their side
- Lookup or Join brings in a column that does not exist; output column clash
- Append mapping that targets a missing column, or maps two columns onto one
- a step referencing a column that is not in its input schema, explained with the upstream cause (`explainMissingColumn` in `web/src/lib/schema.ts` generalised from "previous steps" to "ancestors on this path")

### 6.1 Connection compatibility

One table, derived from the taxonomy, used by validation, by canvas handles and by compatible-target highlighting. It is never re-implemented in components.

| From \ To | Extract | Transform | Validate | Combine input | Load |
| --- | --- | --- | --- | --- | --- |
| Source | yes | yes | yes | yes | yes |
| Extract | yes | yes | yes | yes | yes |
| Transform | yes | yes | yes | yes | yes |
| Validate | no | yes | yes | yes | yes |
| Load | no | no | no | no | no |

Validate does not feed Extract: extraction belongs before rules that check the extracted fields. Rules beyond the table: a target role accepts one edge unless its cardinality is `many`; an edge must not create a cycle; a combine input may come from any dataset-producing node (raw or transformed). Validate feeding Transform is allowed because review holds failing rows only at gates (7), so a Transform after Validate never sees a held row.

## 7. Review in a graph

### 7.1 Path-scoped issues

Every issue records the node that raised it (`Issue.stepId`). **Issues travel with the data along connections**: each node's output carries the issue list of its path. A node starts from its primary input's list exactly as it is, adds issues from further inputs that are not already present (a diamond shares ancestors), then applies today's bookkeeping (Rename renames issue columns, Select / Filter / Remove duplicates / inner Join prune issues of removed rows) and appends what it raised. As a result:

- the same source row in two branches can be held in one and loaded by the other, if only one branch flagged it;
- a Rename or a Filter on one branch never changes the issues another branch sees.

An earlier draft scoped one run-wide list by ancestor sets. That breaks on a diamond: pruning a row's issue on one branch would remove it for the other branch too. Per-path lists avoid this. In Python, the `@node` decorator swaps the per-node list into the runtime's `ISSUES` before the step runs and stores it afterwards, so step functions are unchanged and readable. For a chain, the per-path list is exactly today's run-wide list.

### 7.2 Gates

A gate holds rows with unresolved, in-scope issues and applies decisions. Gates run:

1. before an identity-changing node on its `input` or `primary` or `left` input (today's rule, unchanged);
2. before any multi-input node on every **non-primary** input (`right`, `reference`, each Append input after slot 0). A reference row with an open issue must not silently enrich primary rows; it is held, and primary rows that would have matched it become unmatched (and go to review if the Lookup flags unmatched rows);
3. before every Load, on its input (today's final gate).

For a migrated pipeline, rule 2 only ever gates raw side sources, which have no issues, so it is a no-op and results are identical.

### 7.3 Results and traceability

- Each Load produces its own output. A run's `reviewRows` is the union across gates, deduplicated, in first-held order.
- A review item is `(run, node, row)`. The row decodes to `(source node, source row)` by 5. The node's review count opens only its items (already true for steps today).
- Decisions keep their shape: `{ row, column, action, fingerprint }`. Primary-source and created-row IDs are unchanged by migration, so every existing decision still applies. Decisions on branch rows use the namespaced IDs and the same fingerprint check.

## 8. Schema propagation

`inferSchema(node, inputSchemas) -> Schema` returns the columns and types a node outputs, **without data where possible**:

- static: Select, Rename, Extract, Key-value, Split, Formula, Convert, Date, Group (by plus aggregations), Unpivot, Join and Lookup (left plus brought columns with prefix), Append (union in slot order after mapping), Validate, Filter, Sort, Clean ops;
- data-dependent: Pivot (its output columns are the pivoted values). It returns `dynamic`, resolved from the live preview when available. Downstream references to a dynamic schema are checked at preview time, not at edit time.

Schemas recompute on every edit in topological order. A Rename of `region` to `region_code` immediately invalidates a downstream Join keyed on `region`, with the cause named on the Join node, its incoming edge and its inspector.

## 9. Migration from PipelineSpec v1

### 9.1 Mapping

`migrateSpec(v1) -> v2` is pure and deterministic:

| v1 | v2 |
| --- | --- |
| `spec.source` | node `source` (`op: "source"`, `order: -1`), the primary source |
| each step `i` | node with the step's id (`order: i`), config = step minus `source` |
| chain | edges `prev -> step` with role `input`, `primary` (Lookup), `left` (Join) or `datasets` slot 0 (Append) |
| combine `step.source` | node `side:<fileId>:<sheet>` (`op: "source"`, `order` just before its first consumer), edge role `reference`, `right` or `datasets` slot 1. One node per distinct file and sheet, shared by every consumer, as on today's canvas. A combine step reading the main source file also gets its own `side:` node: today it reads the whole file even when the main source is sampled for a preview, and a separate node keeps that exactly. |
| `spec.destination` | node `load` (`order: n`), edge `last -> load` |
| `reviewDecisions` | unchanged |

Node ids equal today's canvas node ids (`source`, step ids, `side:<fileId>:<sheet>`, `load`), so **canvas positions carry over with no rewrite**.

### 9.2 Equivalence guarantee

Before the graph executor replaces the linear one:

- the linear executor stays in the codebase as the reference;
- a test migrates every existing parity fixture and asserts `executeGraph(migrateSpec(spec))` equals `execute(spec)`: output cells, row IDs, review rows, excluded rows, issues and rule results;
- the same holds for the generated Python: the v2 code generator on a migrated linear spec produces the same output as the v1 generator.

### 9.3 Stored data

Implemented as a lazy, optional field rather than a schema migration:

- `PipelineSpec.graph?: { sources, edges, nextRank }`. Absent: the pipeline is the linear chain and runs exactly as before (migrated on the fly by `toGraphSpec`). Present: execution follows the stored connections; `steps` keeps every step's configuration in creation order.
- The field is written the first time someone edits a connection (`materialize`, which stores exactly the migrated chain, so nothing that runs changes). Existing pipelines, versions, runs and review decisions need no rewrite.
- Combine steps keep their `source` field in step with their second input (`syncCombineInputs`), so the existing editors work unchanged: picking a project source points the second input at it; connecting another step's output there describes that step on the step.
- Node ids stay the canvas ids, so positions carry over. `pipeline.json` exports are `formaSpec: 2` when connections are explicit.

## 10. Generated Python

### 10.1 Shape

One function per node, as today; each takes its inputs by role and returns a DataFrame. The driver reads like the pipeline:

```python
def run(config: dict = CONFIG):
    start_run(config)
    invoices = load_invoices(config)                  # 01 Source: invoices.xlsx
    invoices = step_02_select_columns(invoices)
    invoices = step_03_extract_invoice_fields(invoices)
    customers = load_customers(config)                # 04 Source: customers.csv
    customers = step_05_trim_customer(customers)
    invoices = step_06_lookup_customers(invoices, customers)
    invoices = step_07_validate_invoice(invoices)
    return finish_run({"load": invoices})
```

Variable naming: a chain keeps one variable named after its source (`invoices`), reassigned at each step. A fan-out gives each branch a new variable named after its first node (`invoices_by_region`). A merge result keeps the primary or left input's name. Names are snake_case and deduplicated. For a migrated linear pipeline the driver has the same calls in the same order as today, so readers see no difference.

### 10.2 Node table for the server

The module also exports a node table:

```python
NODES = {
    # id: label, function, inputs (primary first), whether each input is gated
    "x3": {"label": "Extract: Extract invoice fields", "function": "step_03_extract_invoice_fields", "inputs": ["x2"], "gates": [False]},
    "c6": {"label": "Lookup: Lookup customers.csv", "function": "step_06_lookup_customers", "inputs": ["x3", "t5"], "gates": [False, True]},
}
```

With the export switch (Phase 9), `server/forma_server/runner.py` will prefer `NODES` when present (keeping outputs in a dict by node id and recording metrics per node) and fall back to `STEPS` for older exports. For linear graphs the generator will keep writing `STEPS` too, so an older server keeps working with new exports.

### 10.3 Runtime changes

The linear runtime is reused unchanged. The graph runtime adds:

- `@node("id")`: gates the node's inputs per `NODES` and carries each path's issue list (7.1);
- `read_source(id)`: loads a source with namespaced row IDs (5);
- `run_all(config)` returning every Load's output, `run(config)` returning the first, and `write_outputs` writing each destination.

## 11. Parity strategy

The harness in `web/tests/parity/parity.test.ts` already runs both engines and compares columns, row IDs, every cell, review rows, excluded rows, issue count and rule counts. It extends to graphs by comparing **per Load output** and the union of review rows.

Required scenarios before Phase 8 ships:

| Scenario | Proves |
| --- | --- |
| every existing fixture, migrated | equivalence with v1 (9.2) |
| two sources, each cleaned, then Join | transformed inputs, namespaced IDs, gate on the right input |
| Lookup whose reference branch flags a row | rule 7.2.2: held reference row, primary rows become unmatched and flagged |
| Append of three month files with a schema mapping | many-input ordering by slot, mapping, ID allocation order |
| fan-out to two Loads with different filters | per-Load outputs, path-scoped issues (row held in one branch, loaded in the other) |
| diamond: one source, two branches, Join back on a key | shared ancestry, ancestor scopes on both sides |
| Rename on one branch, Validate on the other | scoped `rename_issues` |
| Group after a merge | gate before identity change on a merged dataset, counter order |
| random node positions | layout never changes output or generated code (extends today's canvas test) |
| two valid topological orders differing only by `order` | `order` alone decides ID allocation |

Plus unit tests for: cycle detection, missing input, cardinality, compatibility table, topological tie-break, schema inference including `dynamic`, migration (ids, positions, decisions), and validation messages.

## 12. Phase 8 plan (graph engine, internal)

Each step lands with its tests and leaves production behaviour unchanged until 8.5.

Progress: 8.1 to 8.4 are done. For 8.5, execution is switched: `executeSpec` (`web/src/engine/graph/run.ts`) migrates each pipeline and runs it through the graph engine for previews, test runs and full runs. Storage, editors, export and the server runner still use the linear spec; they move together with Phase 9, because until connections are editable every pipeline is linear and the linear spec is a lossless representation of it.

Failure behaviour: when a step fails, everything downstream of it is skipped, a Load whose input failed receives the last good data on its path (as the linear engine does), and the run is reported as failed. Independent branches still run in the TypeScript preview; the generated Python stops at the first exception, as today.

1. **Model:** `web/src/engine/graph/` with `PipelineGraph` types, `migrateSpec`, `topoOrder`, `ancestors`, `validateGraph`, `inferSchema`, compatibility table. Pure, no UI.
2. **Executor:** `executeGraph`, reusing `applyStep` per node, with namespaced IDs, scoped issues and the gate rules. Equivalence test against `execute` on all fixtures.
3. **Code generator:** graph driver, node table, runtime scope parameters. Equivalence test against the v1 generator on migrated fixtures.
4. **Parity:** the scenarios in 11.
5. **Switch:** storage migration to `formaSpec: 2`; the workspace, preview hook, worker, run recording, review, export and server runner read the graph. The canvas derives nodes and edges from `graph` instead of `deriveGraph(spec)`. Still no editable connections.

Phase 9 is implemented: handles appear on hover or selection; compatible targets highlight while dragging (from the one compatibility table); a drop is validated before the connection is created; a selected connection offers Disconnect and Inspect flow, and either end can be dragged to reconnect; the "+" on any connection inserts a tool there; and every node's inspector has a Connections section (connect from, connect to, disconnect) so no action needs a precise drag. An edit that leaves the pipeline incomplete asks before it is kept, shows the problem on the node, and runs are refused until it is fixed.

Originally planned: Phase 9 (editable connections: handles on hover or selection, compatible-target highlighting from 6.1, validation before the edge is created, Disconnect and Reconnect on a selected edge, and an accessible "Connect to..." menu so no action needs a precise drag), and Phase 10 (branching to several Loads).

Phase 10 is implemented: extra Loads are stored in `graph.loads` (the main Load stays `destination`), added from Add Tool or by connecting to a Load, configured and removed in their own inspector, and shown on the canvas with their real row counts. Runs keep every Load's output and summarise each in `Run.loads`; generated Python returns the main Load first and writes every destination; the server reports each Load.

## 13. Open questions for review

1. **Reference-row gating (7.2 rule 2).** Holding a flagged reference row makes matching primary rows unmatched. The alternative is to fail the Lookup. Holding is consistent with "never silently load bad data" and keeps runs going; confirm.
2. **Multiple Loads and the review count.** A row held in two branches is one review item per issue, shown once per node. The run summary counts distinct rows. Confirm that this is the number users expect.
3. **Append inputs.** Today one Append step adds one dataset. With a graph, one Append node takes two or more. Migration keeps chains of single Appends (unchanged output); the UI can offer "merge into one Append" later.
4. **Primary source for review IDs.** The primary source is the first source node by `order`. If a user deletes it in a graph with several sources, the next source becomes primary and its IDs change from namespaced to `1..N`, which orphans its decisions. Option: keep the namespaced rank permanently once a pipeline has more than one source. Recommendation: rank is assigned once at creation and never reused.
