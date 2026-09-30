// Visual ↔ code parity (PRD §2.4): the generated Python must produce exactly
// what the FORMA engine produces, cell for cell, for the same source file.
import { describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/engine/execute";
import { invoicePipeline, invoiceSteps } from "@/engine/demo";
import { generateConfigYaml, generatePython } from "@/codegen/python";
import { fingerprint, loadDataset } from "@/engine/load";
import { toText } from "@/engine/values";
import { parseCsv, parseJson } from "@/parsers";
import type { PipelineSpec, RawSheet } from "@/engine/types";
import { SAMPLES, sampleCsv, sampleSheet } from "../helpers";
import { toCsv } from "@/lib/exporters";

const OUT = join(__dirname, "..", "..", ".parity-out");
const PY = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

interface Extra {
  file: string;
  text: string;
  fileId: string;
}

function runCase(name: string, spec: PipelineSpec, sheet: RawSheet, sourceFile: string, sourceText?: string, extras: Extra[] = []) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (sourceText !== undefined) writeFileSync(join(dir, spec.source!.file), sourceText);
  else copyFileSync(sourceFile, join(dir, spec.source!.file));
  const sheets: Record<string, RawSheet> = {};
  for (const x of extras) {
    writeFileSync(join(dir, x.file), x.text);
    sheets[x.fileId] = parseCsv(x.text).sheet;
  }
  writeFileSync(join(dir, "pipeline.py"), generatePython(spec, { version: 1 }));
  writeFileSync(join(dir, "config.yaml"), generateConfigYaml(spec));
  execFileSync(PY, [join(__dirname, "run_python.py"), dir], { stdio: ["ignore", "ignore", "pipe"] });
  const py = JSON.parse(readFileSync(join(dir, "python.json"), "utf8"));
  const ts = execute(spec, sheet, { sheets });
  expect(ts.steps.filter((s) => s.error)).toEqual([]);
  expect(py.columns).toEqual(ts.output.columns);
  expect(py.rowIds).toEqual(ts.output.rowIds);
  const tsRows = ts.output.rows.map((r) => r.map(toText));
  for (let i = 0; i < tsRows.length; i++) expect(py.rows[i], `row ${ts.output.rowIds[i]}`).toEqual(tsRows[i]);
  expect(py.reviewRows).toEqual(ts.reviewRows);
  expect(py.excludedRows).toEqual(ts.excludedRows);
  expect(py.issues).toBe(ts.issues.length);
  expect(py.rules.map((r: { evaluated: number; passed: number }) => [r.evaluated, r.passed])).toEqual(
    ts.ruleResults.map((r) => [r.evaluated, r.passed]),
  );
  return ts;
}

