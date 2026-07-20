"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildLeaderboardActualCostSummary,
} = require("../src/lib/leaderboard-actual-cost");

test("builds four Shanghai periods from the same combined-cost reader and exposes totals only", async () => {
  const calls = [];
  const privateTimeseries = {
    today: {
      totals: { combined_usd: 1.25, lifetime_combined_usd: 240 },
      records: [{ id: "record-today", plan_label: "Private Plus" }],
      by_source: [{ source: "codex", combined_usd: 1.25 }],
    },
    week: {
      totals: { combined_usd: 8.5, lifetime_combined_usd: 240 },
      merchant: "Private merchant",
      transactions: [{ payment_method: "private-card" }],
    },
    month: {
      totals: { combined_usd: 31.75, lifetime_combined_usd: 240 },
      notes: "Private note",
      provider_account_name: "private@example.com",
    },
  };

  const result = await buildLeaderboardActualCostSummary({
    capturedAt: "2026-07-20T08:00:00.000Z",
    async readCombinedCost(period) {
      calls.push(period);
      return privateTimeseries[period.name];
    },
  });

  assert.deepEqual(calls, [
    { name: "today", from: "2026-07-20", to: "2026-07-20" },
    { name: "week", from: "2026-07-20", to: "2026-07-20" },
    { name: "month", from: "2026-07-01", to: "2026-07-20" },
  ]);
  assert.deepEqual(result, {
    captured_at: "2026-07-20T08:00:00.000Z",
    period_costs_usd: {
      today: 1.25,
      week: 8.5,
      month: 31.75,
      total: 240,
    },
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "record-today",
    "Private Plus",
    "Private merchant",
    "private-card",
    "Private note",
    "private@example.com",
    "by_source",
    "transactions",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must omit ${forbidden}`);
  }
});

test("rejects missing, negative, or non-finite combined totals", async () => {
  await assert.rejects(
    buildLeaderboardActualCostSummary({
      capturedAt: "2026-07-20T08:00:00.000Z",
      async readCombinedCost(period) {
        if (period.name === "today") return { totals: { combined_usd: -1 } };
        return { totals: { combined_usd: 0, lifetime_combined_usd: 0 } };
      },
    }),
    /Invalid today actual-cost total/,
  );
});
