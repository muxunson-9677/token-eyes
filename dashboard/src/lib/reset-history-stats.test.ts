import { describe, expect, it } from "vitest";
import {
  calculateResetActivityDays,
  calculateResetStatistics,
  RESET_HISTORY_TIME_ZONE,
  resetHistoryDayKey,
} from "./reset-history-stats";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-07-30T12:00:00.000Z");

function event(id: string, occurredAt: string) {
  return {
    id,
    type: "official_reset_announcement" as const,
    occurred_at: occurredAt,
  };
}

describe("calculateResetStatistics", () => {
  it("does not invent precise intervals from official date-only announcements", () => {
    const result = calculateResetStatistics([
      event("one", "2026-07-20T12:00:00.000Z"),
      { ...event("two", "2026-07-22T00:00:00.000Z"), published_precision: "day" as const },
    ], NOW_MS);
    expect(result.count).toBe(2);
    expect(result.averageIntervalMs).toBeNull();
    expect(result.shortestIntervalMs).toBeNull();
    expect(result.longestIntervalMs).toBeNull();
  });
  it("calculates adjacent intervals for valid official resets in the last thirty days", () => {
    const result = calculateResetStatistics([
      event("old", "2026-06-29T12:00:00.000Z"),
      event("invalid", "not-a-date"),
      event("one", "2026-07-20T00:00:00.000Z"),
      event("two", "2026-07-22T00:00:00.000Z"),
      event("three", "2026-07-25T00:00:00.000Z"),
      event("four", "2026-07-29T00:00:00.000Z"),
    ], NOW_MS);

    expect(result).toEqual({
      periodDays: 30,
      count: 4,
      averageIntervalMs: 3 * DAY_MS,
      shortestIntervalMs: 2 * DAY_MS,
      longestIntervalMs: 4 * DAY_MS,
      // "old" (2026-06-29) sits in the preceding 30-day window.
      previousCount: 1,
      countChangePercent: 300,
    });
  });

  it("returns no interval values when fewer than two valid resets exist", () => {
    expect(calculateResetStatistics([
      event("one", "2026-07-29T00:00:00.000Z"),
    ], NOW_MS)).toEqual({
      periodDays: 30,
      count: 1,
      averageIntervalMs: null,
      shortestIntervalMs: null,
      longestIntervalMs: null,
      previousCount: 0,
      // No baseline in the previous window: comparison is undefined, not 0%.
      countChangePercent: null,
    });
  });

  it("reports a negative period-over-period change when activity slows down", () => {
    const result = calculateResetStatistics([
      event("prev-1", "2026-06-05T00:00:00.000Z"),
      event("prev-2", "2026-06-15T00:00:00.000Z"),
      event("prev-3", "2026-06-25T00:00:00.000Z"),
      event("prev-4", "2026-06-29T00:00:00.000Z"),
      event("cur-1", "2026-07-20T00:00:00.000Z"),
    ], NOW_MS);

    expect(result.count).toBe(1);
    expect(result.previousCount).toBe(4);
    expect(result.countChangePercent).toBe(-75);
  });
});

describe("Asia/Shanghai reset day keys", () => {
  it("uses the explicit Shanghai midnight boundary", () => {
    expect(RESET_HISTORY_TIME_ZONE).toBe("Asia/Shanghai");
    expect(resetHistoryDayKey("2026-08-21T15:59:59.999Z")).toBe("2026-08-21");
    expect(resetHistoryDayKey("2026-08-21T16:00:00.000Z")).toBe("2026-08-22");
  });

  it("counts adjacent UTC timestamps on their Shanghai calendar days", () => {
    const days = calculateResetActivityDays([
      event("before-midnight", "2026-08-21T15:59:59.999Z"),
      event("after-midnight", "2026-08-21T16:00:00.000Z"),
    ], Date.parse("2026-08-22T04:00:00.000Z"));

    expect(days.at(-2)).toEqual({ key: "2026-08-21", count: 1, offset: 1 });
    expect(days.at(-1)).toEqual({ key: "2026-08-22", count: 1, offset: 0 });
  });
});
