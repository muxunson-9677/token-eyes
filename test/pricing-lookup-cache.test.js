const { it } = require("node:test");
const assert = require("node:assert/strict");
const matcher = require("../src/lib/pricing/matcher");
const originalLookup = matcher.lookupPricing;
let lookups = 0;
matcher.lookupPricing = (...args) => {
  lookups += 1;
  return originalLookup(...args);
};
const { computeRowCostDetailed, resetPricingForTests, ensurePricingLoaded } = require("../src/lib/pricing");
const resolveModelPricing = (model, opts = {}) => computeRowCostDetailed({
  model, source: opts.source || "codex", input_tokens: 1_000_000, total_tokens: 1_000_000,
}, opts);

it("matches a repeated model once while retaining fresh observation timestamps", () => {
  resetPricingForTests();
  lookups = 0;
  const first = resolveModelPricing("gpt-4o", { source: "codex", nowMs: 1_000 });
  const second = resolveModelPricing("gpt-4o", { source: "codex", nowMs: 2_000 });
  assert.equal(lookups, 1);
  assert.equal(second.cost_usd, first.cost_usd);
  assert.notEqual(second.observed_at, first.observed_at);
  resolveModelPricing("gpt-4o", { source: "claude" });
  assert.equal(lookups, 2);
  resetPricingForTests();
  resolveModelPricing("gpt-4o", { source: "codex" });
  assert.equal(lookups, 3);
});

it("bounds cached misses instead of retaining every unknown model", () => {
  resetPricingForTests();
  lookups = 0;
  resolveModelPricing("unknown-qa-model");
  resolveModelPricing("unknown-qa-model");
  assert.equal(lookups, 1);
  for (let i = 0; i < 512; i += 1) resolveModelPricing(`unknown-qa-model-${i}`);
  resolveModelPricing("unknown-qa-model");
  assert.equal(lookups, 514);
});

it("invalidates a cached miss when the current catalog finishes loading", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(__dirname, "../.tmp/pricing-cache-regression-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  resetPricingForTests();
  lookups = 0;
  assert.equal(resolveModelPricing("qa-new-priced-model").cost_usd, null);
  await ensurePricingLoaded({
    cachePath: path.join(dir, "pricing.json"),
    fetchImpl: async () => ({ "qa-new-priced-model": { input_cost_per_token: 0.000003 } }),
  });
  assert.equal(resolveModelPricing("qa-new-priced-model").cost_usd, 3);
  assert.equal(lookups, 2);
});
