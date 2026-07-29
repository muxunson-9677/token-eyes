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
  it("defaults to cumulative usage and keeps old links compatible", () => {
    expect(LEADERBOARD_DEFAULT_PERIOD).toBe("total");
    expect(normalizeLeaderboardPeriod("today")).toBe("today");
    expect(normalizeLeaderboardPeriod("week")).toBe("week");
    expect(normalizeLeaderboardPeriod("month")).toBe("month");
    expect(normalizeLeaderboardPeriod("total")).toBe("total");
    expect(normalizeLeaderboardPeriod("7D")).toBe("week");
    expect(normalizeLeaderboardPeriod("30d")).toBe("30d");
    expect(normalizeLeaderboardPeriod("yesterday")).toBe(LEADERBOARD_DEFAULT_PERIOD);
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

  it("normalizes token, estimated-spend and actual-cost metrics", () => {
    expect(normalizeLeaderboardMetric("tokens")).toBe("tokens");
    expect(normalizeLeaderboardMetric("estimated_spend")).toBe("estimated_spend");
    expect(normalizeLeaderboardMetric("actual_cost")).toBe("actual_cost");
    expect(normalizeLeaderboardMetric("with_cache")).toBe("tokens");
    expect(normalizeLeaderboardMetric("estimated_cost")).toBe("estimated_spend");
    expect(normalizeLeaderboardMetric("raw_cost")).toBe(LEADERBOARD_DEFAULT_METRIC);
  });
});

describe("mock leaderboard dimensions", () => {
  it("mirrors the live source, period and metric contract", () => {
    const result = getMockLeaderboard({
      seed: "dimensions",
      period: "today",
      source: "codex",
      metric: "tokens",
      limit: 5,
    });

    expect(result).toMatchObject({
      period: "today",
      source: "codex",
      metric: "tokens",
      total_entries: 250,
    });
    expect(result.entries).toHaveLength(5);
    expect(Number(result.entries[0].score)).toBeGreaterThanOrEqual(
      Number(result.entries[1].score),
    );
  });
});