describe("parity: TypeScript engine ≡ generated Python", () => {
  it("invoice pipeline on Excel (acceptance scenario)", async () => {
    const sheet = await sampleSheet();
    const ts = runCase("invoice_xlsx", invoicePipeline("f"), sheet, join(SAMPLES, "invoices.xlsx"));
    expect(ts.output.rows.length).toBeGreaterThan(900);
    // The exported project's own parity check (`--check`) against FORMA's CSV.
    const dir = join(OUT, "invoice_xlsx");
    writeFileSync(join(dir, "expected.csv"), toCsv(ts.output));
    execFileSync(PY, ["pipeline.py", "--check", "expected.csv"], { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "tampered.csv"), toCsv(ts.output).replace("INV-2231", "INV-9999"));
    expect(() => execFileSync(PY, ["pipeline.py", "--check", "tampered.csv"], { cwd: dir, stdio: "pipe" })).toThrow();
  });

  it("review decisions: correct, keep, ignore, exclude", async () => {
    const sheet = await sampleSheet();
    const spec = invoicePipeline("f");
    const base = execute(spec, sheet);
    const ds = loadDataset(sheet, spec.source!);
    const fp = new Map(ds.rows.map((r, i) => [ds.rowIds[i], fingerprint(r)]));
    const byRow = new Map<number, string[]>();
    for (const i of base.issues) byRow.set(i.row, [...(byRow.get(i.row) ?? []), i.column]);
    const [a, b, c, d] = base.reviewRows;
    spec.reviewDecisions = [
      ...byRow.get(a)!.map((column) => ({ row: a, column, action: "correct" as const, value: column === "total" ? "3220" : "2026-10-31", decidedAt: 0, fingerprint: fp.get(a) })),
      ...byRow.get(b)!.map((column) => ({ row: b, column, action: "keep" as const, decidedAt: 0, fingerprint: fp.get(b) })),
      { row: c, column: null, action: "ignore", decidedAt: 0, fingerprint: fp.get(c) },
      { row: d, column: null, action: "exclude", decidedAt: 0, fingerprint: fp.get(d) },
      { row: base.reviewRows[4], column: null, action: "exclude", decidedAt: 0, fingerprint: "stale" },
    ];
    const ts = runCase("invoice_decisions", spec, sheet, join(SAMPLES, "invoices.xlsx"));
    expect(ts.excludedRows).toEqual([d]);
    expect(ts.reviewRows.length).toBe(base.reviewRows.length - 4);
  });

  it("broad transformation coverage on CSV", () => {
    const sheet = sampleCsv();
    const steps = invoiceSteps().slice(0, 7);
    const spec: PipelineSpec = {
      name: "Coverage",
      source: { type: "csv", file: "invoices.csv", fileId: "f", headerRow: 0, startCol: 0, endCol: 6, csvDelimiter: "," },
      steps: [
        ...steps,
        { id: "fill", type: "fill_blanks", column: "remarks", value: "(none)" },
        { id: "rep_exact", type: "replace", column: "status", find: "Paid", replace: "Settled", match: "exact" },
        { id: "rep_contains", type: "replace", column: "customer", find: "Sdn Bhd", replace: "SB", match: "contains" },
        { id: "rep_regex", type: "replace", column: "Details", find: "Total RM\\s*([\\d,]+)", replace: "Amt=$1 ($&) $$", match: "regex" },
        { id: "split", type: "split", column: "customer", delimiter: " ", into: ["first_word", "rest"] },
        { id: "upper", type: "change_case", columns: ["first_word"], mode: "upper" },
        { id: "lower", type: "change_case", columns: ["rest"], mode: "lower" },
        { id: "tax", type: "formula", output: "with_tax", expression: "round([amount] * 1.06, 2)" },
        { id: "ratio", type: "formula", output: "ratio", expression: "[total] / ([amount] - [amount]) + max([total], 1) - abs(-[total])" },
        { id: "round", type: "round", column: "with_tax", decimals: 0 },
        { id: "flt", type: "filter", column: "amount", op: "gte", value: "1000" },
        { id: "flt2", type: "filter", column: "remarks", op: "not_contains", value: "Escalate" },
        { id: "dedupe", type: "remove_duplicates", columns: ["invoice_no"] },
        { id: "sort", type: "sort", column: "total", direction: "desc" },
        { id: "sort2", type: "sort", column: "customer", direction: "asc" },
        { id: "v", type: "validate", rules: [
          { id: "a", column: "customer", kind: "not_blank" },
          { id: "b", column: "status", kind: "in_set", values: ["Open", "Settled"] },
          { id: "c", column: "with_tax", kind: "lte", value: 13000 },
          { id: "d", column: "created_at", kind: "valid_date" },
        ] },
      ],
      destination: { type: "file", format: "csv", path: "out.csv" },
      reviewDecisions: [],
    };
    runCase("coverage_csv", spec, sheet, join(SAMPLES, "invoices.csv"));
  });

  it("JSON source with key-value parsing", () => {
    const records = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      meta: i % 7 === 0 ? "size: L" : `size: ${["S", "M", "L"][i % 3]}; colour: ${["red", "blue"][i % 2]}; price: RM ${(i * 13.5).toFixed(2)}`,
      qty: i % 11 === 0 ? null : i % 5,
      nested: { ok: i % 2 === 0 },
    }));
    const text = JSON.stringify({ data: records });
    const sheet = parseJson(text);
    const spec: PipelineSpec = {
      name: "Json KV",
      source: { type: "json", file: "orders.json", fileId: "f", headerRow: 0, startCol: 0, endCol: 3 },
      steps: [
        { id: "kv", type: "extract_kv", column: "meta", pairSeparator: ";", kvSeparator: ":", keys: [{ key: "Size", name: "size" }, { key: "colour", name: "colour" }, { key: "price", name: "price" }] },
        { id: "num", type: "convert_number", column: "price", decimals: null },
        { id: "q", type: "fill_blanks", column: "qty", value: "0" },
        { id: "line", type: "formula", output: "line_total", expression: "[qty] * [price]" },
      ],
      destination: null,
      reviewDecisions: [],
    };
    runCase("json_kv", spec, sheet, "", text);
  });

  describe("reshape & combine", () => {
    const customers = [
      "customer,region,tier",
      "Acme Sdn Bhd,Central,Gold",
      "Global Tech,North,Silver",
      "Beta Trading,South,Gold",
      "Delta Corp,Central,Bronze",
      "Evergreen Ltd,East,Silver",
      "Horizon Systems,North,Gold",
      "Nexus Solutions,South,Silver",
      "Orion Ventures,Central,Gold",
      "Orion Ventures,Central,Platinum",
      "Pioneer Resources,East,Bronze",
      "Quantum Dynamics,,Gold",
      ",West,Gold",
    ].join("\n") + "\n";
    const extra: Extra = { file: "customers.csv", text: customers, fileId: "cust" };
    const custSource = { type: "csv" as const, file: "customers.csv", fileId: "cust", headerRow: 0, startCol: 0, endCol: 2, csvDelimiter: "," };

    it("group after validation: held rows, corrections flow into totals, validation after reshape", async () => {
      const sheet = await sampleSheet();
      const base = invoicePipeline("f");
      const firstRun = execute(base, sheet);
      const ds = loadDataset(sheet, base.source!);
      const fp = new Map(ds.rows.map((r, i) => [ds.rowIds[i], fingerprint(r)]));
      const flagged = firstRun.issues.find((i) => i.column === "total")!;
      const spec: PipelineSpec = {
        ...base,
        reviewDecisions: [{ row: flagged.row, column: "total", action: "correct", value: "1234.5", decidedAt: 0, fingerprint: fp.get(flagged.row) }],
        steps: [
          ...base.steps,
          {
            id: "grp",
            type: "group",
            by: ["status"],
            aggs: [
              { column: "total", fn: "sum", as: "total_sum" },
              { column: "total", fn: "mean", as: "total_mean" },
              { column: "total", fn: "min", as: "total_min" },
              { column: "total", fn: "max", as: "total_max" },
              { column: "invoice_no", fn: "count", as: "invoices" },
              { column: "customer", fn: "count_distinct", as: "customers" },
              { column: "remarks", fn: "first", as: "first_remark" },
            ],
          },
          { id: "v2", type: "validate", rules: [{ id: "big", column: "total_sum", kind: "gt", value: 1000000 }] },
        ],
      };
      const ts = runCase("group_gate", spec, sheet, join(SAMPLES, "invoices.xlsx"));
      expect(ts.output.rows.length + ts.reviewRows.length - firstRun.reviewRows.length + 1).toBeGreaterThan(0);
      expect(ts.gated.length).toBe(2);
    });

    it("pivot then unpivot", () => {
      const sheet = sampleCsv();
      const spec: PipelineSpec = {
        name: "Pivot",
        source: { type: "csv", file: "invoices.csv", fileId: "f", headerRow: 0, startCol: 0, endCol: 6, csvDelimiter: "," },
        steps: [
          ...invoiceSteps().slice(0, 7),
          { id: "piv", type: "pivot", index: ["customer"], column: "status", value: "amount", fn: "sum" },
        ],
        destination: null,
        reviewDecisions: [],
      };
      runCase("pivot", spec, sheet, join(SAMPLES, "invoices.csv"));
      runCase("pivot_all", { ...spec, steps: [...invoiceSteps().slice(0, 7), { id: "cnt", type: "pivot", index: [], column: "status", value: "customer", fn: "count" }] }, sheet, join(SAMPLES, "invoices.csv"));
      const spec2: PipelineSpec = {
        ...spec,
        steps: [
          ...invoiceSteps().slice(0, 7),
          { id: "piv", type: "pivot", index: ["customer"], column: "status", value: "amount", fn: "mean" },
          { id: "unp", type: "unpivot", keep: ["customer"], columns: ["Open", "Paid"], nameColumn: "status", valueColumn: "avg_amount" },
          { id: "srt", type: "sort", column: "avg_amount", direction: "desc" },
        ],
      };
      runCase("unpivot", spec2, sheet, join(SAMPLES, "invoices.csv"));
    });

    it("lookup (flag unmatched), inner join with duplicates, append", () => {
      const sheet = sampleCsv();
      const src = { type: "csv" as const, file: "invoices.csv", fileId: "f", headerRow: 0, startCol: 0, endCol: 6, csvDelimiter: "," };
      const steps = invoiceSteps().slice(0, 7);
      const lookup: PipelineSpec = {
        name: "Lookup",
        source: src,
        steps: [
          ...steps,
          { id: "lk", type: "join", source: custSource, mode: "lookup", how: "left", on: [{ left: "customer", right: "customer" }], columns: ["region", "tier"], prefix: "c_", flagUnmatched: true },
          { id: "v", type: "validate", rules: [{ id: "reg", column: "region", kind: "not_blank" }] },
        ],
        destination: null,
        reviewDecisions: [],
      };
      const ts = runCase("lookup", lookup, sheet, join(SAMPLES, "invoices.csv"), undefined, [extra]);
      expect(ts.issues.some((i) => i.message.startsWith("No match in customers.csv"))).toBe(true);
      const joinSpec: PipelineSpec = {
        ...lookup,
        name: "Join",
        steps: [
          ...steps,
          { id: "jn", type: "join", source: custSource, mode: "join", how: "inner", on: [{ left: "customer", right: "customer" }], columns: ["customer", "tier"], prefix: "c_", flagUnmatched: false },
          { id: "grp", type: "group", by: ["tier"], aggs: [{ column: "amount", fn: "sum", as: "amount" }] },
        ],
      };
      runCase("join", joinSpec, sheet, join(SAMPLES, "invoices.csv"), undefined, [extra]);
      const appendSpec: PipelineSpec = {
        ...lookup,
        name: "Append",
        steps: [...steps, { id: "ap", type: "append", source: custSource }, { id: "flt", type: "filter", column: "region", op: "not_blank", value: "" }],
      };
      runCase("append", appendSpec, sheet, join(SAMPLES, "invoices.csv"), undefined, [extra]);
    });
  });
});
