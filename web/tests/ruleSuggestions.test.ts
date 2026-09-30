import { describe, expect, it } from "vitest";
import { execute } from "@/engine/execute";
import { invoicePipeline } from "@/engine/demo";
import { fingerprint, loadDataset } from "@/engine/load";
import { measureImpact, suggestRuleUpdates } from "@/lib/ruleSuggestions";
import type { PipelineSpec } from "@/engine/types";
import { sampleSheet } from "./helpers";

describe("update rule from correction", () => {
  it("suggests an extra date format and measures its impact", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f");
    // Drop "MMM DD, YYYY" so those Created At values fail.
    spec.steps = spec.steps.map((s) => (s.type === "standardise_date" ? { ...s, inputFormats: ["DD/MM/YYYY", "YYYY-MM-DD"] } : s));
    const base = execute(spec, sheet);
    const sug = suggestRuleUpdates(spec, base).find((s) => s.id.includes("MMM DD, YYYY"));
    expect(sug).toBeDefined();
    const next = execute(sug!.apply(spec), sheet);
    const impact = measureImpact(base, next);
    expect(impact.resolved).toBeGreaterThan(20);
    expect(impact.newlyFlagged).toBe(0);
  });

  it("turns a correction into a replace step applied to identical values", async () => {
    const sheet = await sampleSheet();
    const spec: PipelineSpec = { ...invoicePipeline("f") };
    spec.steps = spec.steps.map((s) => (s.type === "change_case" ? { ...s, mode: "upper" } : s));
    const base = execute(spec, sheet);
    const issue = base.issues.find((i) => i.column === "status" && i.value === "PAID")!;
    const ds = loadDataset(sheet, spec.source!);
    const src = ds.rows[ds.rowIds.indexOf(issue.row)];
    spec.reviewDecisions = [{ row: issue.row, column: "status", action: "correct", value: "Paid", decidedAt: 0, fingerprint: fingerprint(src) }];
    const withDecision = execute(spec, sheet);
    const sug = suggestRuleUpdates(spec, withDecision).find((s) => s.id.startsWith("rep:status:PAID"));
    expect(sug).toBeDefined();
    const impact = measureImpact(withDecision, execute(sug!.apply(spec), sheet));
    expect(impact.resolved).toBeGreaterThan(100);
  });
});
