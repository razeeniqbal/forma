// Project layer (PROJECT → SOURCE → PIPELINE → RUN): migration of pre-project data and store behaviour.
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME, migrate, SCHEMA_VERSION, specSourceIds, type StoredData } from "@/store/migrate";
import { useApp } from "@/store/app";
import { invoicePipeline } from "@/engine/demo";
import { parseCsv } from "@/parsers";
import { execute } from "@/engine/execute";
import { loadSideSheets } from "@/store/app";
import type { PipelineSpec, SourceFile } from "@/engine/types";
import type { Run } from "@/store/model";

const spec = (fileId: string, extra: PipelineSpec["steps"] = []): PipelineSpec => ({ ...invoicePipeline(fileId), steps: [...invoicePipeline(fileId).steps, ...extra] });

const run = (id: string, pipelineId: string, startedAt: number): Run =>
  ({
    id,
    pipelineId,
    pipelineName: "x",
    version: 1,
    mode: "manual",
    triggeredBy: "You",
    startedAt,
    status: "review",
    sourceName: "invoices.xlsx",
    destinationLabel: "out",
    rowsIn: 1001,
    rowsOut: 980,
    reviewCount: 21,
    excludedCount: 0,
    failedCount: 0,
    steps: [],
    logs: [],
    reviewIssues: [],
    sourceColumns: [],
    reviewSource: {},
    reviewValues: {},
    ruleResults: [],
    columns: [],
  }) as Run;

function v1Data(): StoredData {
  return {
    pipelines: [
      {
        id: "p_b",
        spec: { ...spec("src_inv"), reviewDecisions: [{ row: "fp1", decision: "keep", column: "total", at: 5 } as never] },
        version: 3,
        versions: [{ version: 3, spec: spec("src_inv"), createdAt: 30, reason: "Run" }],
        dirty: false,
        preset: "analyst",
        createdAt: 20,
        updatedAt: 40,
      },
      { id: "p_a", spec: spec("src_inv"), version: 0, versions: [], dirty: true, preset: "engineer", createdAt: 10, updatedAt: 11 },
    ],
    sources: [
      { id: "src_inv", name: "invoices.xlsx", kind: "excel", size: 1, addedAt: 5, lastUsedAt: 6, sheets: [] },
      { id: "src_loose", name: "notes.csv", kind: "csv", size: 1, addedAt: 50, lastUsedAt: 50, sheets: [] },
    ],
    runs: [run("run_1", "p_b", 35), run("run_gone", "p_deleted", 60)],
    settings: { userName: "Razeen", defaultPreset: "analyst" },
  };
}

