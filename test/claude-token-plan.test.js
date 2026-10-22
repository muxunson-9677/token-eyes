"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  parseClaudeUsageBody,
  isClaudeRoutingPlan,
  fetchClaudeQuota,
  ClaudeTokenPlanError,
  mapClaudeErrorCode,
} = require("../src/lib/claude-token-plan");

const usagePayload = {
  five_hour: { utilization: 0.25, resets_at: "2026-07-08T12:00:00.000Z" },
  seven_day: { utilization: 40, resets_at: "2026-07-12T00:00:00.000Z" },
};

test("parseClaudeUsageBody returns 5-hour and weekly utilization windows", () => {
  const result = parseClaudeUsageBody(usagePayload);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[0].used, 25);
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
  assert.equal(result.quota_windows[1].used, 40);
});

test("isClaudeRoutingPlan detects routing plan and mode", () => {
  assert.equal(isClaudeRoutingPlan({ plan_id: "claude_routing" }), true);
  assert.equal(isClaudeRoutingPlan({
    plan_id: "claude_pro",
    detection_config: { official_account: { claude_account_mode: "routing" } },
  }), true);
  assert.equal(isClaudeRoutingPlan({ plan_id: "claude_pro" }), false);
});

test("fetchClaudeQuota rejects routing mode without calling API", async () => {
  await assert.rejects(
    fetchClaudeQuota({
      plan: { plan_id: "claude_routing" },
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    }),
    (error) => error instanceof ClaudeTokenPlanError && error.code === "CLAUDE_ROUTING_MODE",
  );
});

test("mapClaudeErrorCode maps Claude errors to sync statuses", () => {
  assert.equal(mapClaudeErrorCode(new ClaudeTokenPlanError("CLAUDE_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapClaudeErrorCode(new ClaudeTokenPlanError("CLAUDE_CONSOLE_SYNC_REQUIRED", "x")), "not_configured");
  assert.equal(mapClaudeErrorCode(new ClaudeTokenPlanError("CLAUDE_ROUTING_MODE", "x")), "unsupported");
});

test("claude provider adapter skips CLI when official_account detection is configured", async () => {
  const { createClaudeProviderAdapter } = require("../src/lib/claude-token-plan");
  const adapter = createClaudeProviderAdapter();
  await assert.rejects(
    () => adapter({ detection_method: "official_account", provider_id: "claude", plan_id: "claude_pro" }),
    (error) => error instanceof ClaudeTokenPlanError && error.code === "CLAUDE_CONSOLE_SYNC_REQUIRED",
  );
});

test("missing or invalid utilization is not an exact zero quota", () => {
  for (const utilization of [null, undefined, "", "  ", false, {}, -1, 101]) {
    assert.throws(() => parseClaudeUsageBody({five_hour:{utilization}}), error => error.code === "CLAUDE_NO_QUOTA_WINDOWS");
  }
  assert.equal(parseClaudeUsageBody({five_hour:{utilization:0}}).used_quota, 0);
});

test("Claude utilization windows declare percentage units", () => {
 const result=parseClaudeUsageBody({seven_day:{utilization:50.5}});
 assert.equal(result.quota_unit,"percent");
 assert.equal(result.quota_windows[0].unit,"percent");
 assert.equal(result.used_quota,50.5);
});
