"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  parseKimiBalanceResponse,
  parseKimiUsageBody,
  fetchKimiBalance,
  fetchKimiCodeQuota,
  KimiTokenPlanError,
  mapKimiErrorCode,
} = require("../src/lib/kimi-token-plan");

const usagePayload = {
  usage: {
    limit: "1000",
    used: "250",
    remaining: "750",
    resetTime: "2026-05-04T06:02:56.054721Z",
  },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: {
        limit: "200",
        used: "40",
        remaining: "160",
        resetTime: "2026-05-02T05:02:56.054721Z",
      },
    },
  ],
};

test("parseKimiUsageBody maps weekly and 5-hour Kimi Code windows", () => {
  const result = parseKimiUsageBody(usagePayload);
  assert.equal(result.total_quota, 1000);
  assert.equal(result.used_quota, 250);
  assert.equal(result.remaining_quota, 750);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
});

test("parseKimiBalanceResponse maps available balance to CNY remaining quota", () => {
  const result = parseKimiBalanceResponse({
    code: 0,
    status: true,
    data: {
      available_balance: 49.58894,
      voucher_balance: 46.58893,
      cash_balance: 3.00001,
    },
  });
  assert.equal(result.remaining_quota, 4959);
  assert.equal(result.balance.available_balance, 49.58894);
  assert.equal(result.balance.currency, "CNY");
});

test("fetchKimiBalance sends Bearer auth to the official Moonshot balance endpoint", async () => {
  const calls = [];
  const result = await fetchKimiBalance({
    apiKey: "sk-kimi-test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: true,
          data: { available_balance: 10, voucher_balance: 5, cash_balance: 5 },
        }),
      };
    },
  });
  assert.equal(calls[0].url, "https://api.moonshot.cn/v1/users/me/balance");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-kimi-test");
  assert.equal(result.remaining_quota, 1000);
});

test("fetchKimiBalance maps auth errors without including the API key", async () => {
  await assert.rejects(
    fetchKimiBalance({
      apiKey: "sk-secret-kimi",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ status: false }),
      }),
    }),
    (error) => error.code === "KIMI_REAUTH_REQUIRED" && !error.message.includes("sk-secret-kimi"),
  );
});

test("fetchKimiCodeQuota maps usages fixture with injected credentials", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kimi-token-plan-"));
  try {
    fs.mkdirSync(path.join(tmp, "credentials"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "config.toml"), 'default_model = "kimi-code/kimi-for-coding"\n');
    const result = await fetchKimiCodeQuota({
      env: { KIMI_HOME: tmp },
      loadCredentials: () => ({
        access_token: "token",
        refresh_token: "refresh",
        expires_at: Date.now() / 1000 + 3600,
      }),
      fetchImpl: async (url) => {
        if (url.includes("/usages")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(usagePayload),
          };
        }
        throw new Error(`unexpected url ${url}`);
      },
    });
    assert.equal(result.remaining_quota, 750);
    assert.equal(result.quota_windows[0].total, 200);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("mapKimiErrorCode maps Kimi errors to sync statuses", () => {
  assert.equal(mapKimiErrorCode(new KimiTokenPlanError("KIMI_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapKimiErrorCode(new KimiTokenPlanError("KIMI_CONSOLE_SYNC_REQUIRED", "x")), "not_configured");
  assert.equal(mapKimiErrorCode(new KimiTokenPlanError("KIMI_RESPONSE_STRUCTURE_DRIFT", "x")), "unsupported");
});

test("kimi provider adapter skips CLI when Kimi Code official_account detection is configured", async () => {
  const { createKimiProviderAdapter } = require("../src/lib/kimi-token-plan");
  const adapter = createKimiProviderAdapter();
  await assert.rejects(
    () => adapter({ detection_method: "official_account", provider_id: "kimi", plan_id: "kimi_code_manual_quota" }),
    (error) => error instanceof KimiTokenPlanError && error.code === "KIMI_CONSOLE_SYNC_REQUIRED",
  );
});
