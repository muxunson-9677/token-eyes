const { parseIsoTimestamp, isEvidenceStale } = require("./data-freshness");

const SOURCE_KINDS = new Set([
  "official_api",
  "session_log",
  "sqlite",
  "hook",
  "otel",
  "cache",
  "curated",
  "estimated",
  "mixed",
  "third_party",
  "unpriced",
  "user_override",
]);
const ACCURACIES = new Set(["exact", "normalized", "estimated", "unknown"]);
const COVERAGES = new Set(["complete", "partial", "unavailable", "unpriced"]);
const DEFAULT_EVIDENCE_STALE_AFTER_SECONDS = 5 * 60;

function optionalString(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TypeError(`${fieldName} must be a string or null.`);
  return value;
}

function normalizeDataEvidence(input, { nowMs = Date.now() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("DataEvidenceV1 must be an object.");
  }
  if (!SOURCE_KINDS.has(input.source_kind)) throw new TypeError("Invalid DataEvidenceV1 source_kind.");
  if (!ACCURACIES.has(input.accuracy)) throw new TypeError("Invalid DataEvidenceV1 accuracy.");
  if (!COVERAGES.has(input.coverage)) throw new TypeError("Invalid DataEvidenceV1 coverage.");

  const staleAfterSeconds = Number(input.stale_after_seconds);
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 0) {
    throw new TypeError("stale_after_seconds must be a non-negative integer.");
  }

  const normalized = {
    source_kind: input.source_kind,
    accuracy: input.accuracy,
    coverage: input.coverage,
    observed_at: parseIsoTimestamp(input.observed_at, "observed_at"),
    source_updated_at: input.source_updated_at == null
      ? null
      : parseIsoTimestamp(input.source_updated_at, "source_updated_at"),
    stale_after_seconds: staleAfterSeconds,
    is_stale: false,
    pricing_source: optionalString(input.pricing_source, "pricing_source"),
    pricing_version: optionalString(input.pricing_version, "pricing_version"),
    source_url: optionalString(input.source_url, "source_url"),
    estimated: Boolean(input.estimated),
    match_kind: optionalString(input.match_kind, "match_kind"),
    matched_model: optionalString(input.matched_model, "matched_model"),
    components: Array.isArray(input.components)
      ? input.components.map((component) => ({ ...component }))
      : [],
    note_code: optionalString(input.note_code, "note_code"),
  };
  normalized.is_stale = isEvidenceStale(normalized, nowMs);
  return normalized;
}

function coverageForPricing({ priced_tokens: pricedTokens = 0, unpriced_tokens: unpricedTokens = 0 } = {}) {
  const priced = Number(pricedTokens) || 0;
  const unpriced = Number(unpricedTokens) || 0;
  if (unpriced > 0 && priced > 0) return "partial";
  if (unpriced > 0) return "unpriced";
  return "complete";
}

function createPricingEvidence(input, options = {}) {
  return normalizeDataEvidence({
    source_kind: input?.source_kind ?? "estimated",
    accuracy: input?.accuracy ?? (input?.estimated === false ? "exact" : "estimated"),
    coverage: coverageForPricing(input),
    observed_at: input?.observed_at,
    source_updated_at: input?.source_updated_at ?? null,
    stale_after_seconds: input?.stale_after_seconds ?? DEFAULT_EVIDENCE_STALE_AFTER_SECONDS,
    pricing_source: input?.pricing_source ?? null,
    pricing_version: input?.pricing_version ?? null,
    source_url: input?.source_url ?? null,
    estimated: input?.estimated ?? true,
    match_kind: input?.match_kind ?? null,
    matched_model: input?.matched_model ?? null,
    components: input?.components ?? [],
    note_code: input?.note_code ?? null,
  }, options);
}

function pricingProvenanceIdentity(record, sourceKind) {
  const stringOrNull = (value) => typeof value === "string" && value ? value : null;
  return JSON.stringify({
    source_kind: sourceKind,
    pricing_source: stringOrNull(record?.pricing_source),
    pricing_version: stringOrNull(record?.pricing_version),
    source_url: stringOrNull(record?.source_url),
    source_updated_at: stringOrNull(record?.source_updated_at),
    is_stale: Boolean(record?.is_stale),
    estimated: Boolean(record?.estimated),
    match_kind: stringOrNull(record?.match_kind),
    note_code: stringOrNull(record?.note_code),
  });
}

