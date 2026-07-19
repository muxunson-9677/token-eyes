import { describe, expect, it } from "vitest";
import { getMonthComparisonRanges } from "./date-range";

describe("getMonthComparisonRanges", () => {
  it("compares month-to-date with the same elapsed period last month", () => {
    const ranges = getMonthComparisonRanges({
      now: new Date("2026-07-19T12:30:00+08:00"),
      timeZone: "Asia/Shanghai",
    });

    expect(ranges.current).toEqual({ from: "2026-07-01", to: "2026-07-19" });
    expect(ranges.previous).toEqual({ from: "2026-06-01", to: "2026-06-19" });
  });

  it("returns month-to-date ranges across a year boundary in the requested timezone", () => {
    // 2025-12-31T16:30Z == 2026-01-01 00:30 Asia/Shanghai
    const ranges = getMonthComparisonRanges({
      timeZone: "Asia/Shanghai",
      now: new Date("2025-12-31T16:30:00.000Z"),
    });

    expect(ranges.current).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(ranges.previous).toEqual({ from: "2025-12-01", to: "2025-12-01" });
  });

  it("uses the explicit UTC offset when an IANA timezone is unavailable", () => {
    // 2026-02-28T16:30Z + 480min == 2026-03-01 00:30 local
    const ranges = getMonthComparisonRanges({
      offsetMinutes: 480,
      now: new Date("2026-02-28T16:30:00.000Z"),
    });

    expect(ranges.current).toEqual({ from: "2026-03-01", to: "2026-03-01" });
    expect(ranges.previous).toEqual({ from: "2026-02-01", to: "2026-02-01" });
  });

  it("clamps previous period to the last day of last month when the day does not exist", () => {
    const ranges = getMonthComparisonRanges({
      now: new Date("2026-03-31T15:45:00+08:00"),
      timeZone: "Asia/Shanghai",
    });

    expect(ranges.current).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(ranges.previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
