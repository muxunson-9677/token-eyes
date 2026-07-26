const { parseIsoTimestamp, isEvidenceStale } = require("./data-freshness");

const SOURCE_KINDS = new Set([
  "official_api",
  "session_log",
  "sqlite",
  "hook",
  "otel",
  "cache",
  "estimated",
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
    source_kind: "estimated",
    accuracy: "estimated",
    coverage: coverageForPricing(input),
    observed_at: input?.observed_at,
    source_updated_at: input?.source_updated_at ?? null,
    stale_after_seconds: input?.stale_after_seconds ?? DEFAULT_EVIDENCE_STALE_AFTER_SECONDS,
    pricing_source: input?.pricing_source ?? null,
    pricing_version: input?.pricing_version ?? null,
    note_code: input?.note_code ?? null,
  }, options);
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
  coverageForPricing,
  decorateUsageLimitsWithEvidence,
};