function summarizePricingProvenance(records) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const sourceKind = typeof record?.source_kind === "string" && record.source_kind
      ? record.source_kind
      : "unpriced";
    const identity = pricingProvenanceIdentity(record, sourceKind);
    let group = groups.get(identity);
    if (!group) {
      group = {
        identity,
        source_kind: sourceKind,
        record_count: 0,
        priced_tokens: 0,
        unpriced_tokens: 0,
        cost_usd: 0,
        has_cost: false,
        estimated: false,
        is_stale: false,
        pricing_sources: new Set(),
        pricing_versions: new Set(),
        source_urls: new Set(),
        source_updated_ats: new Set(),
        match_kinds: new Set(),
        matched_models: new Set(),
        note_codes: new Set(),
        observed_ats: new Set(),
      };
      groups.set(identity, group);
    }
    group.record_count += 1;
    group.priced_tokens += Number(record?.priced_tokens || 0);
    group.unpriced_tokens += Number(record?.unpriced_tokens || 0);
    if (record?.cost_usd !== null && record?.cost_usd !== undefined) {
      group.cost_usd += Number(record.cost_usd || 0);
      group.has_cost = true;
    }
    group.estimated ||= Boolean(record?.estimated);
    group.is_stale ||= Boolean(record?.is_stale);
    for (const [field, target] of [
      ["pricing_source", group.pricing_sources],
      ["pricing_version", group.pricing_versions],
      ["source_url", group.source_urls],
      ["source_updated_at", group.source_updated_ats],
      ["match_kind", group.match_kinds],
      ["matched_model", group.matched_models],
      ["note_code", group.note_codes],
      ["observed_at", group.observed_ats],
    ]) {
      if (typeof record?.[field] === "string" && record[field]) target.add(record[field]);
    }
  }

  const singleOrNull = (values) => values.size === 1 ? [...values][0] : null;
  const components = [...groups.values()]
    .sort((left, right) => (
      left.source_kind.localeCompare(right.source_kind)
      || left.identity.localeCompare(right.identity)
    ))
    .map((group) => ({
      source_kind: group.source_kind,
      record_count: group.record_count,
      priced_tokens: group.priced_tokens,
      unpriced_tokens: group.unpriced_tokens,
      cost_usd: group.has_cost ? Number(group.cost_usd.toFixed(6)) : null,
      estimated: group.estimated,
      is_stale: group.is_stale,
      pricing_source: singleOrNull(group.pricing_sources),
      pricing_version: singleOrNull(group.pricing_versions),
      source_url: singleOrNull(group.source_urls),
      source_updated_at: singleOrNull(group.source_updated_ats),
      match_kind: singleOrNull(group.match_kinds),
      matched_model: singleOrNull(group.matched_models),
      note_code: singleOrNull(group.note_codes),
      observed_at: singleOrNull(group.observed_ats),
    }));
  const mixed = components.length > 1;
  const only = components.length === 1 ? components[0] : null;
  const pricedTokens = components.reduce((sum, component) => sum + component.priced_tokens, 0);
  const unpricedTokens = components.reduce((sum, component) => sum + component.unpriced_tokens, 0);
  return {
    pricing_source: mixed ? "mixed" : only?.pricing_source ?? null,
    pricing_version: mixed ? null : only?.pricing_version ?? null,
    source_kind: mixed ? "mixed" : only?.source_kind ?? null,
    source_url: mixed ? null : only?.source_url ?? null,
    source_updated_at: mixed ? null : only?.source_updated_at ?? null,
    observed_at: mixed ? null : only?.observed_at ?? null,
    is_stale: components.some((component) => component.is_stale),
    estimated: components.some((component) => component.estimated),
    match_kind: mixed ? "mixed" : only?.match_kind ?? null,
    matched_model: mixed ? null : only?.matched_model ?? null,
    note_code: mixed ? "pricing_sources_mixed" : only?.note_code ?? null,
    pricing_coverage: coverageForPricing({
      priced_tokens: pricedTokens,
      unpriced_tokens: unpricedTokens,
    }),
    pricing_components: components,
  };
}

function isProviderEntry(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.hasOwn(value, "configured");
}

function decorateUsageLimitsWithEvidence(data, { nowMs = Date.now() } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const fetchedAt = parseIsoTimestamp(data.fetched_at || new Date(nowMs).toISOString(), "fetched_at");
  const out = { ...data };

  for (const [providerId, provider] of Object.entries(data)) {
    if (providerId === "fetched_at" || !isProviderEntry(provider)) continue;
    const cacheBacked = Boolean(provider.stale || provider.cached_at);
    const observedAt = cacheBacked && provider.cached_at
      ? parseIsoTimestamp(provider.cached_at, "cached_at")
      : fetchedAt;
    const unavailable = !provider.configured || Boolean(provider.error);
    const evidence = normalizeDataEvidence({
      source_kind: cacheBacked ? "cache" : "official_api",
      accuracy: unavailable ? "unknown" : "exact",
      coverage: unavailable ? "unavailable" : "complete",
      observed_at: observedAt,
      source_updated_at: cacheBacked ? observedAt : null,
      stale_after_seconds: provider.stale ? 0 : DEFAULT_EVIDENCE_STALE_AFTER_SECONDS,
      pricing_source: null,
      pricing_version: null,
      note_code: provider.stale ? "last_successful_value" : unavailable ? "source_unavailable" : null,
    }, { nowMs });
    out[providerId] = { ...provider, evidence };
  }
  return out;
}

module.exports = {
  SOURCE_KINDS,
  ACCURACIES,
  COVERAGES,
  DEFAULT_EVIDENCE_STALE_AFTER_SECONDS,
  normalizeDataEvidence,
  createPricingEvidence,
  summarizePricingProvenance,
  coverageForPricing,
  decorateUsageLimitsWithEvidence,
};
