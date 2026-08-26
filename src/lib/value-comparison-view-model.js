"use strict";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safePublicEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const safeRecordRefs = Array.isArray(value.safe_record_refs)
    ? value.safe_record_refs.filter((item) => typeof item === "string").slice(0, 12)
    : [];
  const pricing = value.pricing && typeof value.pricing === "object" && !Array.isArray(value.pricing)
    ? {
        state: typeof value.pricing.state === "string" ? value.pricing.state : "unavailable",
        model: typeof value.pricing.model === "string" ? value.pricing.model.slice(0, 120) : null,
        source_url: typeof value.pricing.source_url === "string" && value.pricing.source_url.startsWith("https://")
          ? value.pricing.source_url
          : null,
        version: typeof value.pricing.version === "string" ? value.pricing.version.slice(0, 120) : null,
      }
    : null;
  return {
    source_kind: typeof value.source_kind === "string" ? value.source_kind : "unavailable",
    record_count: Number.isInteger(value.record_count) && value.record_count >= 0 ? value.record_count : 0,
    observed_from: typeof value.observed_from === "string" ? value.observed_from : null,
    observed_to: typeof value.observed_to === "string" ? value.observed_to : null,
    safe_record_refs: safeRecordRefs,
    pricing,
  };
}

function metric(value, unit, evidenceState, evidence = null) {
  const result = {
    value: finiteNumber(value),
    unit,
    evidence_state: evidenceState,
  };
  const safeEvidence = safePublicEvidence(evidence);
  if (safeEvidence) result.evidence = safeEvidence;
  return result;
}

function buildActualSpend(actualSpend = {}, evidence = null) {
  const subscriptionUsd = finiteNumber(actualSpend.subscriptionUsd);
  const officialApiUsd = finiteNumber(actualSpend.officialApiUsd);
  const otherAiUsd = finiteNumber(actualSpend.otherAiUsd);
  const values = [subscriptionUsd, officialApiUsd, otherAiUsd];
  const known = values.filter((value) => value !== null);
  const allKnown = known.length === values.length;
  const totalState = allKnown ? "exact" : known.length ? "partial" : "unsupported";

  return {
    subscription_usd: metric(subscriptionUsd, "USD", subscriptionUsd === null ? "unsupported" : "exact", actualSpend.subscriptionEvidence || evidence),
    official_api_usd: metric(officialApiUsd, "USD", officialApiUsd === null ? "unsupported" : "exact", actualSpend.officialApiEvidence || evidence),
    other_ai_usd: metric(otherAiUsd, "USD", otherAiUsd === null ? "unsupported" : "exact", actualSpend.otherAiEvidence || evidence),
    total_usd: metric(known.length ? known.reduce((sum, value) => sum + value, 0) : null, "USD", totalState, evidence),
  };
}

function buildAttribution(records = []) {
  const linked = new Map();
  const unattributed = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const value = finiteNumber(record && record.apiEquivalentUsd);
    const actualSpend = finiteNumber(record && record.actualSpendUsd);
    const observedTokens = finiteNumber(record && record.observedTokens);
    const source = typeof record.source === "string" && record.source.trim() ? record.source.trim() : "unknown";
    const planRef = typeof record.plan_ref === "string" ? record.plan_ref.trim() : "";
    const accountRef = typeof record.account_ref === "string" ? record.account_ref.trim() : "";
    if (planRef && accountRef) {
      const key = `${planRef}\u0000${accountRef}`;
      const item = linked.get(key) || {
        source,
        plan_ref: planRef,
        account_ref: accountRef,
        plan_label: typeof record.plan_label === "string" ? record.plan_label.slice(0, 120) : null,
        association_state: ["configured_current_account", "configured_plan"].includes(record.association_state)
          ? record.association_state
          : "explicit_record",
        api_equivalent_usd: 0,
        has_value: false,
        actual_spend_usd: 0,
        has_actual_spend: false,
        observed_tokens: 0,
        has_observed_tokens: false,
        evidence: safePublicEvidence(record.evidence),
      };
      if (value !== null) {
        item.api_equivalent_usd += value;
        item.has_value = true;
      }
      if (actualSpend !== null) {
        item.actual_spend_usd += actualSpend;
        item.has_actual_spend = true;
      }
      if (observedTokens !== null) {
        item.observed_tokens += observedTokens;
        item.has_observed_tokens = true;
      }
      linked.set(key, item);
      continue;
    }
    const item = unattributed.get(source) || {
      source,
      association_state: "usage_detected",
      api_equivalent_usd: 0,
      has_value: false,
      actual_spend_usd: 0,
      has_actual_spend: false,
      observed_tokens: 0,
      has_observed_tokens: false,
      evidence: safePublicEvidence(record.evidence),
    };
    if (value !== null) {
      item.api_equivalent_usd += value;
      item.has_value = true;
    }
    if (actualSpend !== null) {
      item.actual_spend_usd += actualSpend;
      item.has_actual_spend = true;
    }
    if (observedTokens !== null) {
      item.observed_tokens += observedTokens;
      item.has_observed_tokens = true;
    }
    unattributed.set(source, item);
  }

  const publicItems = (items) => Array.from(items.values()).map(({ has_value: hasValue, has_actual_spend: hasActualSpend, has_observed_tokens: hasObservedTokens, observed_tokens: observedTokens, ...item }) => ({
    ...item,
    api_equivalent_usd: hasValue ? item.api_equivalent_usd : null,
    actual_spend_usd: hasActualSpend ? item.actual_spend_usd : null,
    ...(hasObservedTokens ? { observed_tokens: observedTokens } : {}),
  }));

  return {
    linked: publicItems(linked),
    unattributed: publicItems(unattributed),
  };
}

