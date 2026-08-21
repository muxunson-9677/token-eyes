"use strict";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metric(value, unit, evidenceState) {
  return {
    value: finiteNumber(value),
    unit,
    evidence_state: evidenceState,
  };
}

function buildActualSpend(actualSpend = {}) {
  const subscriptionUsd = finiteNumber(actualSpend.subscriptionUsd);
  const officialApiUsd = finiteNumber(actualSpend.officialApiUsd);
  const otherAiUsd = finiteNumber(actualSpend.otherAiUsd);
  const values = [subscriptionUsd, officialApiUsd, otherAiUsd];
  const known = values.filter((value) => value !== null);
  const allKnown = known.length === values.length;
  const totalState = allKnown ? "exact" : known.length ? "partial" : "unsupported";

  return {
    subscription_usd: metric(subscriptionUsd, "USD", subscriptionUsd === null ? "unsupported" : "exact"),
    official_api_usd: metric(officialApiUsd, "USD", officialApiUsd === null ? "unsupported" : "exact"),
    other_ai_usd: metric(otherAiUsd, "USD", otherAiUsd === null ? "unsupported" : "exact"),
    total_usd: metric(known.length ? known.reduce((sum, value) => sum + value, 0) : null, "USD", totalState),
  };
}

function buildAttribution(records = []) {
  const linked = new Map();
  const unattributed = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const value = finiteNumber(record && record.apiEquivalentUsd);
    if (value === null) continue;
    const planRef = typeof record.plan_ref === "string" ? record.plan_ref.trim() : "";
    const accountRef = typeof record.account_ref === "string" ? record.account_ref.trim() : "";
    if (planRef && accountRef) {
      const key = `${planRef}\u0000${accountRef}`;
      const item = linked.get(key) || { plan_ref: planRef, account_ref: accountRef, api_equivalent_usd: 0 };
      item.api_equivalent_usd += value;
      linked.set(key, item);
      continue;
    }
    const source = typeof record.source === "string" && record.source.trim() ? record.source.trim() : "unknown";
    const item = unattributed.get(source) || { source, api_equivalent_usd: 0 };
    item.api_equivalent_usd += value;
    unattributed.set(source, item);
  }

  return {
    linked: Array.from(linked.values()),
    unattributed: Array.from(unattributed.values()),
  };
}

function buildNativeResources(nativeResources = []) {
  return (Array.isArray(nativeResources) ? nativeResources : [])
    .filter((resource) => resource && typeof resource.provider === "string" && typeof resource.unit === "string")
    .map((resource) => ({
      provider: resource.provider,
      value: finiteNumber(resource.value),
      unit: resource.unit,
    }));
}

function buildValueComparisonViewModel(input = {}) {
  const actualSpend = buildActualSpend(input.actualSpend);
  const usage = input.usage || {};
  const apiEquivalentUsd = finiteNumber(usage.apiEquivalentUsd);
  const apiEquivalentState = apiEquivalentUsd === null ? "unsupported" : "estimated";
  const multiple = actualSpend.total_usd.evidence_state === "exact"
    && actualSpend.total_usd.value > 0
    && apiEquivalentUsd !== null
    ? apiEquivalentUsd / actualSpend.total_usd.value
    : null;
  const multipleState = multiple === null
    ? actualSpend.total_usd.evidence_state === "partial" ? "partial" : "unsupported"
    : "estimated";
  const tokens = finiteNumber(usage.recognizedTokens);
  const coverage = finiteNumber(usage.pricingCoveragePercent);

  return {
    generated_at: typeof input.generatedAt === "string" ? input.generatedAt : null,
    range: typeof input.range === "string" ? input.range : "month",
    actual_spend: actualSpend,
    api_equivalent_value: metric(apiEquivalentUsd, "USD", apiEquivalentState),
    value_multiple: metric(multiple, "times", multipleState),
    recognized_tokens: metric(tokens, "tokens", tokens === null ? "unsupported" : "partial"),
    pricing_coverage_percent: metric(coverage, "percent", coverage === null ? "unsupported" : "partial"),
    attribution: buildAttribution(input.records),
    monthly_trend: Array.isArray(input.monthlyTrend) ? input.monthlyTrend : [],
    native_resources: buildNativeResources(input.nativeResources),
  };
}

module.exports = {
  buildValueComparisonViewModel,
};

