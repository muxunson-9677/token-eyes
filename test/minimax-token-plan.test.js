"use strict";

const assert = require("node:assert/strict");
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
  assert.equal(result.total_quota, 10000);
  assert.equal(result.used_quota, 2500);
  assert.equal(result.remaining_quota, 7500);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[0].used, 151);
  assert.equal(result.quota_windows[0].total, 1500);
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
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
