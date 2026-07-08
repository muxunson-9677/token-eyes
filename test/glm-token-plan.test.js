"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  parseGlmQuotaResponse,
  fetchGlmQuota,
  GlmTokenPlanError,
  mapGlmErrorCode,
} = require("../src/lib/glm-token-plan");

const payload = {
  code: 200,
  data: {
    level: "pro",
    limits: [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        usage: 4_000_000,
        currentValue: 1_000_000,
        percentage: 25,
        nextResetTime: "2026-07-03T15:00:00+08:00",
      },
      {
        type: "TOKENS_LIMIT",
        unit: 6,
        usage: 20_000_000,
        currentValue: 5_000_000,
        percentage: 25,
        nextResetTime: "2026-07-08T10:00:00+08:00",
      },
    ],
  },
};

test("parseGlmQuotaResponse returns 5-hour and weekly token windows", () => {
  const result = parseGlmQuotaResponse(payload);
  assert.equal(result.level, "pro");
  assert.deepEqual(result.quota_windows, [
    {
      kind: "rolling_5_hour",
      unit: "tokens",
      total: 4_000_000,
      used: 1_000_000,
      remaining: 3_000_000,
      percentage: 25,
      resets_at: "2026-07-03T15:00:00+08:00",
    },
    {
      kind: "rolling_weekly",
      unit: "tokens",
      total: 20_000_000,
      used: 5_000_000,
      remaining: 15_000_000,
      percentage: 25,
      resets_at: "2026-07-08T10:00:00+08:00",
    },
  ]);
});

test("parseGlmQuotaResponse rejects a missing weekly window", () => {
  assert.throws(
    () => parseGlmQuotaResponse({ code: 200, data: { limits: [payload.data.limits[0]] } }),
    (error) => error instanceof GlmTokenPlanError && error.code === "GLM_RESPONSE_STRUCTURE_DRIFT",
  );
});

test("fetchGlmQuota sends the API key only to the official usage endpoint", async () => {
  const calls = [];
  const result = await fetchGlmQuota({
    apiKey: "glm-test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      };
    },
  });
  assert.equal(calls[0].url, "https://open.bigmodel.cn/api/monitor/usage/quota/limit");
  assert.equal(calls[0].options.headers.Authorization, "glm-test-key");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(result.quota_windows[1].remaining, 15_000_000);
});

test("fetchGlmQuota maps provider auth errors without including the key", async () => {
  await assert.rejects(
    fetchGlmQuota({
      apiKey: "glm-secret-key",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 1001, msg: "unauthorized" }),
      }),
    }),
    (error) => error.code === "GLM_REAUTH_REQUIRED" && !error.message.includes("glm-secret-key"),
  );
});

test("mapGlmErrorCode maps GLM errors to sync statuses", () => {
  assert.equal(mapGlmErrorCode(new GlmTokenPlanError("GLM_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapGlmErrorCode(new GlmTokenPlanError("GLM_RESPONSE_STRUCTURE_DRIFT", "x")), "unsupported");
  assert.equal(mapGlmErrorCode(new GlmTokenPlanError("GLM_TIMEOUT", "x")), "failed");
});
