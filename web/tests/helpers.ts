import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, parseExcel } from "@/parsers";
import type { RawSheet } from "@/engine/types";

export const SAMPLES = join(__dirname, "..", "public", "samples");

export async function sampleSheet(name = "Invoices"): Promise<RawSheet> {
  const buf = readFileSync(join(SAMPLES, "invoices.xlsx"));
  const sheets = await parseExcel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return sheets.find((s) => s.name === name)!;
}

export function sampleCsv(): RawSheet {
  return parseCsv(readFileSync(join(SAMPLES, "invoices.csv"), "utf8")).sheet;
}
