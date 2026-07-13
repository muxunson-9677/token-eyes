import { describe, expect, it } from "vitest";
import { getMonthComparisonRanges } from "./date-range";

describe("getMonthComparisonRanges", () => {
  it("returns adjacent natural months in the requested timezone across a year boundary", () => {
    const ranges = getMonthComparisonRanges({
      timeZone: "Asia/Shanghai",
      now: new Date("2025-12-31T16:30:00.000Z"),
    });

    expect(ranges.current).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(ranges.previous).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("uses the explicit UTC offset when an IANA timezone is unavailable", () => {
    const ranges = getMonthComparisonRanges({
      offsetMinutes: 480,
      now: new Date("2026-02-28T16:30:00.000Z"),
    });

    expect(ranges.current).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(ranges.previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
