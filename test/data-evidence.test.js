const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDataEvidence,
  decorateUsageLimitsWithEvidence,
  createPricingEvidence,
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
});
