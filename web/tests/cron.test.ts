import { describe, expect, it } from "vitest";
import { nextRuns, parseCron } from "@/lib/cron";

describe("cron", () => {
  const from = new Date(Date.UTC(2026, 8, 30, 10, 21)); // Wed 30 Sep 2026 10:21 UTC
  it("validates expressions", () => {
    expect(parseCron("0 6 * * 1-5")).not.toBeNull();
    expect(parseCron("*/15 * * * *")).not.toBeNull();
    expect(parseCron("61 * * * *")).toBeNull();
    expect(parseCron("0 6 * *")).toBeNull();
  });
  it("computes next runs", () => {
    expect(nextRuns("0 6 * * *", 2, from).map((d) => d.toISOString())).toEqual(["2026-10-01T06:00:00.000Z", "2026-10-02T06:00:00.000Z"]);
    expect(nextRuns("0 6 * * 1", 1, from)[0].toISOString()).toBe("2026-10-05T06:00:00.000Z");
    expect(nextRuns("*/15 * * * *", 2, from).map((d) => d.toISOString())).toEqual(["2026-09-30T10:30:00.000Z", "2026-09-30T10:45:00.000Z"]);
    expect(nextRuns("0 6 1 * *", 1, from)[0].toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });
});