describe("migration to projects (schema v1 → v2)", () => {
  it("moves every source, pipeline and run into one default project without touching ids, versions or decisions", () => {
    const before = v1Data();
    const m = migrate(before);
    expect(m.changed).toBe(true);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.projects).toEqual([
      { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, description: expect.any(String), createdAt: 5, updatedAt: 60 },
    ]);
    expect(m.pipelines.map((p) => [p.id, p.projectId, p.version, p.versions.length])).toEqual([
      ["p_b", DEFAULT_PROJECT_ID, 3, 1],
      ["p_a", DEFAULT_PROJECT_ID, 0, 0],
    ]);
    expect(m.pipelines[0].spec.reviewDecisions).toEqual(before.pipelines[0].spec.reviewDecisions);
    expect(m.sources.every((s) => s.projectId === DEFAULT_PROJECT_ID)).toBe(true);
    expect(m.runs.map((r) => [r.id, r.projectId, r.reviewCount])).toEqual([
      ["run_1", DEFAULT_PROJECT_ID, 21],
      ["run_gone", DEFAULT_PROJECT_ID, 21],
    ]);
  });

  it("opens pipelines that used the old default layout in Pipeline view, keeping explicit choices", () => {
    const m = migrate(v1Data());
    expect(m.pipelines.find((p) => p.id === "p_b")!.preset).toBe("pipeline");
    expect(m.pipelines.find((p) => p.id === "p_a")!.preset).toBe("engineer");
    expect(m.settings).toEqual({ userName: "Razeen", defaultPreset: "pipeline" });
  });

  it("is deterministic and idempotent", () => {
    const a = migrate(v1Data());
    const b = migrate(v1Data());
    expect(b).toEqual(a);
    const again = migrate({ schema: a.schema, projects: a.projects, pipelines: a.pipelines, sources: a.sources, runs: a.runs, settings: a.settings });
    expect(again.changed).toBe(false);
    expect(again.pipelines).toEqual(a.pipelines);
    expect(again.settings).toEqual(a.settings);
  });

  it("keeps records that already belong to a project and only re-homes orphans", () => {
    const m = migrate({
      schema: 2,
      projects: [{ id: "proj_x", name: "X", createdAt: 1, updatedAt: 1 }],
      pipelines: [{ id: "p1", projectId: "proj_x", spec: spec("s1"), version: 0, versions: [], dirty: true, preset: "analyst", createdAt: 1, updatedAt: 1 }],
      sources: [
        { id: "s1", name: "a.csv", kind: "csv", size: 1, addedAt: 1, lastUsedAt: 1, sheets: [] },
        { id: "s2", projectId: "proj_x", name: "b.csv", kind: "csv", size: 1, addedAt: 1, lastUsedAt: 1, sheets: [] },
      ],
      runs: [],
    });
    expect(m.projects.map((p) => p.id)).toEqual(["proj_x"]); // the orphan source is read by p1, so no default project
    expect(m.sources.map((s) => s.projectId)).toEqual(["proj_x", "proj_x"]);
    expect(m.pipelines[0].preset).toBe("analyst"); // already v2: an explicit choice
  });

  it("an empty install migrates to an empty project list", () => {
    const m = migrate({ pipelines: [], sources: [], runs: [] });
    expect(m.projects).toEqual([]);
    expect(m.changed).toBe(true); // records the schema version
  });

  it("lists every source a pipeline reads", () => {
    const s = spec("main", [
      { id: "j", type: "join", source: { ...invoicePipeline("cust").source!, file: "c.csv" }, mode: "lookup", how: "left", on: [], columns: [], prefix: "", flagUnmatched: false },
      { id: "a", type: "append", source: { ...invoicePipeline("arch").source!, file: "a.csv" } },
    ]);
    expect(specSourceIds(s)).toEqual(["main", "cust", "arch"]);
  });
});

const csvFile = (id: string, name: string, text: string): SourceFile => {
  const { sheet, delimiter } = parseCsv(text);
  return { id, name, kind: "csv", size: text.length, addedAt: Date.now(), sheets: [sheet], delimiter };
};

