// Generates the canonical V1 demo workbook (PRD §25): Invoice Processing.
// Deterministic (seeded) so tests and screenshots are reproducible.
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");
mkdirSync(OUT, { recursive: true });

let seed = 20260930;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];

const CUSTOMERS = [
  "Acme Sdn Bhd", "Global Tech", "Beta Trading", "Delta Corp", "Evergreen Ltd", "Horizon Systems",
  "Nexus Solutions", "Orion Ventures", "Pioneer Resources", "Quantum Dynamics", "Riverstone Sdn Bhd",
  "Summit Global", "Terra Energy", "Unity Networks", "Vertex Industries", "Wira Logistics", "Zenith Foods",
  "Kinabalu Traders", "Melaka Marine", "Selangor Steel",
];
const REMARKS = ["Urgent payment", "Follow up", "Partial payment", "Check PO", "Escalate", "", "", "", "", ""];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const fmtMoney = (n) => n.toLocaleString("en-US");

// Messy rows modelled on the review-queue mockup.
const MESSY = {
  142: (no) => `Inv INV${no} - payable 31/13/2026 - RM3,220`,
  305: (no) => `Invoice #INV-${no}, Due 2026/02/30, Total RM 1,800`,
  418: (no) => `INV${no} | 15-10-2026 | RM -50`,
  527: (no) => `Invoice INV-${no}, Due -, Total RM 2,450`,
  689: (no) => `INV-${no} / Due 32/10/2026 / RM 980`,
  701: (no) => `Inv #${no}, Due 15/10/26, Total RM3.1k`,
  745: (no) => `INV-${no} | 2026-11-05 | RM3,OOO`,
  782: (no) => `Invoice ${no} - 01/11/2026 - RM 1,200`,
  856: (no) => `Invoice INV-${no}, Due 29/02/2026, Total RM 2,100`,
  912: (no) => `INV-${no} | Due | RM 980`,
  934: (no) => `Inv #INV${no} Due 10/10/2026 Total RMX,500`,
  951: (no) => `Invoice INV-${no} - Due 31-04-2026 - RM 2,300`,
  990: (no) => `Invoice INV${no}, Due 2026-13-01, Total RM 1,900`,
};
const BLANK_CUSTOMER = new Set([233, 614]);

const header = ["No.", "Customer", "Details", "Amount", "Status", "Remarks", "Created At"];
const rows = [];
for (let i = 1; i <= 1000; i++) {
  const no = 2230 + i;
  const day = 1 + Math.floor(rand() * 28);
  const month = 10 + Math.floor(rand() * 3);
  const amount = Math.round(200 + rand() * 12300);
  const created = new Date(Date.UTC(2026, month - 1, day));
  created.setUTCDate(created.getUTCDate() - 1 - Math.floor(rand() * 5));
  const cd = created.getUTCDate();
  const cm = created.getUTCMonth() + 1;
  const style = rand();
  const createdAt =
    style < 0.71 ? `${pad(cd)}/${pad(cm)}/2026` : style < 0.92 ? `2026-${pad(cm)}-${pad(cd)}` : `${MONTHS[cm - 1]} ${pad(cd)}, 2026`;
  const details = MESSY[i] ? MESSY[i](no) : `Inv #INV-${no}, Due ${pad(day)}/${pad(month)}/2026, Total RM ${fmtMoney(amount)}`;
  const statusRaw = rand() < 0.62 ? "Open" : "Paid";
  const status = rand() < 0.05 ? ` ${statusRaw.toLowerCase()} ` : rand() < 0.03 ? statusRaw.toUpperCase() : statusRaw;
  let customer = BLANK_CUSTOMER.has(i) ? "" : pick(CUSTOMERS);
  if (!BLANK_CUSTOMER.has(i) && rand() < 0.04) customer = `  ${customer} `;
  const amountCell = rand() < 0.08 ? `RM ${fmtMoney(amount)}.00` : amount;
  rows.push([i, customer, details, amountCell, status, pick(REMARKS), createdAt]);
}
// One duplicate invoice (row re-keyed by a second import).
rows.splice(500, 0, [...rows[499]]);

const wb = new ExcelJS.Workbook();
wb.creator = "FORMA";
const ws = wb.addWorksheet("Invoices");
ws.addRow(["Invoice register — Q4 2026"]);
ws.mergeCells("A1:D1");
ws.getCell("A1").font = { bold: true, size: 14 };
ws.addRow([]);
ws.addRow(header).font = { bold: true };
for (const r of rows) ws.addRow(r);
ws.getColumn(4).numFmt = '"RM" #,##0.00';
ws.columns.forEach((c, i) => (c.width = [6, 22, 52, 14, 10, 18, 14][i]));

const summary = wb.addWorksheet("Summary");
summary.addRow(["Metric", "Value"]);
summary.addRow(["Invoices", rows.length]);
summary.addRow(["Generated", "FORMA sample"]);

const archive = wb.addWorksheet("Archive");
archive.addRow(["No.", "Customer", "Details", "Amount", "Status"]);
for (let i = 0; i < 25; i++) archive.addRow([i + 1, pick(CUSTOMERS), `Inv #INV-${1000 + i}, Due 01/06/2026, Total RM 1,000`, 1000, "Paid"]);

await wb.xlsx.writeFile(join(OUT, "invoices.xlsx"));

const csvEsc = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
writeFileSync(join(OUT, "invoices.csv"), [header, ...rows].map((r) => r.map(csvEsc).join(",")).join("\n") + "\n");
console.log(`samples: ${rows.length} invoice rows → public/samples/invoices.{xlsx,csv}`);
