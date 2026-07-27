"use strict";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDayKey(date) {
  const values = {};
  for (const part of dayFormatter.formatToParts(date)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function mondayKey(dayKey) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function rolling30DayKey(dayKey) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
}

function nonNegativeCost(value, label) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new TypeError(`Invalid ${label} actual-cost total`);
  }
  return Number(numberValue.toFixed(6));
}

async function buildLeaderboardActualCostSummary({
  capturedAt,
  readCombinedCost,
} = {}) {
  const capturedDate = capturedAt instanceof Date
    ? capturedAt
    : new Date(capturedAt || Date.now());
  if (!Number.isFinite(capturedDate.getTime())) {
    throw new TypeError("capturedAt must be a valid date");
  }
  if (typeof readCombinedCost !== "function") {
    throw new TypeError("readCombinedCost is required");
  }

  const today = shanghaiDayKey(capturedDate);
  const periods = [
    { name: "today", from: today, to: today },
    { name: "week", from: mondayKey(today), to: today },
    { name: "30d", from: rolling30DayKey(today), to: today },
    { name: "month", from: `${today.slice(0, 7)}-01`, to: today },
  ];
  const [todayResult, weekResult, rolling30DayResult, monthResult] = await Promise.all(
    periods.map((period) => readCombinedCost(period)),
  );

  return {
    captured_at: capturedDate.toISOString(),
    period_costs_usd: {
      today: nonNegativeCost(todayResult?.totals?.combined_usd, "today"),
      week: nonNegativeCost(weekResult?.totals?.combined_usd, "week"),
      "30d": nonNegativeCost(rolling30DayResult?.totals?.combined_usd, "30d"),
      month: nonNegativeCost(monthResult?.totals?.combined_usd, "month"),
      total: nonNegativeCost(monthResult?.totals?.lifetime_combined_usd, "total"),
    },
  };
}

module.exports = {
  buildLeaderboardActualCostSummary,
};