describe("project store", () => {
  beforeEach(async () => {
    await useApp.getState().resetAll();
  });

  it("creates, renames and persists projects in memory", () => {
    const p = useApp.getState().createProject({ name: "  Invoice Processing ", description: "Clean invoices" });
    expect(p).toMatchObject({ name: "Invoice Processing", description: "Clean invoices" });
    useApp.getState().updateProject(p.id, { name: "Invoices", execution: "local" });
    expect(useApp.getState().projects).toEqual([expect.objectContaining({ id: p.id, name: "Invoices", execution: "local" })]);
  });

  it("sources belong to a project and several pipelines share one source", async () => {
    const app = useApp.getState();
    const proj = app.createProject({ name: "Invoices" });
    const other = app.createProject({ name: "Other" });
    const meta = await app.addSource(csvFile("src_a", "invoices.csv", "invoice,customer\nINV-1,Acme\nINV-2,Beta\n"), proj.id);
    expect(meta.projectId).toBe(proj.id);
    const p1 = await app.createPipeline(proj.id, "Clean", meta);
    const p2 = await app.createPipeline(proj.id, "Enrich", meta);
    expect([p1.projectId, p2.projectId]).toEqual([proj.id, proj.id]);
    expect(p1.spec.source?.fileId).toBe("src_a");
    expect(p2.spec.source?.fileId).toBe("src_a");
    expect(useApp.getState().sources.filter((s) => s.id === "src_a")).toHaveLength(1);
    expect(useApp.getState().pipelines.filter((p) => p.projectId === other.id)).toHaveLength(0);
    expect(p1.preset).toBe("pipeline");
  });

  it("creates a pipeline on a chosen workbook sheet", async () => {
    const app = useApp.getState();
    const proj = app.createProject({ name: "Sheets" });
    const a = parseCsv("a,b\n1,2\n").sheet;
    const b = parseCsv("x,y,z\n1,2,3\n4,5,6\n").sheet;
    const book: SourceFile = { id: "src_book", name: "book.xlsx", kind: "excel", size: 1, addedAt: 1, sheets: [{ ...a, name: "First" }, { ...b, name: "Second" }] };
    const meta = await app.addSource(book, proj.id);
    expect(meta.sheets.map((s) => [s.name, s.rows])).toEqual([["First", 1], ["Second", 2]]);
    const p = await app.createPipeline(proj.id, "Second sheet", meta, undefined, null, "Second");
    expect(p.spec.source).toMatchObject({ fileId: "src_book", sheet: "Second", endCol: 2 });
  });

  it("lookup, join and append read other project sources", async () => {
    const app = useApp.getState();
    const proj = app.createProject({ name: "Combine" });
    const inv = await app.addSource(csvFile("src_inv", "invoices.csv", "invoice,customer\nINV-1,Acme\nINV-2,Beta\nINV-3,Zed\n"), proj.id);
    const cust = await app.addSource(csvFile("src_cust", "customers.csv", "customer,region\nAcme,North\nBeta,South\n"), proj.id);
    const more = await app.addSource(csvFile("src_more", "more.csv", "invoice,customer\nINV-9,Acme\n"), proj.id);
    const p = await app.createPipeline(proj.id, "Enrich", inv);
    const side = (m: typeof cust, endCol: number) => ({ ...p.spec.source!, file: m.name, fileId: m.id, endCol });
    const steps: PipelineSpec["steps"] = [
      { id: "ap", type: "append", source: side(more, 1) },
      { id: "lk", type: "join", source: side(cust, 1), mode: "lookup", how: "left", on: [{ left: "customer", right: "customer" }], columns: ["region"], prefix: "c_", flagUnmatched: true },
    ];
    const full: PipelineSpec = { ...p.spec, steps };
    app.updateSpec(p.id, () => full);
    const sheets = await loadSideSheets(full);
    expect(Object.keys(sheets).sort()).toEqual(["src_cust", "src_more"]);
    const res = execute(full, parseCsv("invoice,customer\nINV-1,Acme\nINV-2,Beta\nINV-3,Zed\n").sheet, { sheets });
    expect(res.steps.every((s) => !s.error)).toBe(true);
    expect(res.beforeGate.rows.map((r) => [r[0], r[2]])).toEqual([
      ["INV-1", "North"],
      ["INV-2", "South"],
      ["INV-3", null],
      ["INV-9", "North"],
    ]);
    expect(res.issues.some((i) => i.message.startsWith("No match in customers.csv"))).toBe(true);
    // Inner join on the same project source.
    const joined = execute({ ...full, steps: [{ ...steps[1], id: "jn", mode: "join", how: "inner" } as PipelineSpec["steps"][number]] }, parseCsv("invoice,customer\nINV-1,Acme\nINV-3,Zed\n").sheet, { sheets });
    expect(joined.output.rows).toHaveLength(1);
  });

  it("deleting a project removes its pipelines, runs and sources and nothing else", async () => {
    const app = useApp.getState();
    const keep = app.createProject({ name: "Keep" });
    const gone = app.createProject({ name: "Gone" });
    const k = await app.addSource(csvFile("src_k", "k.csv", "a\n1\n"), keep.id);
    const g = await app.addSource(csvFile("src_g", "g.csv", "a\n1\n"), gone.id);
    const pk = await app.createPipeline(keep.id, "K", k);
    const pg = await app.createPipeline(gone.id, "G", g);
    useApp.setState((s) => ({ runs: [{ ...run("r_k", pk.id, 1), projectId: keep.id }, { ...run("r_g", pg.id, 2), projectId: gone.id }, ...s.runs] }));
    await useApp.getState().deleteProject(gone.id);
    const st = useApp.getState();
    expect(st.projects.map((p) => p.name)).toEqual(["Keep"]);
    expect(st.pipelines.map((p) => p.id)).toEqual([pk.id]);
    expect(st.sources.map((s) => s.id)).toEqual(["src_k"]);
    expect(st.runs.map((r) => r.id)).toEqual(["r_k"]);
  });

  it("duplicated pipelines stay in their project", async () => {
    const app = useApp.getState();
    const proj = app.createProject({ name: "Dup" });
    const meta = await app.addSource(csvFile("src_d", "d.csv", "a\n1\n"), proj.id);
    const p = await app.createPipeline(proj.id, "Original", meta);
    expect(app.duplicatePipeline(p.id)?.projectId).toBe(proj.id);
  });
});
