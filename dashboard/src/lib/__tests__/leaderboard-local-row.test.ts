import { describe, expect, it } from "vitest";
import {
  buildLocalLeaderboardRow,
  getLeaderboardPeriodDateRange,
} from "../leaderboard-local-row";

describe("buildLocalLeaderboardRow", () => {
  const response = {
    ok: true,
    state: {
      periods: {
        today: [],
        week: [],
        month: [],
        total: [
          ["codex", "gpt-5.4", "10", "20", "30", "40", "50"],
          ["cursor", "auto", "1", "2", "3", "4", "5"],
          ["custom-agent", "model", "2", "3", "0", "0", "0"],
        ],
      },
    },
  };

  it("turns compact local usage into a pending leaderboard row", () => {
    const row = buildLocalLeaderboardRow(response, {
      period: "total",
      source: "all",
      userId: "user-1",
      estimatedCostUsd: 12.34,
      actualCostUsd: 8.5,
    });

    expect(row).toMatchObject({
      user_id: "user-1",
      rank: null,
      is_me: true,
      is_local_pending: true,
      gpt_tokens: "100",
      cursor_tokens: "15",
      other_tokens: "5",
      total_tokens: "120",
      estimated_cost_usd: 12.34,
      actual_cost_usd: 8.5,
    });
    expect(row.source_breakdown).toEqual([
      { source: "codex", total_tokens: "100" },
      { source: "cursor", total_tokens: "15" },
      { source: "custom-agent", total_tokens: "5" },
    ]);
  });

  it("matches the usage dashboard by treating Codex reasoning as informational", () => {
    const row = buildLocalLeaderboardRow({
      state: {
        periods: {
          total: [
            ["codex", "gpt-5.4", "10", "20", "30", "40", "50"],
            ["hermes", "model", "1", "2", "3", "4", "5"],
          ],
        },
      },
    }, {
      period: "total",
      source: "all",
      userId: "user-1",
    });

    expect(row.gpt_tokens).toBe("100");
    expect(row.hermes_tokens).toBe("15");
    expect(row.total_tokens).toBe("115");
  });

  it("applies the selected source before calculating the row", () => {
    const row = buildLocalLeaderboardRow(response, {
      period: "total",
      source: "cursor",
      userId: "user-1",
    });

    expect(row.total_tokens).toBe("15");
    expect(row.cursor_tokens).toBe("15");
    expect(row.gpt_tokens).toBe("0");
    expect(row.actual_cost_usd).toBeNull();
  });

  it("groups providers outside the public filters into Other", () => {
    const row = buildLocalLeaderboardRow(response, {
      period: "total",
      source: "other",
      userId: "user-1",
    });

    expect(row.total_tokens).toBe("5");
    expect(row.other_tokens).toBe("5");
    expect(row.gpt_tokens).toBe("0");
    expect(row.cursor_tokens).toBe("0");
  });

  it("builds Shanghai calendar ranges for local cost queries", () => {
    const now = new Date("2026-07-22T08:00:00.000Z");
    expect(getLeaderboardPeriodDateRange("today", now)).toEqual({
      from: "2026-07-22",
      to: "2026-07-22",
    });
    expect(getLeaderboardPeriodDateRange("week", now)).toEqual({
      from: "2026-07-20",
      to: "2026-07-22",
    });
    expect(getLeaderboardPeriodDateRange("30d", now)).toEqual({
      from: "2026-06-23",
      to: "2026-07-22",
    });
    expect(getLeaderboardPeriodDateRange("month", now)).toEqual({
      from: "2026-07-01",
      to: "2026-07-22",
    });
    expect(getLeaderboardPeriodDateRange("total", now)).toEqual({
      from: "1970-01-01",
      to: "2026-07-22",
    });
  });
});
