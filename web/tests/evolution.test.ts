// Tool taxonomy, Docs, combine facts, schema explanations and the no-em-dash rule.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, GROUPS, OPERATIONS, operationOf, nodeLabel, pathOf, searchTools } from "@/engine/taxonomy";
import { DOCS, DOC_SECTIONS, docPage, docText, searchDocs } from "@/docs/content";
import { appendSchema, matchStats, suggestKeys } from "@/lib/combine";
import { explainMissingColumn, schemaChange } from "@/lib/schema";
import { defaultOpen } from "@/pages/workspace/WorkbenchSections";
import { execute } from "@/engine/execute";
import { parseCsv } from "@/parsers";
import type { Dataset, PipelineSpec, Step, StepType } from "@/engine/types";

const ds = (columns: string[], rows: (string | number | null)[][]): Dataset => ({ columns, rows, rowIds: rows.map((_, i) => i + 1) });

describe("tool taxonomy", () => {
  it("places every step type exactly once, under one of the five categories", () => {
    const types: StepType[] = ["select", "rename", "trim", "change_case", "replace", "fill_blanks", "convert_number", "standardise_date", "extract", "extract_kv", "split", "filter", "sort", "remove_duplicates", "formula", "round", "validate", "group", "pivot", "unpivot", "join", "append"];
    for (const t of types) expect(OPERATIONS.filter((o) => o.id === t), t).toHaveLength(1);
    expect(CATEGORIES.map((c) => c.id)).toEqual(["source", "extract", "transform", "validate", "load"]);
    for (const o of OPERATIONS) {
      expect(CATEGORIES.some((c) => c.id === o.category)).toBe(true);
      if (o.category === "transform") expect(GROUPS.some((g) => g.id === o.group), o.id).toBe(true);
    }
  });

  it("names multi-input tools by their operation and the rest by category", () => {
    const join = { id: "j", type: "join", mode: "lookup" } as unknown as Step;
    expect(operationOf(join).id).toBe("lookup");
    expect(nodeLabel(join)).toBe("Lookup");
    expect(nodeLabel({ id: "d", type: "standardise_date", column: "d", inputFormats: [], outputFormat: "YYYY-MM-DD" })).toBe("Transform");
    expect(pathOf(OPERATIONS.find((o) => o.id === "pivot")!)).toEqual(["Transform", "Reshape", "Pivot"]);
  });

  it("declares input contracts: Join left/right, Lookup primary/reference, Append many, Load to a destination", () => {
    const c = (id: string) => OPERATIONS.find((o) => o.id === id)!.contract;
    expect(c("join").inputs.map((i) => i.role)).toEqual(["left", "right"]);
    expect(c("lookup").inputs.map((i) => i.role)).toEqual(["primary", "reference"]);
    expect(c("append").inputs[0].cardinality).toBe("many");
    expect(c("trim").inputs).toHaveLength(1);
    expect(c("load").output).toBe("destination");
    expect(c("source").inputs).toHaveLength(0);
  });

  it("search understands the taxonomy", () => {
    const date = searchTools("date").map((h) => h.path.join(" > "));
    expect(date[0]).toBe("Transform > Convert > Date");
    expect(date).toContain("Extract > Pattern extraction");
    expect(date).toContain("Validate > Validation rules");
    expect(searchTools("pivot")[0].path.join(" > ")).toBe("Transform > Reshape > Pivot");
    expect(searchTools("combine join").map((h) => h.op.id)).toContain("join");
    expect(searchTools("zzzz")).toEqual([]);
  });
});

