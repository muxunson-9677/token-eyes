"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildValueComparisonViewModel } = require("../src/lib/value-comparison-view-model");

test("keeps unknown actual spend unknown and never turns it into zero", () => {
  const result = buildValueComparisonViewModel({
    generatedAt: "2026-08-21T08:00:00.000Z",
    range: "month",
    actualSpend: {
      subscriptionUsd: 8,
      officialApiUsd: null,
      otherAiUsd: null,
    },
    usage: { apiEquivalentUsd: 20, recognizedTokens: 1000000, pricingCoveragePercent: 80 },
  });

  assert.equal(result.actual_spend.total_usd.value, 8);
  assert.equal(result.actual_spend.total_usd.evidence_state, "partial");
  assert.equal(result.value_multiple.value, null);
  assert.equal(result.value_multiple.evidence_state, "partial");
});

test("keeps actual spend and API-equivalent value as separate semantics", () => {
  const result = buildValueComparisonViewModel({
    generatedAt: "2026-08-21T08:00:00.000Z",
    range: "month",
    actualSpend: { subscriptionUsd: 8, officialApiUsd: 2, otherAiUsd: 0 },
    usage: { apiEquivalentUsd: 20, recognizedTokens: 1000000, pricingCoveragePercent: 80 },
  });

  assert.deepEqual(result.actual_spend.total_usd, {
    value: 10,
    unit: "USD",
    evidence_state: "exact",
  });
  assert.equal(result.api_equivalent_value.value, 20);
  assert.equal(result.api_equivalent_value.evidence_state, "estimated");
  assert.equal(result.value_multiple.value, 2);
});

test("attributes plan value only when an explicit plan reference exists", () => {
  const result = buildValueComparisonViewModel({
    generatedAt: "2026-08-21T08:00:00.000Z",
    range: "month",
    actualSpend: {},
    usage: {},
    records: [
      { source: "codex", plan_ref: "codex-plus", account_ref: "acct-a", apiEquivalentUsd: 12 },
      { source: "claude", account_ref: "acct-b", apiEquivalentUsd: 9 },
    ],
  });

  assert.deepEqual(result.attribution.linked, [{
    plan_ref: "codex-plus",
    account_ref: "acct-a",
    api_equivalent_usd: 12,
  }]);
  assert.deepEqual(result.attribution.unattributed, [{
    source: "claude",
    api_equivalent_usd: 9,
  }]);
});

test("does not fold native quota units into token or dollar totals", () => {
  const result = buildValueComparisonViewModel({
    generatedAt: "2026-08-21T08:00:00.000Z",
    range: "month",
    actualSpend: {},
    usage: { recognizedTokens: 100 },
    nativeResources: [{ provider: "WorkBuddy", value: 2300, unit: "credits" }],
  });

  assert.equal(result.recognized_tokens.value, 100);
  assert.deepEqual(result.native_resources, [{ provider: "WorkBuddy", value: 2300, unit: "credits" }]);
});

test("keeps separate real composition and six-month series for the visual report", () => {
  const result = buildValueComparisonViewModel({
    actualSpend: { subscriptionUsd: 8, officialApiUsd: null, otherAiUsd: 2 },
    usage: { apiEquivalentUsd: 20, recognizedTokens: 100, pricingCoveragePercent: 75 },
    actualComposition: [
      { key: "subscription", value: 8, evidence_state: "exact" },
      { key: "other_ai", value: 2, evidence_state: "exact" },
    ],
    valueComposition: [
      { key: "api_key", value: 12, evidence_state: "estimated" },
      { key: "token_plan", value: 8, evidence_state: "estimated" },
    ],
    monthlyTrend: [{ bucket_start: "2026-08-01", label: "8月", actual_spend_usd: 10, api_equivalent_usd: 20 }],
  });

  assert.deepEqual(result.actual_composition, [
    { key: "subscription", value: 8, evidence_state: "exact" },
    { key: "other_ai", value: 2, evidence_state: "exact" },
  ]);
  assert.equal(result.value_composition[1].key, "token_plan");
  assert.equal(result.monthly_trend[0].label, "8月");
});
