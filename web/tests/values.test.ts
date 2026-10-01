import { describe, expect, it } from "vitest";
import { detectDateFormats, formatDate, parseDate, parseMoney, roundHalfEven, titleCase, toNum, toText } from "@/engine/values";
import { evalFormula, parseFormula } from "@/engine/formula";

describe("values", () => {
  it("canonical text", () => {
    expect(toText(4500)).toBe("4500");
    expect(toText(4500.5)).toBe("4500.5");
    expect(toText(1e-7)).toBe("1e-07");
    expect(toText(true)).toBe("True");
    expect(toText(null)).toBeNull();
  });
  it("parses money but rejects ambiguous amounts", () => {
    expect(parseMoney("RM 4,500")).toBe(4500);
    expect(parseMoney("RM3,220")).toBe(3220);
    expect(parseMoney("-RM 50")).toBe(-50);
    expect(parseMoney("RM -50")).toBe(-50);
    expect(parseMoney("$1,299.99")).toBe(1299.99);
    expect(parseMoney("4500 MYR")).toBe(4500);
    expect(parseMoney("RM3.1k")).toBeNull();
    expect(parseMoney("RM3,OOO")).toBeNull();
    expect(parseMoney("12,34")).toBeNull();
    expect(parseMoney("INV-2231")).toBeNull(); // IDs are not amounts
    expect(parseMoney("S$ 12.50")).toBe(12.5);
  });
  it("strict numbers", () => {
    expect(toNum("12.5")).toBe(12.5);
    expect(toNum("")).toBeNull();
    expect(toNum("4,500")).toBeNull();
  });
  it("rounds half to even like numpy", () => {
    expect(roundHalfEven(2.5, 0)).toBe(2);
    expect(roundHalfEven(3.5, 0)).toBe(4);
    expect(roundHalfEven(-2.5, 0)).toBe(-2);
    expect(roundHalfEven(1.005, 2)).toBe(1);
    expect(roundHalfEven(4500, 2)).toBe(4500);
  });
  it("dates: validates calendar and formats", () => {
    const f = ["DD/MM/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"];
    expect(formatDate(parseDate("15/10/2026", f)!, "YYYY-MM-DD")).toBe("2026-10-15");
    expect(formatDate(parseDate("Oct 21, 2026", f)!, "YYYY-MM-DD")).toBe("2026-10-21");
    expect(parseDate("31/13/2026", f)).toBeNull();
    expect(parseDate("29/02/2026", f)).toBeNull();
    expect(parseDate("29/02/2028", f)).not.toBeNull();
    expect(formatDate({ y: 2026, m: 10, d: 5 }, "DD MMM YYYY")).toBe("05 Oct 2026");
  });
  it("detects mixed date formats", () => {
    const d = detectDateFormats(["15/10/2026", "2026-10-18", "Oct 21, 2026", "25/10/2026"]);
    expect(d.map((x) => x.format)).toEqual(["DD/MM/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"]);
  });
  it("title case like Python", () => {
    expect(titleCase("o'neil abc1def")).toBe("O'Neil Abc1Def");
  });
});

describe("formula", () => {
  const row: Record<string, unknown> = { Amount: 100, Tax: "6", Blank: null };
  const get = (c: string) => row[c] as never;
  it("evaluates arithmetic and functions", () => {
    expect(evalFormula(parseFormula("[Amount] * 1.06"), get)).toBeCloseTo(106);
    expect(evalFormula(parseFormula("round([Amount] / 3, 2)"), get)).toBe(33.33);
    expect(evalFormula(parseFormula("-[Tax] + abs(-4)"), get)).toBe(-2);
    expect(evalFormula(parseFormula("max([Amount], [Tax])"), get)).toBe(100);
  });
  it("propagates blanks and division by zero", () => {
    expect(evalFormula(parseFormula("[Blank] + 1"), get)).toBeNull();
    expect(evalFormula(parseFormula("[Amount] / 0"), get)).toBeNull();
  });
  it("reports syntax errors", () => {
    expect(() => parseFormula("[Amount] *")).toThrow();
    expect(() => parseFormula("foo(1)")).toThrow(/Unknown function/);
  });
});
