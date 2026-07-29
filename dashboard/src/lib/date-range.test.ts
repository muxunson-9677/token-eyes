import { describe, expect, it } from "vitest";
import { getCostMonthRanges, getMonthComparisonRanges, getRangeForPeriod } from "./date-range";

describe("getRangeForPeriod", () => {
  it("treats total as the complete local ledger instead of a rolling window", () => {
    expect(getRangeForPeriod("total", {
      now: new Date("2026-07-29T12:00:00+08:00"),
      timeZone: "Asia/Shanghai",
    })).toEqual({ from: "1970-01-01", to: "2026-07-29" });
  });
});

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

describe("getCostMonthRanges", () => {
  it("uses month-to-date and the same elapsed period for the local current month", () => {
    expect(getCostMonthRanges({
      selectedMonth: "2026-07",
      now: new Date("2026-07-20T10:00:00+08:00"),
      timeZone: "Asia/Shanghai",
    })).toEqual({
      selectedMonth: "2026-07",
      isCurrentMonth: true,
      selected: { from: "2026-07-01", to: "2026-07-20" },
      comparison: { from: "2026-06-01", to: "2026-06-20" },
      yearToSelected: { from: "2026-01-01", to: "2026-07-20" },
    });
  });

  it("uses complete selected and previous natural months for history", () => {
    expect(getCostMonthRanges({
      selectedMonth: "2025-06",
      now: new Date("2026-07-20T10:00:00+08:00"),
      timeZone: "Asia/Shanghai",
    })).toEqual({
      selectedMonth: "2025-06",
      isCurrentMonth: false,
      selected: { from: "2025-06-01", to: "2025-06-30" },
      comparison: { from: "2025-05-01", to: "2025-05-31" },
      yearToSelected: { from: "2025-01-01", to: "2025-06-30" },
    });
  });

  it("crosses the year boundary and keeps leap-day month ends", () => {
    const january = getCostMonthRanges({
      selectedMonth: "2025-01",
      now: new Date("2026-07-20T10:00:00+08:00"),
      timeZone: "Asia/Shanghai",
    });
    const leapFebruary = getCostMonthRanges({
      selectedMonth: "2024-02",
      now: new Date("2026-07-20T10:00:00+08:00"),
      timeZone: "Asia/Shanghai",
    });

    expect(january.comparison).toEqual({ from: "2024-12-01", to: "2024-12-31" });
    expect(leapFebruary.selected).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("clamps invalid and future selections to the local current month", () => {
    const options = {
      now: new Date("2025-12-31T16:30:00.000Z"),
      timeZone: "Asia/Shanghai",
    };

    expect(getCostMonthRanges({ ...options, selectedMonth: "not-a-month" }).selectedMonth).toBe("2026-01");
    expect(getCostMonthRanges({ ...options, selectedMonth: "2026-02" }).selectedMonth).toBe("2026-01");
  });
});
