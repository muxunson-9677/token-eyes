import { describe, expect, it } from "vitest";
import { getCumulativeYesterdayComparison } from "../leaderboard-summary-details.js";

describe("leaderboard summary details", () => {
  it("derives yesterday's cumulative baseline from the real total and today's usage", () => {
    expect(getCumulativeYesterdayComparison(10_261_000_000, 521_000_000)).toEqual({
      change: 521_000_000,
      percent: 5.349075975359343,
    });
  });

  it("does not manufacture a percentage when there is no usable baseline", () => {
    expect(getCumulativeYesterdayComparison(0, 0)).toBeNull();
    expect(getCumulativeYesterdayComparison(100, 101)).toBeNull();
  });
});