describe("Docs", () => {
  it("has unique slugs, known sections, and pages in section order", () => {
    expect(new Set(DOCS.map((d) => d.slug)).size).toBe(DOCS.length);
    for (const d of DOCS) expect(DOC_SECTIONS).toContain(d.section);
    const order = DOCS.map((d) => DOC_SECTIONS.indexOf(d.section as (typeof DOC_SECTIONS)[number]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("every link, related topic and contextual doc target exists", () => {
    const targets = new Set<string>();
    for (const d of DOCS) {
      for (const r of d.related ?? []) targets.add(r);
      for (const m of JSON.stringify(d.body).matchAll(/\(doc:([\w-]+)\)/g)) targets.add(m[1]);
    }
    for (const c of CATEGORIES) targets.add(c.doc);
    for (const o of OPERATIONS) targets.add(o.doc);
    for (const g of GROUPS) targets.add(`transform-${g.id}`);
    // Pages named in the UI.
    const src = join(__dirname, "..", "src");
    for (const f of walk(src)) for (const m of readFileSync(f, "utf8").matchAll(/(?:page=|\/docs\/)"?([a-z]+(?:-[a-z]+)+)/g)) targets.add(m[1]);
    for (const t of targets) expect(docPage(t), t).toBeTruthy();
  });

  it("search finds pages by title and text", () => {
    expect(searchDocs("join")[0].slug).toBe("combine-join");
    expect(searchDocs("reduced motion").map((d) => d.slug)).toContain("canvas-running");
    expect(docText(docPage("combine-lookup")!)).toContain("primary dataset");
  });
});

describe("no em dashes in new writing", () => {
  it("Docs, taxonomy and the new UI modules contain no em dash", () => {
    const files = ["src/docs/content.ts", "src/engine/taxonomy.ts", "src/lib/combine.ts", "src/lib/schema.ts", "src/pages/DocsPage.tsx", "src/components/DocLink.tsx", "src/pages/workspace/TransformPicker.tsx", "src/pages/workspace/WorkbenchSections.tsx", "src/pages/workspace/PipelineView.tsx", "src/pages/workspace/canvas/PipelineCanvas.tsx"];
    for (const f of files) expect(readFileSync(join(__dirname, "..", f), "utf8").includes(String.fromCharCode(0x2014)), f).toBe(false);
  });
});

describe("combining datasets", () => {
  const left = ds(["customer_id", "amount"], [["A", 1], ["B", 2], ["C", 3], [null, 4]]);
  const right = ds(["Customer ID", "region"], [["A", "North"], ["B", "South"], ["Z", "East"]]);

  it("counts matched and unmatched rows like the engine (blank keys never match)", () => {
    expect(matchStats(left, right, [{ left: "customer_id", right: "Customer ID" }])).toEqual({ leftRows: 4, rightRows: 3, matched: 2, unmatched: 2 });
    expect(matchStats(left, right, [])).toBeNull();
    expect(matchStats(left, right, [{ left: "nope", right: "Customer ID" }])).toBeNull();
  });

  it("suggests keys by name and value overlap, without choosing them", () => {
    const s = suggestKeys(left, right);
    expect(s[0]).toMatchObject({ left: "customer_id", right: "Customer ID" });
    expect(s[0].overlap).toBeCloseTo(2 / 3);
    expect(suggestKeys(ds(["x"], [["1"]]), ds(["y"], [["1"]]))).toEqual([]);
  });

  it("reports append schema compatibility and honours an explicit mapping", () => {
    const jan = ds(["date", "product", "volume"], [["2026-01-01", "A", 1]]);
    const feb = ds(["report_date", "product_name", "quantity", "product"], [["2026-02-01", "B", 2, "x"]]);
    const before = appendSchema(jan, feb);
    expect(before.matched.map((m) => m.target)).toEqual(["product"]);
    expect(before.missing).toEqual(["date", "volume"]);
    expect(before.additional).toEqual(["report_date", "product_name", "quantity"]);
    expect(before.suggestions).toContainEqual({ from: "report_date", target: "date" });
    const mapped = appendSchema(jan, feb, { report_date: "date", quantity: "volume" });
    expect(mapped.missing).toEqual([]);
    expect(mapped.matched.find((m) => m.target === "volume")).toMatchObject({ from: "quantity", mapped: true });
    expect(appendSchema(jan, feb, { nope: "date" }).invalid).toHaveLength(1);
  });

  it("flags type conflicts between matched columns", () => {
    const a = ds(["amount"], [[10], [20]]);
    const b = ds(["amount"], [["ten"], ["twenty"]]);
    expect(appendSchema(a, b).matched[0].conflict).toEqual({ target: "number", from: "text" });
  });

  it("the engine applies an append mapping and rejects a mapping onto one column twice", () => {
    const main = parseCsv("date,volume\n2026-01-01,5\n").sheet;
    const other = parseCsv("report_date,quantity,note\n2026-02-01,7,x\n").sheet;
    const src = { type: "csv" as const, file: "jan.csv", fileId: "jan", headerRow: 0, startCol: 0, endCol: 1 };
    const side = { type: "csv" as const, file: "feb.csv", fileId: "feb", headerRow: 0, startCol: 0, endCol: 2 };
    const spec: PipelineSpec = { name: "x", source: src, steps: [{ id: "ap", type: "append", source: side, mapping: { report_date: "date", quantity: "volume" } }], destination: null, reviewDecisions: [] };
    const r = execute(spec, main, { sheets: { feb: other } });
    expect(r.output.columns).toEqual(["date", "volume", "note"]);
    expect(r.output.rows.map((row) => row.map(String))).toEqual([["2026-01-01", "5", "null"], ["2026-02-01", "7", "x"]]);
    const bad = { ...spec, steps: [{ ...spec.steps[0], mapping: { report_date: "date", quantity: "date" } } as Step] };
    expect(execute(bad, main, { sheets: { feb: other } }).steps[0].error).toMatch(/same column/);
  });
});

describe("schema propagation", () => {
  it("describes the columns a step outputs", () => {
    expect(schemaChange(ds(["a", "b"], []), ds(["a", "c", "d"], []))).toEqual({ columns: 3, added: ["c", "d"], removed: ["b"] });
  });

  it("explains a downstream reference broken by an upstream rename", () => {
    const spec: PipelineSpec = {
      name: "x",
      source: null,
      steps: [
        { id: "r", type: "rename", mapping: { region: "region_code" } },
        { id: "t", type: "trim", columns: ["x"], collapseSpaces: false },
        { id: "j", type: "filter", column: "region", op: "not_blank", value: "" },
      ],
      destination: null,
      reviewDecisions: [],
    };
    expect(explainMissingColumn(spec, 2, 'Column "region" not found')).toBe('Step 02 (Rename columns) renamed "region" to "region_code". Update this step to use the new name.');
    expect(explainMissingColumn(spec, 2, "Some other error")).toBeNull();
  });
});

describe("workbench sections", () => {
  it("opens what matters for the selected tool", () => {
    expect(defaultOpen("configure", "extract")).toEqual(["preview", "inspector"]);
    expect(defaultOpen("configure", "validate")).toEqual(["inspector", "quality"]);
    expect(defaultOpen("review", "transform")).toEqual(["failedRows", "beforeAfter"]);
    expect(defaultOpen("engineer", "load")).toEqual(["python", "spec", "logs"]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
