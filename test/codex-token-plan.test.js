"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  parseCodexUsageBody,
  CodexTokenPlanError,
  mapCodexErrorCode,
} = require("../src/lib/codex-token-plan");

const whamPayload = {
  rate_limit: {
    primary_window: {
      used_percent: 30,
      limit_window_seconds: 18000,
      reset_at: 1_700_000_000,
    },
    secondary_window: {
      used_percent: 55,
      limit_window_seconds: 604800,
      reset_at: "2026-07-10T00:00:00.000Z",
    },
  },
};

test("parseCodexUsageBody returns 5-hour and weekly percent windows", () => {
  const result = parseCodexUsageBody(whamPayload);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[0].used, 30);
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
  assert.equal(result.quota_windows[1].used, 55);
  assert.equal(result.remaining_quota, 45);
});

test("Task 8 Codex preserves fractional percent windows and never labels them as tokens", () => {
  const result = parseCodexUsageBody({
    rate_limit: {
      primary_window: {
        used_percent: 20.25,
        limit_window_seconds: 18000,
        reset_at: 1_700_000_000,
      },
      secondary_window: {
        used_percent: 60.75,
        limit_window_seconds: 604800,
        reset_at: 1_700_604_800,
      },
    },
  });

  assert.deepEqual(
    result.quota_windows.map(({ kind, unit, total, used, remaining, percentage }) => ({
      kind,
      unit,
      total,
      used,
      remaining,
      percentage,
    })),
    [
      {
        kind: "rolling_5_hour",
        unit: "percent",
        total: 100,
        used: 20.25,
        remaining: 79.75,
        percentage: 20.25,
      },
      {
        kind: "rolling_weekly",
        unit: "percent",
        total: 100,
        used: 60.75,
        remaining: 39.25,
        percentage: 60.75,
      },
    ],
  );
  assert.equal(result.used_quota, 60.75);
  assert.equal(result.remaining_quota, 39.25);
  assert.equal(result.quota_unit, "percent");
});

test("Task 8 Codex catalog declares dynamic quota as percent rather than tokens", () => {
  const catalog = require("../src/lib/token-plan-catalog/codex.catalog.json");
  assert.equal(catalog.plans.length > 0, true);
  assert.equal(catalog.plans.every((plan) => plan.quota.unit === "percent"), true);
});

test("parseCodexUsageBody rejects missing windows", () => {
  assert.throws(
    () => parseCodexUsageBody({ rate_limit: {} }),
    (error) => error instanceof CodexTokenPlanError && error.code === "CODEX_NO_QUOTA_WINDOWS",
  );
  assert.throws(
    () => parseCodexUsageBody({ rate_limit: { primary_window: { used_percent: null, limit_window_seconds: 18000 } } }),
    (error) => error instanceof CodexTokenPlanError && error.code === "CODEX_NO_QUOTA_WINDOWS",
  );
  assert.throws(
    () => parseCodexUsageBody({ rate_limit: { primary_window: { used_percent: "   ", limit_window_seconds: 18000 } } }),
    (error) => error instanceof CodexTokenPlanError && error.code === "CODEX_NO_QUOTA_WINDOWS",
  );
});

test("mapCodexErrorCode maps Codex errors to sync statuses", () => {
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_CONSOLE_SYNC_REQUIRED", "x")), "not_configured");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_NO_QUOTA_WINDOWS", "x")), "unsupported");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_ENDPOINT_UNSUPPORTED", "x")), "unsupported");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_TEMPORARY_ERROR", "x")), "temporary");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_NETWORK_ERROR", "x")), "temporary");
});

test("codex provider adapter uses the local official login for official_account detection", async () => {
  const { createCodexProviderAdapter } = require("../src/lib/codex-token-plan");
  const adapter = createCodexProviderAdapter({
    readAuthBundle: async () => ({
      accessToken: "local-access-token",
      accountId: "account-123",
      refreshToken: null,
      lastRefresh: new Date().toISOString(),
    }),
    fetchImpl: async (_url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(whamPayload),
      requestHeaders: init.headers,
    }),
  });

  const quota = await adapter({ detection_method: "official_account", provider_id: "codex" });
  assert.equal(quota.quota_windows.length, 2);
  assert.equal(quota.remaining_quota, 45);
});

test("codex provider adapter requests reauthentication when no local official login exists", async () => {
  const { createCodexProviderAdapter } = require("../src/lib/codex-token-plan");
  const adapter = createCodexProviderAdapter({
    readAuthBundle: async () => null,
  });

  await assert.rejects(
    () => adapter({ detection_method: "official_account", provider_id: "codex" }),
    (error) => error instanceof CodexTokenPlanError && error.code === "CODEX_REAUTH_REQUIRED",
  );
});
