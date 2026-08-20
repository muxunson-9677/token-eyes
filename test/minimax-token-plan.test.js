"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  parseMiniMaxTokenPlanResponse,
  fetchMiniMaxTokenPlanRemains,
  MiniMaxTokenPlanError,
  mapMiniMaxErrorCode,
} = require("../src/lib/minimax-token-plan");

const tokenPlanPayload = {
  base_resp: { status_code: 0, status_msg: "success" },
  model_remains: [
    {
      model_name: "MiniMax-M*",
      current_interval_total_count: 1500,
      current_interval_usage_count: 151,
      current_weekly_total_count: 10000,
      current_weekly_usage_count: 2500,
      end_time: 1778630400000,
      weekly_end_time: 1779062400000,
      current_subscribe_title: "Coding Plan Pro",
    },
  ],
};

test("parseMiniMaxTokenPlanResponse maps interval and weekly windows", () => {
  const result = parseMiniMaxTokenPlanResponse(tokenPlanPayload);
  assert.equal(result.quota_unit, "provider_count");
  assert.equal(result.total_quota, 10000);
  assert.equal(result.used_quota, 2500);
  assert.equal(result.remaining_quota, 7500);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[0].unit, "provider_count");
  assert.equal(result.quota_windows[0].used, 151);
  assert.equal(result.quota_windows[0].total, 1500);
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
  assert.equal(result.quota_windows[1].unit, "provider_count");
});

test("DATA-03 treats interval and weekly usage_count as consumed and saturates overage", () => {
  const result = parseMiniMaxTokenPlanResponse({
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: "MiniMax-M*",
      current_interval_total_count: 100,
      current_interval_usage_count: 101,
      current_weekly_total_count: 100,
      current_weekly_usage_count: 101,
    }],
  });

  assert.equal(result.quota_unit, "provider_count");
  assert.equal(result.total_quota, 100);
  assert.equal(result.used_quota, 100);
  assert.equal(result.remaining_quota, 0);
  for (const window of result.quota_windows) {
    assert.equal(window.unit, "provider_count");
    assert.equal(window.total, 100);
    assert.equal(window.used, 100);
    assert.equal(window.remaining, 0);
    assert.equal(window.percentage, 100);
    assert.equal(Object.prototype.hasOwnProperty.call(window, "overage"), false);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(result, "overage"), false);
});

test("DATA-03 saturates negative usage_count at zero without changing units", () => {
  const result = parseMiniMaxTokenPlanResponse({
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: "MiniMax-M*",
      current_interval_total_count: 100,
      current_interval_usage_count: -1,
      current_weekly_total_count: 100,
      current_weekly_usage_count: -1,
    }],
  });

  assert.equal(result.quota_unit, "provider_count");
  for (const window of result.quota_windows) {
    assert.deepEqual(
      { unit: window.unit, total: window.total, used: window.used, remaining: window.remaining, percentage: window.percentage },
      { unit: "provider_count", total: 100, used: 0, remaining: 100, percentage: 0 },
    );
  }
});

test("DATA-03 MiniMax rejects string fractional and unsafe counts without alias fallback", () => {
  const baseEntry = {
    model_name: "MiniMax-M*",
    current_interval_total_count: 100,
    current_interval_usage_count: 20,
    current_weekly_total_count: 100,
    current_weekly_usage_count: 20,
  };
  const cases = [
    {
      label: "interval total numeric string",
      rawValue: "100",
      mutate(entry) {
        entry.current_interval_total_count = this.rawValue;
      },
    },
    {
      label: "interval usage numeric string cannot fall back to remaining_count",
      rawValue: "20",
      mutate(entry) {
        entry.current_interval_usage_count = this.rawValue;
        entry.current_interval_remaining_count = 80;
      },
    },
    {
      label: "interval fractional usage cannot fall back to remaining_count",
      rawValue: 1.5,
      mutate(entry) {
        entry.current_interval_usage_count = this.rawValue;
        entry.current_interval_remaining_count = 80;
      },
    },
    {
      label: "interval unsafe usage cannot fall back to remaining_count",
      rawValue: Number.MAX_SAFE_INTEGER + 1,
      mutate(entry) {
        entry.current_interval_usage_count = this.rawValue;
        entry.current_interval_remaining_count = 80;
      },
    },
    {
      label: "interval remaining_count numeric string",
      rawValue: "80",
      mutate(entry) {
        delete entry.current_interval_usage_count;
        entry.current_interval_remaining_count = this.rawValue;
      },
    },
    {
      label: "interval remains_count alias numeric string",
      rawValue: "80",
      mutate(entry) {
        delete entry.current_interval_usage_count;
        entry.current_interval_remains_count = this.rawValue;
      },
    },
    {
      label: "weekly usage numeric string cannot fall back to remaining_count",
      rawValue: "20",
      mutate(entry) {
        entry.current_weekly_usage_count = this.rawValue;
        entry.current_weekly_remaining_count = 80;
      },
    },
    {
      label: "weekly total numeric string",
      rawValue: "100",
      mutate(entry) {
        entry.current_weekly_total_count = this.rawValue;
      },
    },
    {
      label: "weekly remaining_count fraction",
      rawValue: 79.5,
      mutate(entry) {
        delete entry.current_weekly_usage_count;
        entry.current_weekly_remaining_count = this.rawValue;
      },
    },
    {
      label: "unused interval remains_count alias numeric string",
      rawValue: "80",
      mutate(entry) {
        entry.current_interval_remaining_count = 80;
        entry.current_interval_remains_count = this.rawValue;
      },
    },
    {
      label: "unused weekly remaining_count numeric string behind valid usage",
      rawValue: "80",
      mutate(entry) {
        entry.current_weekly_remaining_count = this.rawValue;
      },
    },
  ];

  for (const testCase of cases) {
    const entry = structuredClone(baseEntry);
    testCase.mutate(entry);
    assert.throws(
      () => parseMiniMaxTokenPlanResponse({
        base_resp: { status_code: 0 },
        model_remains: [entry],
      }),
      (error) => {
        assert.ok(error instanceof MiniMaxTokenPlanError);
        assert.equal(error.code, "MINIMAX_RESPONSE_STRUCTURE_DRIFT");
        assert.equal(error.message.includes(String(testCase.rawValue)), false);
        return true;
      },
      testCase.label,
    );
  }
});

