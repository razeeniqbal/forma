// FORMA Docs: how to use the product. Only documents what exists; planned concepts are labelled.
//
// Inline markup: **bold**, `code`, [text](doc:slug) for a link to another page.
// Writing rule: no em dashes anywhere. Use full stops, commas, colons or parentheses.

export type DocBlock =
  | { p: string }
  | { h: string }
  | { list: string[] }
  | { steps: string[] }
  | { flow: string[] }
  | { code: string }
  | { note: string; tone?: "info" | "planned" };

export interface DocPage {
  slug: string;
  section: string;
  title: string;
  /** One sentence: search results, tooltips and the section index. */
  summary: string;
  /** Text of contextual links that open this page, e.g. "How Join works". */
  learn?: string;
  body: DocBlock[];
  related?: string[];
}

export const DOC_SECTIONS = ["Getting Started", "Pipeline Canvas", "Tools", "Combining Data", "Sources", "Review", "Execution", "Engineering", "Reference"] as const;

export const DOCS: DocPage[] = [
  // ------------------------------------------------------------------ Getting Started
  {
    slug: "getting-started",
    section: "Getting Started",
    title: "What is FORMA?",
    summary: "A visual data workbench that shapes messy data into reliable pipelines and readable Python.",
    body: [
      { p: "FORMA turns messy files into reliable pipelines. You see your data, shape it with tools you can preview, check it with explicit rules, review the rows that need a decision, run it, and keep the code." },
      { flow: ["Project", "Source", "Pipeline", "Run"] },
      { p: "Inside a pipeline, tools fall into five categories. This is a way to think about a pipeline, not a fixed order." },
      { flow: ["Source", "Extract", "Transform", "Validate", "Load"] },
      { list: ["**Simple by default.** The canvas, a node and its quick inspector are enough for most work.", "**Powerful when expanded.** The Workbench, Engineer view and Docs are one click away.", "**Your pipeline, your code, your data.** Every pipeline exports as readable Python that produces the same output."] },
    ],
    related: ["getting-started-project", "canvas-basics", "tools-transform"],
  },
  {
    slug: "getting-started-project",
    section: "Getting Started",
    title: "Create a project",
    summary: "A project holds the sources, pipelines and runs for one data problem.",
    body: [
      { p: "Projects are the home screen. Each project keeps its own sources, pipelines, runs and settings, such as the default place runs execute." },
      { steps: ["Open **Projects** and choose **New project**.", "Give it a name and an optional description.", "Tick **Start from example** to begin with sample invoice data, or start empty."] },
      { p: "Choose **Explore the example project** on the Projects home to open a ready-made Invoice Processing project." },
    ],
    related: ["getting-started-source", "getting-started-pipeline"],
  },
  {
    slug: "getting-started-source",
    section: "Getting Started",
    title: "Add a source",
    summary: "Upload a file or connect a database or API. Sources are stored once and referenced by pipelines.",
    body: [
      { p: "Open **Sources** in a project and drop a file, or choose a database or API source when a FORMA Server is connected." },
      { p: "A source is stored once. Pipelines **reference** it, so several pipelines can read the same file without copies. Every sheet of an Excel workbook is its own selectable source." },
      { p: "FORMA detects the header row and data region and lists quality observations, such as mixed date formats or stray whitespace. Detection is advisory: nothing changes until you apply a tool." },
    ],
    related: ["sources-csv", "sources-excel", "tools-source"],
  },
  {
    slug: "getting-started-pipeline",
    section: "Getting Started",
    title: "Create a pipeline",
    summary: "Pick a project source and FORMA opens the pipeline canvas.",
    body: [
      { steps: ["Open **Pipelines** and choose **New pipeline**.", "Pick a source (and a sheet for workbooks).", "The pipeline opens on the canvas with a Source node and a Load node."] },
      { p: "From there, add tools between them. A new pipeline shows the common flow as guidance; you can build it in any order that makes sense for your data." },
    ],
    related: ["getting-started-add-tool", "canvas-basics"],
  },
  {
    slug: "getting-started-add-tool",
    section: "Getting Started",
    title: "Add a tool",
    summary: "One entry point, + Add Tool, organised by Source, Extract, Transform, Validate and Load.",
    learn: "Learn about adding tools",
    body: [
      { p: "Choose **+ Add Tool** on the canvas, the **+** on a connection, or press Ctrl/Cmd K and type what you want." },
      { p: "The first level shows the five categories. **Transform** opens its groups: Clean, Convert, Structure, Reshape, Combine and Calculate. Each group lists its operations." },
      { p: "Or search. Typing `date` finds `Transform > Convert > Date`, `Extract > Pattern extraction` and `Validate > Validation rules`." },
      { p: "Every tool previews before it is applied. Nothing changes your pipeline until you choose **Apply**." },
      { h: "Direct manipulation" },
      { p: "In the Workbench, click a column header to see its profile, detected patterns and suggested actions. Choosing an action opens the same tool, already pointed at that column." },
    ],
    related: ["tools-extract", "tools-transform", "canvas-adding-tools"],
  },
  {
    slug: "getting-started-run",
    section: "Getting Started",
    title: "Run a pipeline",
    summary: "Test Run on a sample, or Run every row against a saved version.",
    body: [
      { list: ["**Test Run** runs the current draft on a sample (Settings, Test run rows).", "**Run** saves an immutable version and runs every row."] },
      { p: "While it runs, the canvas shows each step as it completes, with its real row counts and timing. When it finishes, a summary shows rows in, rows ready and rows that need review." },
    ],
    related: ["execution-test-run", "execution-manual-run", "canvas-running"],
  },
  {
    slug: "getting-started-review",
    section: "Getting Started",
    title: "Review exceptions",
    summary: "Rows FORMA cannot transform or validate confidently go to review instead of being loaded.",
    body: [
      { p: "A node that sent rows to review shows a count such as **28 review**. Click it to open the review queue filtered to that step." },
      { p: "For each row you can correct a value, keep the original, exclude the row or ignore the warning, and apply the same decision to similar rows." },
    ],
    related: ["review-why", "review-correct"],
  },
  {
    slug: "getting-started-export",
    section: "Getting Started",
    title: "Export a pipeline",
    summary: "Download readable pandas code that produces exactly what FORMA produces.",
    body: [
      { p: "Choose **Export** in a pipeline. You get a single `pipeline.py` or a full project with requirements, config, a README and FORMA's own output as a parity reference." },
      { code: "python pipeline.py --check expected/forma_output.csv" },
    ],
    related: ["engineering-export", "engineering-parity"],
  },

  // ------------------------------------------------------------------ Pipeline Canvas
  {
    slug: "canvas-basics",
    section: "Pipeline Canvas",
    title: "Canvas basics",
    summary: "Every pipeline opens on a calm, free-movable canvas. Click a node to inspect it.",
    learn: "Learn about the canvas",
    body: [
      { flow: ["Canvas", "Node", "Inspect", "Configure", "Run"] },
      { p: "Each node is one tool. It shows its category, what it does, how many rows it changed, its status and, where relevant, how many rows need review." },
      { p: "Click a node to open its **quick inspector**: example input and output, row impact and the actions that matter. Choose **Configure** to change it, or **Open Workbench** for deep investigation." },
      { note: "Position is visual. Connection is logical. Execution is deterministic. Moving nodes never changes what runs." },
    ],
    related: ["canvas-moving", "canvas-connections", "canvas-row-counts"],
  },
  {
    slug: "canvas-moving",
    section: "Pipeline Canvas",
    title: "Moving nodes",
    summary: "Drag nodes anywhere. Positions are remembered per pipeline and never affect execution.",
    body: [
      { p: "Drag a node to move it, or focus it with Tab and use the arrow keys. Positions are saved per pipeline and restored when you come back from the Workbench or the review queue." },
      { p: "**Undo layout change** in the canvas toolbar reverts the last move. Pipeline edits have their own undo (Ctrl/Cmd Z)." },
    ],
    related: ["canvas-auto-layout", "canvas-pan-zoom"],
  },
  {
    slug: "canvas-pan-zoom",
    section: "Pipeline Canvas",
    title: "Pan and zoom",
    summary: "Drag the background or scroll to pan. Ctrl/Cmd plus scroll, or pinch, to zoom.",
    body: [{ list: ["Pan: drag the background, or scroll.", "Zoom: Ctrl/Cmd and scroll, pinch, or the toolbar buttons.", "The view (position and zoom) is remembered per pipeline."] }],
    related: ["canvas-fit"],
  },
  {
    slug: "canvas-fit",
    section: "Pipeline Canvas",
    title: "Fit Pipeline",
    summary: "Fit brings the whole pipeline into view.",
    body: [{ p: "Choose **Fit** in the canvas toolbar, or **Fit Pipeline** in the command palette, to frame every node." }],
    related: ["canvas-auto-layout"],
  },
  {
    slug: "canvas-auto-layout",
    section: "Pipeline Canvas",
    title: "Auto Layout",
    summary: "Arranges nodes in execution order. Presentation only.",
    body: [
      { p: "**Auto layout** places the main chain left to right in execution order, wrapping long pipelines into rows. Supporting sources sit below the step that reads them, so Join, Lookup and Append inputs stay readable." },
      { p: "Auto layout changes positions only. It can be undone with **Undo layout change**." },
    ],
    related: ["canvas-moving", "combine-multiple-sources"],
  },
  {
    slug: "canvas-adding-tools",
    section: "Pipeline Canvas",
    title: "Adding tools",
    summary: "Use + Add Tool, the + on a connection, or drag a project source onto the canvas.",
    body: [
      { list: ["**+ Add Tool** adds after the selected node (or after a selected source, to prepare it).", "The **+** on a connection inserts a tool at that point.", "**Sources** in the canvas toolbar lists the project's sources. Drag one onto the canvas, or click it, to look up columns from it or append its rows. The source is referenced, never copied."] },
    ],
    related: ["getting-started-add-tool", "combine-lookup", "combine-append"],
  },
  {
    slug: "canvas-connections",
    section: "Pipeline Canvas",
    title: "Understanding connections",
    summary: "A connection is a dataset dependency: data flows from one node into the next.",
    body: [
      { p: "Connections show how data moves. The main chain runs from Source through each tool to Load in execution order. A supporting source connects into the Join, Lookup or Append that reads it." },
      { p: "A connection is a dataset dependency: the tool on the right reads the output of the tool on the left. Execution follows connections, never positions." },
      { p: "You can connect, disconnect and reconnect tools. See [Connecting tools](doc:canvas-connecting)." },
    ],
    related: ["canvas-connecting", "canvas-branching", "engineering-graph", "canvas-row-counts"],
  },
  {
    slug: "canvas-connecting",
    section: "Pipeline Canvas",
    title: "Connecting tools",
    summary: "Drag from a tool's output to another tool's input, or use Connections in the inspector.",
    learn: "Learn about connecting tools",
    body: [
      { steps: ["Hover or select a tool: its connection points appear.", "Drag from the output on its right edge.", "Tools that can take the connection light up; the rest fade.", "Drop on an input: the left edge is the main input, the bottom edge the second input of a Join, Lookup or Append."] },
      { p: "Select a connection to **Disconnect** it or **Inspect flow**. Drag either end of a selected connection to reconnect it. The **+** on a connection inserts a tool there, including on the second input of a combine step." },
      { p: "Without dragging: open a tool and expand **Connections**. Each input lists what feeds it, with **Disconnect**, and **Connect from...** lists every compatible tool. **Connect to...** sends the tool's output onward." },
      { h: "Rules" },
      { list: ["A source has no inputs; Load ends a branch.", "A tool takes one main input. Join and Lookup also take one second input; Append takes two or more datasets.", "Validate does not feed Extract.", "Loops are not allowed: a tool can never read its own output, directly or through others."] },
      { p: "FORMA checks every change against these rules first. If a change leaves the pipeline incomplete (for example, Load without an input), FORMA says so and asks before keeping it, shows the problem on the tool, and does not run the pipeline until it is fixed." },
      { note: "Moving tools never changes what runs. Connections do." },
    ],
    related: ["combine-multiple-sources", "canvas-branching", "canvas-connections", "engineering-graph"],
  },
  {
    slug: "canvas-branching",
    section: "Pipeline Canvas",
    title: "Branching to several Loads",
    summary: "Write one pipeline's data to more than one destination, each from the point you choose.",
    learn: "Learn about branching",
    body: [
      { flow: ["Source", "Extract", "Transform", "Load (main)"] },
      { p: "A branch is a second Load that reads the output of any tool. For example, write the cleaned invoices to the warehouse, and the paid invoices to a separate CSV." },
      { steps: ["Select the tool whose output the branch should write.", "Choose **+ Add Tool**, then **Load**, then **New Load (branch)**. Or connect a tool's output to a Load in **Connections**.", "Set the branch's destination: a file or a database table.", "Add tools between the branch point and its Load to shape that output (for example a Filter)."] },
      { p: "Each Load has its own review gate: a row flagged on one branch is held there, and still loads on a branch that did not flag it. The run summary lists every output, with its own row counts and a download." },
      { p: "Generated Python writes every Load, and the FORMA Server reports each one." },
    ],
    related: ["tools-load", "canvas-connecting", "review-why"],
  },
  {
    slug: "canvas-row-counts",
    section: "Pipeline Canvas",
    title: "Understanding row counts",
    summary: "Nodes and connections show real row counts, labelled where the number changes.",
    body: [
      { p: "A node shows `12,482 → 12,454` when it changes the number of rows, or `12,454 ready` when it does not. A review count shows how many rows that step sent to review." },
      { p: "Connections are labelled where it helps: after the source, and wherever the row count changed. Inputs of Join, Lookup and Append show the size of the dataset they bring in." },
      { p: "Counts come from the live preview (a sample, labelled as such), the latest run, or the run in progress. The label at the top of the canvas says which." },
    ],
    related: ["canvas-running", "review-why"],
  },
  {
    slug: "canvas-running",
    section: "Pipeline Canvas",
    title: "Running the flow",
    summary: "During a run, the canvas follows the engine's real events, step by step.",
    learn: "Learn about runs on the canvas",
    body: [
      { p: "When a run starts, the source loads first, then each step runs in order. The connection into the running step is drawn as a moving dashed line; finished steps show their real row counts and timing." },
      { p: "FORMA shows only what the engine reports: a step started, a step completed, rows in, rows out, duration and review count. It does not show percentages within a step." },
      { p: "With reduced motion turned on in your system settings, the active connection is a solid, highlighted line instead of an animation." },
    ],
    related: ["execution-manual-run", "canvas-row-counts"],
  },

  // ------------------------------------------------------------------ Tools
  {
    slug: "tools-source",
    section: "Tools",
    title: "Source",
    summary: "Bring data into the pipeline.",
    learn: "Learn about Source",
    body: [
      { p: "Every pipeline reads one main source. Join, Lookup and Append bring in more project sources." },
      { p: "Select the Source node to see the detected header and data region, change the sheet, or replace the file with a compatible one. The original upload stays unchanged." },
    ],
    related: ["getting-started-source", "sources-csv", "combine-multiple-sources"],
  },
  {
    slug: "tools-extract",
    section: "Tools",
    title: "Extract",
    summary: "Turn messy or semi-structured content into structured fields.",
    learn: "Learn about Extract",
    body: [
      { list: ["**Pattern extraction**: pull fields out of text with patterns, with a live match rate and the rows that failed.", "**Key-value extraction**: parse `key: value; key: value` text into columns.", "**Split**: split text by a delimiter into columns."] },
      { code: "INPUT    Inv #INV-2231, Due 15/10/2026, Total RM 4,500\n\nOUTPUT   invoice_no     INV-2231\n         invoice_date   15/10/2026\n         total          RM 4,500" },
      { p: "Rows where a required field does not match go to review instead of being loaded with blanks. With a FORMA Server connected, **Suggest with AI** can propose patterns; the step still runs as plain patterns you can read." },
    ],
    related: ["review-why", "transform-convert"],
  },
  {
    slug: "tools-transform",
    section: "Tools",
    title: "Transform",
    summary: "Clean, convert, reshape or combine data.",
    learn: "Learn about Transform",
    body: [
      { p: "Transform tools are grouped so you never see every operation at once." },
      { list: ["[Clean](doc:transform-clean): trim, replace, fill blanks, change case.", "[Convert](doc:transform-convert): number, date.", "[Structure](doc:transform-structure): select, rename, filter, sort, remove duplicates.", "[Reshape](doc:transform-reshape): group, pivot, unpivot.", "[Combine](doc:transform-combine): join, lookup, append.", "[Calculate](doc:transform-calculate): formula, round."] },
    ],
    related: ["getting-started-add-tool"],
  },
  {
    slug: "transform-clean",
    section: "Tools",
    title: "Clean",
    summary: "Trim, replace, fill blanks and change case.",
    body: [{ list: ["**Trim** removes leading and trailing spaces, and can collapse repeated spaces.", "**Replace** matches exactly, by contains, or by regex.", "**Fill blanks** sets a default for empty values.", "**Change case** makes text UPPER, lower or Title case."] }],
    related: ["tools-transform", "transform-convert"],
  },
  {
    slug: "transform-convert",
    section: "Tools",
    title: "Convert",
    summary: "Turn text into numbers and dates you can rely on.",
    body: [
      { list: ["**Number** parses numbers, currency and thousands separators, such as `RM 10,975.00`.", "**Date** recognises mixed date formats and writes one format."] },
      { p: "Values that cannot be converted are flagged and sent to review, never silently blanked." },
    ],
    related: ["review-why", "tools-validate"],
  },
  {
    slug: "transform-structure",
    section: "Tools",
    title: "Structure",
    summary: "Select, rename, filter, sort and remove duplicates.",
    body: [
      { list: ["**Select** keeps and orders columns.", "**Rename** gives columns clear names.", "**Filter** keeps rows that match a condition.", "**Sort** orders rows by a column.", "**Remove duplicates** keeps the first row for each key."] },
      { p: "Renaming or removing a column affects every tool after it. If a later tool still uses the old name, its node shows the problem and explains which step changed it." },
    ],
    related: ["combine-schema"],
  },
  {
    slug: "transform-reshape",
    section: "Tools",
    title: "Reshape",
    summary: "Group, pivot and unpivot.",
    body: [
      { list: ["**Group** summarises rows with sum, average, min, max, count, count distinct or first.", "**Pivot** turns row values into columns.", "**Unpivot** turns columns into rows."] },
      { p: "Rows with open review items are held back before any step that changes row identity, so a bad row never distorts a total. Corrections flow into totals on the next run." },
    ],
    related: ["review-why"],
  },
  {
    slug: "transform-combine",
    section: "Tools",
    title: "Combine",
    summary: "Join, Lookup and Append bring a second dataset into the pipeline.",
    learn: "Learn about combining data",
    body: [{ list: ["[Join](doc:combine-join): combine two datasets on keys; rows can multiply.", "[Lookup](doc:combine-lookup): enrich rows from a reference dataset; first match, row count kept.", "[Append](doc:combine-append): stack rows from another dataset."] }],
    related: ["combine-multiple-sources", "combine-schema"],
  },
  {
    slug: "transform-calculate",
    section: "Tools",
    title: "Calculate",
    summary: "Formula and Round.",
    body: [{ list: ["**Formula** calculates a new column from others, for example `[Amount] * 1.06`.", "**Round** rounds numbers to a number of decimals."] }],
    related: ["tools-transform"],
  },
  {
    slug: "tools-validate",
    section: "Tools",
    title: "Validate",
    summary: "Check data against explicit rules. Failing rows go to review.",
    learn: "Learn about validation",
    body: [
      { list: ["Not blank", "Pattern", "Valid date", "Numeric bounds (greater than, at least, less than, at most)", "Allowed values", "Unique"] },
      { p: "A Validate node shows how many rules it applies, how many rows are ready and how many need review." },
      { p: "Validation health is reported with its context: how many rows each rule evaluated and passed. FORMA never reports an unexplained score." },
    ],
    related: ["review-why", "review-rules"],
  },
  {
    slug: "tools-load",
    section: "Tools",
    title: "Load",
    summary: "Send processed data somewhere. Load ends the pipeline.",
    learn: "Learn about Load",
    body: [
      { list: ["**File**: CSV, Excel (.xlsx) or JSON, written to the path you set in the exported project.", "**Database**: a table through a connection. The URL is read from an environment variable and never stored in FORMA or in code."] },
      { p: "Only rows that pass review are loaded. In the browser, a run keeps its output so you can download it from the run page." },
      { p: "A pipeline can have more than one Load: see [Branching to several Loads](doc:canvas-branching)." },
    ],
    related: ["engineering-export", "review-why"],
  },

  // ------------------------------------------------------------------ Combining Data
  {
    slug: "combine-join",
    section: "Combining Data",
    title: "Join",
    summary: "Combine two datasets on key columns. Every match is kept, so rows can multiply.",
    learn: "How Join works",
    body: [
      { flow: ["Orders (left)", "Join", "Customers (right)"] },
      { p: "The **left input** is the data flowing through the pipeline. The **right input** is another project source, or the output of tools that prepared one (see [Multiple sources](doc:combine-multiple-sources))." },
      { list: ["**Match**: one or more key pairs, such as `Orders.customer_id = Customers.customer_id`.", "**Rows without a match**: keep them (left join, brought columns stay blank) or drop them (inner join).", "**Columns to bring in** from the right input, with a prefix when a name already exists."] },
      { p: "FORMA suggests key pairs from matching column names and the share of values that overlap. It never picks keys for you: choose **Use** on a suggestion or set the keys yourself." },
      { p: "The inspector previews left rows, right rows, matched and unmatched rows, and the result size before you run." },
      { p: "Rows with open review items are held back before a Join, because a join changes row identity." },
    ],
    related: ["combine-lookup", "combine-schema", "combine-multiple-sources"],
  },
  {
    slug: "combine-lookup",
    section: "Combining Data",
    title: "Lookup",
    summary: "Enrich rows with columns from a reference dataset. The first match is used and row identity is kept.",
    learn: "How Lookup works",
    body: [
      { flow: ["Production (primary)", "Lookup", "Region Mapping (reference)"] },
      { p: "The **primary dataset** is the data flowing through the pipeline. The **reference dataset** provides the extra columns." },
      { list: ["**Keys**: primary column and reference column, confirmed by you.", "**Fields to bring across**.", "**First match** (Lookup) or **every match** (switch to Join).", "**Unmatched rows**: keep or drop.", "**Review**: optionally send unmatched rows to review."] },
      { code: "12,482 primary rows    16 reference rows\n12,454 matched         28 unmatched" },
    ],
    related: ["combine-join", "review-why"],
  },
  {
    slug: "combine-append",
    section: "Combining Data",
    title: "Append",
    summary: "Stack rows from another dataset below the pipeline's rows.",
    learn: "How Append works",
    body: [
      { flow: ["January.csv", "Append", "February.csv"] },
      { p: "Columns line up by name. Before you apply, FORMA checks schema compatibility: matched columns, pipeline columns the appended data lacks (left blank), additional columns (added) and type conflicts." },
      { p: "When names differ, map them explicitly. FORMA suggests likely pairs but never accepts an uncertain mapping on its own." },
      { code: "SCHEMA MAPPING\n\nJanuary          February\ndate          <- report_date\nproduct       <- product_name\nvolume        <- quantity" },
      { p: "Append one more Append step per additional dataset to stack three or more. Appended rows get new row numbers." },
    ],
    related: ["combine-schema", "combine-multiple-sources"],
  },
  {
    slug: "combine-multiple-sources",
    section: "Combining Data",
    title: "Multiple sources",
    summary: "One pipeline can read several project sources through Join, Lookup and Append.",
    body: [
      { p: "The main source feeds the pipeline. Each Join, Lookup or Append reads one more dataset, drawn as its own node connected into the step that reads it." },
      { h: "Prepare each dataset before combining" },
      { steps: ["Open **Sources** on the canvas and drag a project source in.", "Choose **Add as a source to prepare first**, then add the tools it needs (Trim, Convert and so on).", "Connect the last of those tools to the second input of your Join, Lookup or Append."] },
      { flow: ["Customers", "Trim", "Lookup (reference)"] },
      { p: "Rows flagged on the reference path are held for review before the Lookup, so a bad reference row never silently enriches your data." },
      { p: "Sources are referenced, never copied: updating a project source updates every pipeline that reads it." },
    ],
    related: ["combine-join", "engineering-graph"],
  },
  {
    slug: "combine-schema",
    section: "Combining Data",
    title: "Schema compatibility",
    summary: "FORMA checks columns and types before you run, and explains problems where they happen.",
    body: [
      { p: "Every node exposes the columns it outputs. The quick inspector shows how many columns a step produces and which it added or removed." },
      { p: "When an earlier step changes a column that a later step uses, the later node shows the problem and explains it. For example: `Step 03 (Rename columns) renamed \"region\" to \"region_code\".`" },
      { p: "Join and Lookup keys must exist on both sides. Append shows matched, missing and additional columns and type conflicts before you apply it." },
    ],
    related: ["combine-append", "transform-structure"],
  },

  // ------------------------------------------------------------------ Sources
  {
    slug: "sources-csv",
    section: "Sources",
    title: "CSV",
    summary: "Comma, semicolon, tab or pipe separated files; the delimiter is detected.",
    body: [{ p: "FORMA detects the delimiter, header row and data region. TSV files are read with a tab delimiter." }],
    related: ["sources-excel", "getting-started-source"],
  },
  {
    slug: "sources-excel",
    section: "Sources",
    title: "Excel",
    summary: "Every sheet of a workbook is its own source. Merged cells and title rows are handled.",
    body: [
      { p: "Pick the sheet when creating a pipeline, or create one pipeline per sheet. Switch sheets from the Source node. Use Append or Lookup to bring in other sheets." },
      { p: "Header detection skips title rows above the table. Merged cells outside the data region are ignored." },
    ],
    related: ["sources-csv", "combine-append"],
  },
  {
    slug: "sources-json",
    section: "Sources",
    title: "JSON and JSONL",
    summary: "Arrays of records become rows; JSON Lines files are read one record per line.",
    body: [{ p: "Each record becomes a row and each top-level key a column. When the file is an object, FORMA reads the first array inside it. Nested values are kept as JSON text, ready for Extract." }],
    related: ["sources-text"],
  },
  {
    slug: "sources-text",
    section: "Sources",
    title: "Text",
    summary: "Plain text and log files become one row per line, ready for Extract.",
    body: [{ p: "Each line is a row in a single column. Use [Extract](doc:tools-extract) to turn lines into fields." }],
    related: ["tools-extract"],
  },
  {
    slug: "sources-database",
    section: "Sources",
    title: "Database",
    summary: "PostgreSQL, MySQL and SQLite queries through a connected FORMA Server.",
    body: [
      { p: "Connect a FORMA Server in Settings, then add a database source with a query. The connection URL lives in an environment variable on the server; FORMA never stores the secret." },
      { p: "The generated code re-reads the query live when it runs." },
    ],
    related: ["execution-server", "sources-api"],
  },
  {
    slug: "sources-api",
    section: "Sources",
    title: "API and Google Sheets",
    summary: "JSON or CSV endpoints and Google Sheets shared by link, through a connected FORMA Server.",
    body: [{ p: "Add an API source with a URL and format. An optional token is read from an environment variable on the server. A Google Sheet shared by link is read as CSV." }],
    related: ["sources-database", "execution-server"],
  },

  // ------------------------------------------------------------------ Review
  {
    slug: "review-why",
    section: "Review",
    title: "Why rows enter review",
    summary: "Rows FORMA cannot transform or validate confidently are held back, never silently loaded.",
    learn: "How Review works",
    body: [
      { list: ["An extraction pattern did not match.", "A value could not be converted to a number or date.", "A validation rule failed.", "A Lookup found no match and you chose to review unmatched rows."] },
      { p: "Review is traceable: every item belongs to a project, pipeline, run, step and source row. A node's review count opens only that step's items." },
      { p: "Rows in review are held back before steps that change row identity (Group, Pivot, Unpivot, Join), and are never loaded until resolved." },
    ],
    related: ["review-correct", "review-rules"],
  },
  {
    slug: "review-correct",
    section: "Review",
    title: "Correcting values",
    summary: "Type the right value for a row. Corrections apply to that source row only.",
    body: [{ p: "Corrections are fingerprinted to the source row, so they never carry over to a row whose content changed. They flow through the rest of the pipeline on the next run." }],
    related: ["review-keep", "review-exclude"],
  },
  {
    slug: "review-keep",
    section: "Review",
    title: "Keeping originals",
    summary: "Accept the original value and load the row as it is.",
    body: [{ p: "Choose **Keep original** when the value is right as it is. **Ignore** accepts the warning without changing anything. Both can be applied to similar rows." }],
    related: ["review-correct"],
  },
  {
    slug: "review-exclude",
    section: "Review",
    title: "Excluding rows",
    summary: "Leave a row out of the output, with the decision recorded.",
    body: [{ p: "Excluded rows are counted separately in every run summary, so nothing disappears silently." }],
    related: ["review-why"],
  },
  {
    slug: "review-rules",
    section: "Review",
    title: "Updating rules",
    summary: "Turn recurring review decisions into deterministic rule changes, previewed on every row.",
    body: [{ p: "The review queue proposes rule changes such as accepting another date format, turning a correction into a Replace step, or allowing a recurring value. Each one shows how many review rows it resolves, and what else it changes, before you apply it." }],
    related: ["tools-validate", "transform-clean"],
  },

  // ------------------------------------------------------------------ Execution
  {
    slug: "execution-test-run",
    section: "Execution",
    title: "Test Run",
    summary: "Run the current draft on a sample without saving a version.",
    body: [{ p: "Test runs use the number of rows set in Settings. They are recorded in run history and shown on the canvas." }],
    related: ["execution-manual-run"],
  },
  {
    slug: "execution-manual-run",
    section: "Execution",
    title: "Manual Run",
    summary: "Save an immutable version and run every row.",
    body: [
      { p: "A run records a timeline, per-step metrics, logs, the output and a comparison with the previous run. You can rerun on a new compatible file without repeating any cleaning." },
    ],
    related: ["execution-local", "execution-server", "canvas-running"],
  },
  {
    slug: "execution-local",
    section: "Execution",
    title: "Local execution",
    summary: "Runs in this browser, in a background worker. Data stays on your machine.",
    learn: "Learn about execution",
    body: [{ p: "**Local** is the default. Runs process every row in a Web Worker so the app stays responsive. No data leaves the browser." }],
    related: ["execution-server"],
  },
  {
    slug: "execution-server",
    section: "Execution",
    title: "FORMA Server",
    summary: "An optional Python backend that runs the exported pipeline: large files, databases, schedules.",
    body: [
      { p: "Connect a server under **Settings > FORMA server**, then choose **FORMA Server** as the project's execution target or per run. The server runs the exact exported `pipeline.py`, so its output matches the app." },
      { p: "Step results appear when the server finishes the run." },
    ],
    related: ["execution-scheduled", "sources-database"],
  },
  {
    slug: "execution-scheduled",
    section: "Execution",
    title: "Scheduled execution",
    summary: "A cron schedule per pipeline, run by a FORMA Server or an exported Airflow or Prefect project.",
    body: [{ p: "Set a schedule with **Schedule** in a pipeline. A browser tab cannot run jobs while it is closed, so scheduled runs execute the latest saved version on a FORMA Server, or in the Airflow DAG or Prefect flow you export." }],
    related: ["engineering-airflow", "engineering-prefect"],
  },

  // ------------------------------------------------------------------ Engineering
  {
    slug: "engineering-spec",
    section: "Engineering",
    title: "PipelineSpec",
    summary: "The single source of truth: the UI edits it, the engine runs it, the generator exports it.",
    body: [
      { p: "A PipelineSpec holds the source, the ordered steps, the destination and review decisions. Open **Pipeline Spec** in the Workbench to see it." },
      { flow: ["One pipeline model", "Two execution representations"] },
    ],
    related: ["engineering-graph", "engineering-parity"],
  },
  {
    slug: "engineering-graph",
    section: "Engineering",
    title: "Pipeline Graph",
    summary: "The canvas graph is derived from the PipelineSpec. Positions are stored separately and never affect execution.",
    body: [
      { p: "The canvas derives nodes and connections from the spec: the main chain in execution order, plus a supporting-source node for each project source a Join, Lookup or Append reads. Node positions and the viewport are stored per pipeline, apart from the spec." },
      { p: "Each tool has an explicit contract: Transform reads one dataset; Join reads a left and a right dataset; Lookup reads a primary and a reference dataset; Append reads two or more; Load reads one and produces a destination result." },
      { p: "Every pipeline runs through the graph engine, in dependency order with creation order as the only tie-break. A pipeline whose connections you have edited exports as graph Python: one function per tool, a driver that reads like the pipeline, and a node table the FORMA Server uses to run and report each tool." },
      { p: "A pipeline can end in several Loads (see [Branching](doc:canvas-branching)); each writes its own destination." },
    ],
    related: ["canvas-connections", "engineering-spec"],
  },
  {
    slug: "engineering-python",
    section: "Engineering",
    title: "Generated Python",
    summary: "Readable pandas with one function per step, commented to match the canvas.",
    body: [{ p: "Each step becomes a function whose comment matches the visual pipeline, for example `# 04 Transform: Standardise invoice_date`. Select a node in **Engineer view** to see its function." }],
    related: ["engineering-export", "engineering-parity"],
  },
  {
    slug: "engineering-parity",
    section: "Engineering",
    title: "Browser and Python parity",
    summary: "The browser engine and the generated Python produce the same output, cell for cell.",
    body: [{ p: "FORMA's parity tests run both engines on the same files and compare columns, row IDs, every cell, review rows, excluded rows and rule counts. Exported projects can check themselves with `--check`." }],
    related: ["engineering-python"],
  },
  {
    slug: "engineering-export",
    section: "Engineering",
    title: "Export",
    summary: "A single pipeline.py or a full project.",
    body: [{ list: ["`pipeline.py`", "`requirements.txt`", "`config.yaml`", "`README.md`", "`pipeline.json` (the PipelineSpec)", "FORMA's output, as the parity reference"] }, { p: "Credentials are never written into code. Database destinations read an environment variable." }],
    related: ["engineering-airflow", "engineering-prefect"],
  },
  {
    slug: "engineering-airflow",
    section: "Engineering",
    title: "Airflow",
    summary: "Export an Airflow DAG that runs the pipeline on its schedule.",
    body: [{ p: "With a schedule set, the export includes an Airflow DAG that runs the generated pipeline." }],
    related: ["engineering-prefect", "execution-scheduled"],
  },
  {
    slug: "engineering-prefect",
    section: "Engineering",
    title: "Prefect",
    summary: "Export a Prefect flow where each FORMA step is a task.",
    body: [{ p: "The Prefect flow runs every step as a task and writes the same output as the app." }],
    related: ["engineering-airflow"],
  },

  // ------------------------------------------------------------------ Reference
  {
    slug: "reference-shortcuts",
    section: "Reference",
    title: "Keyboard shortcuts",
    summary: "Every shortcut in one place.",
    body: [
      { list: ["`Ctrl/Cmd K`: command palette and search", "`Ctrl/Cmd Z`, `Ctrl/Cmd Shift Z`: undo and redo pipeline edits", "`Ctrl/Cmd S`: save a version", "`Ctrl/Cmd B`: collapse the sidebar", "`Tab`: move between canvas nodes", "`Enter`: inspect the focused node", "`Escape`: close the inspector or a dialog", "`Delete`: remove the selected step (undoable)", "Arrow keys: move a focused node, or navigate the data grid"] },
    ],
    related: ["canvas-basics"],
  },
  {
    slug: "reference-feedback",
    section: "Reference",
    title: "Feedback",
    summary: "Report a bug or suggest an idea on the project repository.",
    body: [{ p: "Found a bug or have an idea? Open an issue at github.com/razeeniqbal/forma/issues." }],
  },
];

const BY_SLUG = new Map(DOCS.map((d) => [d.slug, d]));

export const docPage = (slug: string): DocPage | undefined => BY_SLUG.get(slug);

/** Plain text of a page, for search. */
export function docText(d: DocPage): string {
  const parts: string[] = [d.title, d.summary];
  for (const b of d.body) {
    if ("p" in b) parts.push(b.p);
    else if ("h" in b) parts.push(b.h);
    else if ("list" in b) parts.push(...b.list);
    else if ("steps" in b) parts.push(...b.steps);
    else if ("flow" in b) parts.push(...b.flow);
    else if ("code" in b) parts.push(b.code);
    else parts.push(b.note);
  }
  return parts.join(" ").replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\(doc:[^)]+\)/g, "$1");
}

export function searchDocs(query: string): DocPage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return DOCS.map((d) => {
    const title = d.title.toLowerCase();
    const text = docText(d).toLowerCase();
    let score = 0;
    for (const w of words) {
      if (!text.includes(w)) return { d, score: 0 };
      score += title.includes(w) ? 3 : d.summary.toLowerCase().includes(w) ? 2 : 1;
    }
    return { d, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d);
}
