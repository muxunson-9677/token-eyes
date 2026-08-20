const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDataEvidence,
  decorateUsageLimitsWithEvidence,
  createPricingEvidence,
  summarizePricingProvenance,
} = require("../src/lib/data-evidence");

const OBSERVED_AT = "2026-07-26T00:00:00.000Z";

describe("DataEvidenceV1", () => {
  it("marks evidence stale exactly at the stale_after_seconds boundary", () => {
    const evidence = normalizeDataEvidence({
      source_kind: "official_api",
      accuracy: "exact",
      coverage: "complete",
      observed_at: OBSERVED_AT,
      source_updated_at: null,
      stale_after_seconds: 60,
    }, { nowMs: Date.parse("2026-07-26T00:01:00.000Z") });

    assert.equal(evidence.is_stale, true);
  });

  it("preserves valid source timestamps on either side of observed_at", () => {
    const earlier = normalizeDataEvidence({
      source_kind: "session_log",
      accuracy: "normalized",
      coverage: "partial",
      observed_at: OBSERVED_AT,
      source_updated_at: "2026-07-25T23:59:00.000Z",
      stale_after_seconds: 120,
    }, { nowMs: Date.parse("2026-07-26T00:00:01.000Z") });
    const later = normalizeDataEvidence({
      ...earlier,
      source_updated_at: "2026-07-26T00:02:00.000Z",
    }, { nowMs: Date.parse("2026-07-26T00:00:01.000Z") });

    assert.equal(earlier.source_updated_at, "2026-07-25T23:59:00.000Z");
    assert.equal(later.source_updated_at, "2026-07-26T00:02:00.000Z");
    assert.throws(() => normalizeDataEvidence({ ...later, source_updated_at: "not-a-date" }));
  });

  it("adds cache, official, and unavailable evidence without removing legacy limit fields", () => {
    const decorated = decorateUsageLimitsWithEvidence({
      fetched_at: "2026-07-26T00:20:00.000Z",
      claude: { configured: true, stale: true, cached_at: OBSERVED_AT, five_hour: { utilization: 12 } },
      codex: { configured: true, error: null, primary_window: { used_percent: 25 } },
      cursor: { configured: false },
    }, { nowMs: Date.parse("2026-07-26T00:20:00.000Z") });

    assert.equal(decorated.claude.five_hour.utilization, 12);
    assert.equal(decorated.claude.evidence.source_kind, "cache");
    assert.equal(decorated.claude.evidence.is_stale, true);
    assert.equal(decorated.codex.evidence.source_kind, "official_api");
    assert.equal(decorated.codex.evidence.coverage, "complete");
    assert.equal(decorated.cursor.evidence.accuracy, "unknown");
    assert.equal(decorated.cursor.evidence.coverage, "unavailable");
  });

  it("marks partially priced token totals as partial instead of a zero-dollar result", () => {
    const evidence = createPricingEvidence({
      observed_at: OBSERVED_AT,
      priced_tokens: 80,
      unpriced_tokens: 20,
      pricing_source: "curated-overrides",
      pricing_version: "2026-07-26",
    }, { nowMs: Date.parse("2026-07-26T00:00:01.000Z") });

    assert.equal(evidence.accuracy, "estimated");
    assert.equal(evidence.coverage, "partial");
    assert.equal(evidence.pricing_source, "curated-overrides");
  });

  it("preserves mixed pricing provenance and its component composition", () => {
    const components = [
      { source_kind: "user_override", priced_tokens: 80 },
      { source_kind: "curated", priced_tokens: 20 },
    ];
    const evidence = createPricingEvidence({
      source_kind: "mixed",
      observed_at: OBSERVED_AT,
      priced_tokens: 100,
      unpriced_tokens: 0,
      pricing_source: "mixed",
      components,
    }, { nowMs: Date.parse("2026-07-26T00:00:01.000Z") });

    assert.equal(evidence.source_kind, "mixed");
    assert.deepEqual(evidence.components, components);
  });

  it("keeps materially different same-kind pricing evidence mixed", () => {
    const summary = summarizePricingProvenance([
      {
        source_kind: "third_party",
        pricing_source: "litellm:exact",
        pricing_version: "2026-07-20T00:00:00.000Z",
        source_url: "https://example.test/pricing.json",
        source_updated_at: "2026-07-20T00:00:00.000Z",
        observed_at: "2026-08-19T00:00:00.000Z",
        is_stale: false,
        estimated: false,
        match_kind: "exact",
        matched_model: "model-a",
        priced_tokens: 100,
        unpriced_tokens: 0,
        cost_usd: 0.1,
      },
      {
        source_kind: "third_party",
        pricing_source: "litellm:exact",
        pricing_version: "2026-07-20T00:00:00.000Z",
        source_url: "https://example.test/pricing.json",
        source_updated_at: "2026-07-20T00:00:00.000Z",
        observed_at: "2026-08-20T00:00:00.000Z",
        is_stale: true,
        estimated: true,
        match_kind: "inferred",
        matched_model: "model-a",
        priced_tokens: 0,
        unpriced_tokens: 200,
        cost_usd: null,
      },
    ]);

    assert.equal(summary.source_kind, "mixed");
    assert.equal(summary.pricing_source, "mixed");
    assert.equal(summary.match_kind, "mixed");
    assert.equal(summary.is_stale, true);
    assert.equal(summary.estimated, true);
    assert.equal(summary.pricing_components.length, 2);
  });

  it("does not call identical provenance mixed only because rows were observed at different times", () => {
    const common = {
      source_kind: "user_override",
      pricing_source: "pricing-rule",
      pricing_version: "2026-08-01T00:00:00.000Z",
      source_updated_at: "2026-08-01T00:00:00.000Z",
      is_stale: false,
      estimated: false,
      match_kind: "exact",
      matched_model: "custom-model",
      priced_tokens: 100,
      unpriced_tokens: 0,
      cost_usd: 0.1,
    };
    const summary = summarizePricingProvenance([
      { ...common, observed_at: "2026-08-19T00:00:00.000Z" },
      { ...common, observed_at: "2026-08-20T00:00:00.000Z" },
    ]);

    assert.equal(summary.source_kind, "user_override");
    assert.equal(summary.pricing_components.length, 1);
    assert.equal(summary.observed_at, null);
  });
});
