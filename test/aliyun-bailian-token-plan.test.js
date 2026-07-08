"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  parseAliyunBailianQuotaResponse,
  fetchAliyunBailianCodingPlanQuota,
  AliyunBailianTokenPlanError,
  mapAliyunBailianErrorCode,
} = require("../src/lib/aliyun-bailian-token-plan");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "aliyun-bailian-quota-response.json"), "utf8"),
);

test("parseAliyunBailianQuotaResponse maps 5-hour and weekly request windows", () => {
  const result = parseAliyunBailianQuotaResponse(fixture);
  assert.equal(result.plan_name, "Coding Plan Pro");
  assert.equal(result.total_quota, 45000);
  assert.equal(result.used_quota, 10000);
  assert.equal(result.remaining_quota, 35000);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[0].used, 1200);
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
});

test("fetchAliyunBailianCodingPlanQuota posts to Bailian console RPC with sk-sp key", async () => {
  const calls = [];
  const result = await fetchAliyunBailianCodingPlanQuota({
    apiKey: "sk-sp-test-bailian",
    regions: [{
      id: "cn",
      host: "https://bailian.console.aliyun.com",
      commodityCode: "sfm_codingplan_public_cn",
      currentRegionId: "cn-beijing",
      dashboardUrl: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/coding_plan",
    }],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fixture),
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /bailian\.console\.aliyun\.com\/data\/api\.json/);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-sp-test-bailian");
  assert.equal(result.remaining_quota, 35000);
});

test("fetchAliyunBailianCodingPlanQuota rejects non subscription keys", async () => {
  await assert.rejects(
    fetchAliyunBailianCodingPlanQuota({ apiKey: "sk-paygo-key" }),
    (error) => error.code === "BAILIAN_REAUTH_REQUIRED",
  );
});

test("fetchAliyunBailianCodingPlanQuota maps ConsoleNeedLogin without leaking the API key", async () => {
  await assert.rejects(
    fetchAliyunBailianCodingPlanQuota({
      apiKey: "sk-sp-secret",
      regions: [{
        id: "cn",
        host: "https://bailian.console.aliyun.com",
        commodityCode: "sfm_codingplan_public_cn",
        currentRegionId: "cn-beijing",
        dashboardUrl: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/coding_plan",
      }],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: "ConsoleNeedLogin", message: "please log in" }),
      }),
    }),
    (error) => error.code === "BAILIAN_CONSOLE_LOGIN_REQUIRED" && !error.message.includes("sk-sp-secret"),
  );
});

test("mapAliyunBailianErrorCode maps Bailian errors to sync statuses", () => {
  assert.equal(mapAliyunBailianErrorCode(new AliyunBailianTokenPlanError("BAILIAN_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapAliyunBailianErrorCode(new AliyunBailianTokenPlanError("BAILIAN_UNSUPPORTED", "x")), "unsupported");
});
