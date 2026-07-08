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

test("parseCursorUsageBody maps billing cycle usage to rolling_weekly", () => {
  const result = parseCursorUsageBody(summaryPayload);
  assert.equal(result.quota_windows.length, 1);
  assert.equal(result.quota_windows[0].kind, "rolling_weekly");
  assert.equal(result.quota_windows[0].used, 35);
  assert.equal(result.quota_windows[0].remaining, 65);
  assert.equal(result.membership_type, "pro");
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
