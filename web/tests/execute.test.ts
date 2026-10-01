import { describe, expect, it } from "vitest";
import { execute } from "@/engine/execute";
import { detectRegion } from "@/engine/load";
import { invoicePipeline } from "@/engine/demo";
import { generatePython } from "@/codegen/python";
import { sampleSheet } from "./helpers";

describe("invoice acceptance scenario (PRD §25)", () => {
  it("detects the header and data region below the title", async () => {
    const sheet = await sampleSheet();
    const r = detectRegion(sheet);
    expect(r).toMatchObject({ headerRow: 2, startCol: 0, endCol: 6, dataRows: 1001 });
    expect(r.mergedCells).toBe(1);
  });

  it("extracts, cleans, validates and gates rows for review", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f1");
    const res = execute(spec, sheet);
    expect(res.steps.every((s) => !s.error)).toBe(true);
    expect(res.input.rows.length).toBe(1001);
    expect(res.output.columns).toEqual(["customer", "invoice_no", "invoice_date", "total", "amount", "status", "remarks", "created_at"]);
    const first = Object.fromEntries(res.output.columns.map((c, i) => [c, res.output.rows[0][i]]));
    expect(first.invoice_no).toBe("INV-2231");
    expect(first.invoice_date).toMatch(/^2026-\d\d-\d\d$/);
    expect(typeof first.total).toBe("number");
    expect(res.reviewRows.length).toBeGreaterThan(10);
    expect(res.output.rows.length + res.reviewRows.length).toBe(1001);
    const statuses = new Set(res.output.rows.map((r) => r[5]));
    expect([...statuses].sort()).toEqual(["Open", "Paid"]);
  });

  it("applies review decisions only to unchanged rows", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f1");
    const base = execute(spec, sheet);
    const row = base.reviewRows[0];
    const excluded = execute({ ...spec, reviewDecisions: [{ row, column: null, action: "exclude", decidedAt: 0 }] }, sheet);
    expect(excluded.excludedRows).toEqual([row]);
    expect(excluded.reviewRows.length).toBe(base.reviewRows.length - 1);
    const stale = execute({ ...spec, reviewDecisions: [{ row, column: null, action: "exclude", decidedAt: 0, fingerprint: "nope" }] }, sheet);
    expect(stale.excludedRows).toEqual([]);
  });

  it("generates Python with one function per step", async () => {
    const py = generatePython(invoicePipeline("f1"), { version: 7 });
    expect(py).toContain("def step_03_extract_invoice_fields(df: pd.DataFrame) -> pd.DataFrame:");
    expect(py).toContain("# 03 Extract: Extract invoice fields");
    expect(py).not.toMatch(/password|secret/i);
  });
});

describe("reshape and combine", () => {
  it("holds flagged rows before grouping and numbers new rows after the source", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f1");
    spec.steps.push({ id: "g", type: "group", by: ["status"], aggs: [{ column: "total", fn: "sum", as: "total" }, { column: "invoice_no", fn: "count", as: "n" }] });
    const res = execute(spec, sheet);
    expect(res.steps.every((s) => !s.error)).toBe(true);
    expect(res.output.columns).toEqual(["status", "total", "n"]);
    expect(res.output.rows.map((r) => r[0]).sort()).toEqual(["Open", "Paid"]);
    const counted = res.output.rows.reduce((a, r) => a + (r[2] as number), 0);
    expect(counted + res.reviewRows.length).toBe(1001);
    expect(Math.min(...res.output.rowIds)).toBeGreaterThan(Math.max(...res.input.rowIds));
  });

  it("reports a missing side source instead of crashing", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f1");
    spec.steps.push({ id: "a", type: "append", source: { type: "csv", file: "gone.csv", fileId: "missing", headerRow: 0, startCol: 0, endCol: 1 } });
    const res = execute(spec, sheet);
    expect(res.steps.at(-1)!.error).toMatch(/not available/);
  });
});