function buildNativeResources(nativeResources = []) {
  return (Array.isArray(nativeResources) ? nativeResources : [])
    .filter((resource) => resource && typeof resource.provider === "string" && typeof resource.unit === "string")
    .map((resource) => {
      const evidenceState = ["exact", "observed", "unavailable", "connected_no_exact_data"].includes(resource.evidence_state)
        ? resource.evidence_state
        : "connected_no_exact_data";
      return {
        provider: resource.provider,
        label: typeof resource.label === "string" ? resource.label.slice(0, 80) : null,
        value: finiteNumber(resource.value),
        unit: resource.unit,
        evidence_state: evidenceState,
      };
    });
}

function buildObservedUsage(observedUsage) {
  if (!observedUsage || typeof observedUsage !== "object" || Array.isArray(observedUsage)) return null;
  const value = finiteNumber(observedUsage.value);
  if (value === null || observedUsage.unit !== "tokens") return null;
  const evidenceState = ["exact", "observed", "partial"].includes(observedUsage.evidence_state)
    ? observedUsage.evidence_state
    : "observed";
  const result = {
    value,
    unit: "tokens",
    evidence_state: evidenceState,
  };
  const safeEvidence = safePublicEvidence(observedUsage.evidence);
  if (safeEvidence) result.evidence = safeEvidence;
  return result;
}

function buildComposition(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.key === "string")
    .map((item) => {
      const sourceMonth = typeof item.source_month === "string" && /^\d{4}-\d{2}$/u.test(item.source_month)
        ? item.source_month
        : null;
      const displayState = ["native_only", "usage_detected", "not_detected", "unreadable"].includes(item.display_state)
        ? item.display_state
        : null;
      const observedUsage = buildObservedUsage(item.observed_usage);
      return {
        key: item.key,
        value: finiteNumber(item.value),
        evidence_state: typeof item.evidence_state === "string" ? item.evidence_state : "unsupported",
        ...(sourceMonth ? { source_month: sourceMonth } : {}),
        ...(item.fallback_applied === true ? { fallback_applied: true } : {}),
        ...(displayState ? { display_state: displayState } : {}),
        ...(observedUsage ? { observed_usage: observedUsage } : {}),
        ...(Array.isArray(item.native_resources) ? { native_resources: buildNativeResources(item.native_resources) } : {}),
        ...(safePublicEvidence(item.evidence) ? { evidence: safePublicEvidence(item.evidence) } : {}),
      };
    });
}

function buildMonthlyTrend(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.bucket_start === "string")
    .map((item) => {
      const actualSpendUsd = finiteNumber(item.actual_spend_usd);
      const apiEquivalentUsd = finiteNumber(item.api_equivalent_usd);
      return {
        bucket_start: item.bucket_start,
        label: typeof item.label === "string" ? item.label : item.bucket_start.slice(5, 7),
        actual_spend_usd: actualSpendUsd,
        api_equivalent_usd: apiEquivalentUsd,
      };
    });
}

function buildValueComparisonViewModel(input = {}) {
  const actualSpend = buildActualSpend(input.actualSpend, input.actualSpendEvidence);
  const usage = input.usage || {};
  const apiEquivalentUsd = finiteNumber(usage.apiEquivalentUsd);
  const apiEquivalentState = apiEquivalentUsd === null ? "unsupported" : "estimated";
  const multiple = actualSpend.total_usd.value > 0
    && apiEquivalentUsd !== null
    ? apiEquivalentUsd / actualSpend.total_usd.value
    : null;
  const multipleState = multiple === null
    ? actualSpend.total_usd.evidence_state === "partial" ? "partial" : "unsupported"
    : actualSpend.total_usd.evidence_state === "partial" ? "partial" : "estimated";
  const tokens = finiteNumber(usage.recognizedTokens);
  const coverage = finiteNumber(usage.pricingCoveragePercent);

  return {
    generated_at: typeof input.generatedAt === "string" ? input.generatedAt : null,
    range: typeof input.range === "string" ? input.range : "month",
    requested_month: typeof input.requestedMonth === "string" ? input.requestedMonth : null,
    data_month: typeof input.dataMonth === "string" ? input.dataMonth : null,
    month_options: Array.isArray(input.monthOptions) ? input.monthOptions.filter((item) => /^\d{4}-\d{2}$/.test(item)).slice(0, 12) : [],
    available_months: Array.isArray(input.availableMonths) ? input.availableMonths.filter((item) => /^\d{4}-\d{2}$/.test(item)).slice(0, 12) : [],
    fallback_applied: input.fallbackApplied === true,
    actual_spend: actualSpend,
    api_equivalent_value: metric(apiEquivalentUsd, "USD", apiEquivalentState, input.usageEvidence),
    value_multiple: metric(multiple, "times", multipleState, input.usageEvidence),
    recognized_tokens: metric(tokens, "tokens", tokens === null ? "unsupported" : "partial", input.usageEvidence),
    pricing_coverage_percent: metric(coverage, "percent", coverage === null ? "unsupported" : "partial", input.usageEvidence),
    attribution: buildAttribution(input.records),
    actual_composition: buildComposition(input.actualComposition),
    value_composition: buildComposition(input.valueComposition),
    monthly_trend: buildMonthlyTrend(input.monthlyTrend),
    native_resources: buildNativeResources(input.nativeResources),
  };
}

module.exports = {
  buildValueComparisonViewModel,
};
