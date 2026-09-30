// The canonical V1 acceptance pipeline (PRD §25): Invoice Processing.
import type { PipelineSpec, SourceSpec, Step } from "./types";

export const INVOICE_PATTERNS = {
  invoice_no: "INV-?\\d+",
  invoice_date: "(\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}-\\d{1,2}-\\d{4})",
  total: "RM\\s*(-?[\\d,.]+\\w*)",
};

export function invoiceSteps(): Step[] {
  return [
    { id: "select_columns", type: "select", columns: ["Customer", "Details", "Amount", "Status", "Remarks", "Created At"] },
    {
      id: "extract_invoice_fields",
      type: "extract",
      label: "Extract invoice fields",
      column: "Details",
      method: "pattern",
      fields: [
        { name: "invoice_no", type: "text", pattern: INVOICE_PATTERNS.invoice_no },
        { name: "invoice_date", type: "date", pattern: INVOICE_PATTERNS.invoice_date },
        { name: "total", type: "number", pattern: INVOICE_PATTERNS.total },
      ],
    },
    { id: "standardise_created_at", type: "standardise_date", column: "Created At", inputFormats: ["DD/MM/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"], outputFormat: "YYYY-MM-DD" },
    { id: "convert_amount", type: "convert_number", column: "Amount", decimals: 2 },
    { id: "trim_text", type: "trim", columns: ["Customer", "Status", "Remarks"], collapseSpaces: true },
    { id: "status_case", type: "change_case", columns: ["Status"], mode: "title" },
    { id: "rename_columns", type: "rename", mapping: { Customer: "customer", Amount: "amount", Status: "status", Remarks: "remarks", "Created At": "created_at" } },
    { id: "drop_details", type: "select", columns: ["customer", "invoice_no", "invoice_date", "total", "amount", "status", "remarks", "created_at"] },
    {
      id: "validate_invoice",
      type: "validate",
      label: "Validate invoice",
      rules: [
        { id: "r_invoice_no", column: "invoice_no", kind: "matches", pattern: "^INV-?\\d+$", description: "Must match INV-[number]" },
        { id: "r_invoice_date", column: "invoice_date", kind: "valid_date" },
        { id: "r_total", column: "total", kind: "gt", value: 0 },
        { id: "r_customer", column: "customer", kind: "not_blank" },
        { id: "r_status", column: "status", kind: "in_set", values: ["Open", "Paid"] },
        { id: "r_unique", column: "invoice_no", kind: "unique" },
      ],
    },
  ];
}

export function invoiceSource(fileId: string, file = "invoices.xlsx"): SourceSpec {
  return { type: "excel", file, fileId, sheet: "Invoices", headerRow: 2, startCol: 0, endCol: 6 };
}

export function invoicePipeline(fileId: string): PipelineSpec {
  return {
    name: "Invoice Processing",
    source: invoiceSource(fileId),
    steps: invoiceSteps(),
    destination: { type: "file", format: "csv", path: "output/fact_invoices.csv" },
    reviewDecisions: [],
  };
}
