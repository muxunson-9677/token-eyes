const { it } = require("node:test");
const assert = require("node:assert/strict");

const { getPricingMetadata } = require("../src/lib/pricing");

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