test("DATA-03 MiniMax validates remaining_percent only when percentage fallback is used", () => {
  const invalidValues = ["50", -1, 101, Number.NaN, Number.POSITIVE_INFINITY];
  for (const prefix of ["interval", "weekly"]) {
    for (const rawValue of invalidValues) {
      const entry = {
        model_name: "MiniMax-M*",
        current_interval_total_count: 100,
        current_interval_usage_count: 20,
        current_weekly_total_count: 100,
        current_weekly_usage_count: 20,
      };
      delete entry[`current_${prefix}_usage_count`];
      entry[`current_${prefix}_remaining_percent`] = rawValue;
      assert.throws(
        () => parseMiniMaxTokenPlanResponse({
          base_resp: { status_code: 0 },
          model_remains: [entry],
        }),
        (error) => error instanceof MiniMaxTokenPlanError
          && error.code === "MINIMAX_RESPONSE_STRUCTURE_DRIFT"
          && !error.message.includes(String(rawValue)),
        `${prefix} remaining_percent ${String(rawValue)} must be rejected when used as fallback`,
      );
    }
  }

  const ignoredInvalidFallback = parseMiniMaxTokenPlanResponse({
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: "MiniMax-M*",
      current_interval_total_count: 100,
      current_interval_usage_count: 20,
      current_interval_remaining_percent: "not-used",
    }],
  });
  assert.equal(ignoredInvalidFallback.used_quota, 20);

  const fractionalPercent = parseMiniMaxTokenPlanResponse({
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: "MiniMax-M*",
      current_interval_total_count: 100,
      current_interval_remaining_percent: 12.5,
    }],
  });
  assert.equal(fractionalPercent.used_quota, 88);
});

test("DATA-03 MiniMax catalog records manual quota as provider_count", () => {
  const catalog = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "token-plan-catalog", "minimax.catalog.json"),
    "utf8",
  ));
  const manualQuota = catalog.plans.find((plan) => plan.plan_id === "minimax_manual_quota");
  assert.ok(manualQuota);
  assert.equal(manualQuota.quota.unit, "provider_count");
  assert.notEqual(manualQuota.quota.unit, "tokens");
});

test("parseMiniMaxTokenPlanResponse supports remaining-count aliases on interval", () => {
  const result = parseMiniMaxTokenPlanResponse({
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: "general",
      current_interval_total_count: 300,
      current_interval_remaining_count: 240,
    }],
  });
  assert.equal(result.quota_windows[0].used, 60);
  assert.equal(result.quota_windows[0].remaining, 240);
});

test("fetchMiniMaxTokenPlanRemains tries CN then global hosts", async () => {
  const calls = [];
  const result = await fetchMiniMaxTokenPlanRemains({
    apiKey: "sk-minimax-test",
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("minimaxi.com")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            base_resp: { status_code: 2049, status_msg: "invalid api key" },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(tokenPlanPayload),
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "https://api.minimaxi.com/v1/token_plan/remains");
  assert.equal(calls[1], "https://api.minimax.io/v1/token_plan/remains");
  assert.equal(result.remaining_quota, 7500);
});

test("fetchMiniMaxTokenPlanRemains maps auth errors without leaking the API key", async () => {
  await assert.rejects(
    fetchMiniMaxTokenPlanRemains({
      apiKey: "sk-secret-minimax",
      urls: ["https://api.minimaxi.com/v1/token_plan/remains"],
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ base_resp: { status_code: 1004 } }),
      }),
    }),
    (error) => error.code === "MINIMAX_REAUTH_REQUIRED" && !error.message.includes("sk-secret-minimax"),
  );
});

test("mapMiniMaxErrorCode maps MiniMax errors to sync statuses", () => {
  assert.equal(mapMiniMaxErrorCode(new MiniMaxTokenPlanError("MINIMAX_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapMiniMaxErrorCode(new MiniMaxTokenPlanError("MINIMAX_UNSUPPORTED", "x")), "unsupported");
});
