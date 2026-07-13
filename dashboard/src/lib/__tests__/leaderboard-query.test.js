import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_DEFAULT_AGENT,
  LEADERBOARD_DEFAULT_METRIC,
  LEADERBOARD_DEFAULT_PERIOD,
  getLeaderboardAgentLabel,
  normalizeLeaderboardAgent,
  normalizeLeaderboardMetric,
  normalizeLeaderboardPeriod,
} from "../leaderboard-query.js";
import { getMockLeaderboard } from "../mock-data.ts";

describe("leaderboard query dimensions", () => {
  it("normalizes the five supported periods and keeps old links compatible", () => {
    expect(normalizeLeaderboardPeriod("today")).toBe("today");
    expect(normalizeLeaderboardPeriod("yesterday")).toBe("yesterday");
    expect(normalizeLeaderboardPeriod("7D")).toBe("7d");
    expect(normalizeLeaderboardPeriod("30d")).toBe("30d");
    expect(normalizeLeaderboardPeriod("total")).toBe("total");
    expect(normalizeLeaderboardPeriod("week")).toBe("7d");
    expect(normalizeLeaderboardPeriod("month")).toBe("30d");
    expect(normalizeLeaderboardPeriod("quarter")).toBe(LEADERBOARD_DEFAULT_PERIOD);
  });

  it("accepts every registered Agent source and rejects invented sources", () => {
    expect(normalizeLeaderboardAgent("all")).toBe("all");
    expect(normalizeLeaderboardAgent("Codex")).toBe("codex");
    expect(normalizeLeaderboardAgent("trae")).toBe("trae");
    expect(normalizeLeaderboardAgent("codebuddy")).toBe("codebuddy");
    expect(normalizeLeaderboardAgent("not-a-real-agent")).toBe(LEADERBOARD_DEFAULT_AGENT);
    expect(getLeaderboardAgentLabel("codebuddy")).toBe("CodeBuddy");
  });

  it("normalizes cache and estimated-cost metrics", () => {
    expect(normalizeLeaderboardMetric("with_cache")).toBe("with_cache");
    expect(normalizeLeaderboardMetric("without_cache")).toBe("without_cache");
    expect(normalizeLeaderboardMetric("estimated_cost")).toBe("estimated_cost");
    expect(normalizeLeaderboardMetric("raw_cost")).toBe(LEADERBOARD_DEFAULT_METRIC);
  });
});

describe("mock leaderboard dimensions", () => {
  it("mirrors the live Agent, period and cache-metric contract", () => {
    const result = getMockLeaderboard({
      seed: "dimensions",
      period: "today",
      agent: "codex",
      metric: "without_cache",
      limit: 5,
    });

    expect(result).toMatchObject({
      period: "today",
      agent: "codex",
      metric: "without_cache",
      total_entries: 250,
    });
    expect(result.entries).toHaveLength(5);
    expect(Number(result.entries[0].score)).toBeGreaterThanOrEqual(
      Number(result.entries[1].score),
    );
  });
});
