"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const catalog = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../shared/plan-market-catalog.json"),
  "utf8",
));

test("Aliyun Coding Plan matches the current official Pro-only catalog", () => {
  const provider = catalog.providers.find((candidate) => candidate.id === "aliyun-bailian");
  assert.ok(provider, "Aliyun Bailian provider is missing");
  const plans = new Map(provider.plans.map((plan) => [plan.plan_id, plan]));

  assert.equal(plans.get("lite")?.status, "discontinued");
  assert.equal(plans.has("standard"), false);
  assert.deepEqual(plans.get("pro")?.price, {
    amount: 200,
    currency: "CNY",
    cycle: "monthly",
  });
  assert.deepEqual(plans.get("pro")?.alt_prices, [{
    amount: 39.9,
    currency: "CNY",
    cycle: "monthly",
    note: "新客首月特惠；后续按 ¥200/月续费",
  }]);
  assert.match(plans.get("pro")?.quota_summary || "", /5 小时 6,000 次请求/u);
  assert.match(plans.get("pro")?.quota_summary || "", /每周 45,000 次请求/u);
  assert.match(plans.get("pro")?.quota_summary || "", /每月 90,000 次请求/u);
  assert.equal(plans.get("pro")?.evidence?.link_id, "market-aliyun-bailian-help");
  assert.equal(plans.get("pro")?.evidence?.verified_at, "2026-08-30");
});
