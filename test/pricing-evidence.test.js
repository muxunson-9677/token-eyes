const { it } = require("node:test");
const assert = require("node:assert/strict");

const { computeRowCostDetailed, getPricingMetadata } = require("../src/lib/pricing");

it("reports the catalog source and version for a priced model", () => {
  const metadata = getPricingMetadata("gpt-4o", { source: "codex" });

  assert.equal(typeof metadata.pricing_source, "string");
  assert.equal(typeof metadata.pricing_version, "string");
});

it("keeps pricing metadata null for an unpriced model", () => {
  assert.deepEqual(getPricingMetadata("unknown-unpriced-model"), {
    pricing_source: null,
    pricing_version: null,
  });
});

it("reports an old user override as fresh, exact, non-estimated provenance", () => {
  const updatedAt = "2026-01-01T00:00:00.000Z";
  const observedAt = "2026-08-20T00:00:00.000Z";
  const detailed = computeRowCostDetailed({
    source: "custom-agent",
    model: "custom-model",
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    total_tokens: 2_000_000,
  }, {
    nowMs: Date.parse(observedAt),
    pricingRules: [{
      source: "custom-agent",
      model: "custom-model",
      inputPricePer1M: 1.5,
      outputPricePer1M: 10,
      currency: "USD",
      updated_at: updatedAt,
    }],
  });

  assert.equal(detailed.cost_usd, 11.5);
  assert.equal(detailed.source_kind, "user_override");
  assert.equal(detailed.source_updated_at, updatedAt);
  assert.equal(detailed.observed_at, observedAt);
  assert.equal(detailed.is_stale, false);
  assert.equal(detailed.estimated, false);
  assert.equal(detailed.match_kind, "exact");
  assert.equal(detailed.matched_model, "custom-model");
  assert.equal(detailed.source_url, null);
});
