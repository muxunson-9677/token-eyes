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
  assert.equal(result.value_multiple.value, 2.5);
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
    source: "codex",
    plan_ref: "codex-plus",
    account_ref: "acct-a",
    plan_label: null,
    association_state: "explicit_record",
    api_equivalent_usd: 12,
    actual_spend_usd: null,
    evidence: null,
  }]);
  assert.deepEqual(result.attribution.unattributed, [{
    source: "claude",
    association_state: "usage_detected",
    api_equivalent_usd: 9,
    actual_spend_usd: null,
    evidence: null,
  }]);
});

test("unlinked providers with readable usage are labelled as detected usage, not as disconnected agents", () => {
  const result = buildValueComparisonViewModel({
    records: [
      { source: "claude", apiEquivalentUsd: 9 },
      { source: "hermes", apiEquivalentUsd: null },
    ],
  });

  assert.equal(result.attribution.unattributed[0].association_state, "usage_detected");
  assert.equal(result.attribution.unattributed[1].association_state, "usage_detected");
});

test("keeps observed Token totals on linked and unmatched source rows", () => {
  const result = buildValueComparisonViewModel({
    records: [
      {
        source: "codex",
        plan_ref: "codex-plus",
        account_ref: "acct-a",
        observedTokens: 1_100,
        apiEquivalentUsd: 9,
      },
      { source: "claude", observedTokens: 2_200, apiEquivalentUsd: 4 },
    ],
  });

  assert.equal(result.attribution.linked[0].observed_tokens, 1_100);
  assert.equal(result.attribution.unattributed[0].observed_tokens, 2_200);
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
  assert.deepEqual(result.native_resources, [{
    provider: "WorkBuddy",
    label: null,
    value: 2300,
    unit: "credits",
    evidence_state: "connected_no_exact_data",
  }]);
});

test("keeps an unreadable native resource distinct from a real zero", () => {
  const result = buildValueComparisonViewModel({
    actualSpend: {},
    usage: {},
    nativeResources: [{ provider: "WorkBuddy", label: "Credits", value: null, unit: "Credits", evidence_state: "unavailable" }],
  });

  assert.deepEqual(result.native_resources, [{
    provider: "WorkBuddy",
    label: "Credits",
    value: null,
    unit: "Credits",
    evidence_state: "unavailable",
  }]);
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

test("preserves observed API Token usage without turning it into cash spend", () => {
  const result = buildValueComparisonViewModel({
    actualSpend: { subscriptionUsd: 8, officialApiUsd: null, otherAiUsd: 2 },
    usage: { apiEquivalentUsd: 20, recognizedTokens: 12_345, pricingCoveragePercent: 75 },
    actualComposition: [{
      key: "official_api",
      value: null,
      evidence_state: "observed",
      display_state: "usage_detected",
      observed_usage: {
        value: 12_345,
        unit: "tokens",
        evidence_state: "observed",
        evidence: { source_kind: "local_usage_ledger", record_count: 2 },
      },
    }],
  });

  const officialApi = result.actual_composition.find((row) => row.key === "official_api");
  assert.equal(officialApi.value, null, "observed Token usage is not an actual cash bill");
  assert.deepEqual(officialApi.observed_usage, {
    value: 12_345,
    unit: "tokens",
    evidence_state: "observed",
    evidence: {
      source_kind: "local_usage_ledger",
      record_count: 2,
      observed_from: null,
      observed_to: null,
      safe_record_refs: [],
      pricing: null,
    },
  });
});
