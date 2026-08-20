"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  parseCursorUsageBody,
  CursorTokenPlanError,
  mapCursorErrorCode,
} = require("../src/lib/cursor-token-plan");

const summaryPayload = {
  membershipType: "pro",
  billingCycleEnd: "2026-08-01T00:00:00.000Z",
  individualUsage: {
    plan: {
      totalPercentUsed: 35,
      autoPercentUsed: 10,
      apiPercentUsed: 25,
    },
  },
};

test("parseCursorUsageBody maps billing cycle usage to independent percent lanes", () => {
  const result = parseCursorUsageBody(summaryPayload);
  assert.equal(result.quota_windows.length, 3);
  assert.equal(result.quota_windows[0].kind, "total");
  assert.equal(result.quota_windows[0].lane_id, "overall");
  assert.equal(result.quota_windows[0].unit, "percent");
  assert.equal(result.quota_windows[0].used, 35);
  assert.equal(result.quota_windows[0].remaining, 65);
  assert.deepEqual(result.quota_windows.slice(1).map((window) => window.lane_id), ["auto", "api"]);
  assert.equal(result.membership_type, "pro");
});

test("Task 8 Cursor catalog declares provider percentages rather than token counts", () => {
  const catalog = require("../src/lib/token-plan-catalog/cursor.catalog.json");
  assert.equal(catalog.plans.length > 0, true);
  assert.equal(catalog.plans.every((plan) => plan.quota.unit === "percent"), true);
});

test("Task 8 Cursor preserves fractional overall Auto and API lanes on the percent scale", () => {
  const result = parseCursorUsageBody({
    membershipType: "pro",
    billingCycleEnd: "2026-08-01T00:00:00.000Z",
    individualUsage: {
      plan: {
        totalPercentUsed: 33.52173913043478,
        autoPercentUsed: 27.82,
        apiPercentUsed: 71.53333333333333,
      },
    },
  });

  assert.deepEqual(
    result.quota_windows.map(({ lane_id, unit, total, used, percentage }) => ({
      lane_id,
      unit,
      total,
      used,
      percentage,
    })),
    [
      { lane_id: "overall", unit: "percent", total: 100, used: 33.52173913043478, percentage: 33.52173913043478 },
      { lane_id: "auto", unit: "percent", total: 100, used: 27.82, percentage: 27.82 },
      { lane_id: "api", unit: "percent", total: 100, used: 71.53333333333333, percentage: 71.53333333333333 },
    ],
  );
  assert.equal(result.used_quota, 33.52173913043478);
});

test("Task 8 Cursor keeps Auto and API independent and omits an invented headline", () => {
  const result = parseCursorUsageBody({
    membershipType: "pro",
    billingCycleEnd: "2026-08-01T00:00:00.000Z",
    individualUsage: {
      plan: {
        autoPercentUsed: 10.25,
        apiPercentUsed: 70.75,
      },
    },
  });

  assert.deepEqual(result.quota_windows.map((window) => window.lane_id), ["auto", "api"]);
  assert.deepEqual(result.quota_windows.map((window) => window.used), [10.25, 70.75]);
  assert.equal(Object.hasOwn(result, "total_quota"), false);
  assert.equal(Object.hasOwn(result, "used_quota"), false);
  assert.equal(Object.hasOwn(result, "remaining_quota"), false);
});

test("Task 8 Cursor treats empty semantic usage as absent instead of inventing an overall zero", () => {
  const result = parseCursorUsageBody({
    membershipType: "pro",
    individualUsage: {
      plan: {
        used: "",
        limit: 100,
        autoPercentUsed: 12.5,
        apiPercentUsed: 37.5,
      },
    },
  });

  assert.deepEqual(result.quota_windows.map((window) => window.lane_id), ["auto", "api"]);
  assert.equal(Object.hasOwn(result, "total_quota"), false);
  assert.equal(Object.hasOwn(result, "used_quota"), false);
  assert.equal(Object.hasOwn(result, "remaining_quota"), false);
});

test("Task 8 Cursor treats a whitespace provider overall as absent", () => {
  const result = parseCursorUsageBody({
    individualUsage: {
      plan: {
        totalPercentUsed: "   ",
        autoPercentUsed: 20,
      },
    },
  });

  assert.deepEqual(result.quota_windows.map((window) => window.lane_id), ["auto"]);
  assert.equal(Object.hasOwn(result, "total_quota"), false);
});

test("Task 8 Cursor keeps a team pool lane without inventing an overall headline", () => {
  const result = parseCursorUsageBody({
    membershipType: "team",
    limitType: "team",
    billingCycleEnd: "2026-08-01T00:00:00.000Z",
    individualUsage: { plan: { autoPercentUsed: 10 } },
    teamUsage: { onDemand: { used: 25, limit: 100 } },
  });

  assert.equal(result.quota_windows.find((window) => window.lane_id === "team_pool")?.used, 25);
  assert.equal(result.quota_windows.some((window) => window.lane_id === "overall"), false);
  assert.equal(Object.hasOwn(result, "total_quota"), false);
  assert.equal(Object.hasOwn(result, "used_quota"), false);
  assert.equal(Object.hasOwn(result, "remaining_quota"), false);
  assert.equal(Object.hasOwn(result, "quota_unit"), false);
});

test("parseCursorUsageBody rejects empty usage", () => {
  assert.throws(
    () => parseCursorUsageBody({ individualUsage: { plan: {} } }),
    (error) => error instanceof CursorTokenPlanError && error.code === "CURSOR_NO_QUOTA_WINDOWS",
  );
});

test("mapCursorErrorCode maps Cursor errors to sync statuses", () => {
  assert.equal(mapCursorErrorCode(new CursorTokenPlanError("CURSOR_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapCursorErrorCode(new CursorTokenPlanError("CURSOR_CONSOLE_SYNC_REQUIRED", "x")), "not_configured");
  assert.equal(mapCursorErrorCode(new CursorTokenPlanError("CURSOR_NO_QUOTA_WINDOWS", "x")), "unsupported");
});

test("cursor provider adapter skips local IDE when official_account detection is configured", async () => {
  const { createCursorProviderAdapter } = require("../src/lib/cursor-token-plan");
  const adapter = createCursorProviderAdapter();
  await assert.rejects(
    () => adapter({ detection_method: "official_account", provider_id: "cursor" }),
    (error) => error instanceof CursorTokenPlanError && error.code === "CURSOR_CONSOLE_SYNC_REQUIRED",
  );
});
