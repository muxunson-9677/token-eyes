import { describe, expect, it } from "vitest";
import { calculateResetStatistics } from "./reset-history-stats";

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
    });
  });
});
