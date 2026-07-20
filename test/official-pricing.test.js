const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  inferOfficialPricingSource,
  parseOfficialPricingPage,
  verifyOfficialModelPricing,
} = require("../src/lib/official-pricing");

describe("official model pricing", () => {
  it("routes known model families only to allowlisted official domains", () => {
    assert.equal(inferOfficialPricingSource({ model: "gpt-5", modelId: "gpt-5" }).url, "https://developers.openai.com/api/docs/models/gpt-5");
    assert.equal(inferOfficialPricingSource({ model: "Claude Sonnet 4.6" }).hostname, "docs.anthropic.com");
    assert.equal(inferOfficialPricingSource({ model: "unknown-local-model" }), null);
  });

  it("extracts input, cached input and output rates from official page text", () => {
    const result = parseOfficialPricingPage(`
      GPT-5 gpt-5 Text tokens Per 1M tokens
      Input $1.25 Cached input $0.125 Output $10.00
    `, { model: "GPT-5", modelId: "gpt-5", currency: "USD" });

    assert.deepEqual(result, {
      input: 1.25,
      output: 10,
      cacheRead: 0.125,
      cacheWrite: null,
      currency: "USD",
    });
  });

  it("skips early metadata anchors and finds the later official pricing block", () => {
    const result = parseOfficialPricingPage(`
      GPT-5 model documentation ${"metadata ".repeat(1600)}
      GPT-5 Text tokens Per 1M tokens
      Input $1.25 Cached input $0.125 Output $10.00
    `, { model: "GPT-5", modelId: "gpt-5", currency: "USD" });

    assert.deepEqual(result, {
      input: 1.25,
      output: 10,
      cacheRead: 0.125,
      cacheWrite: null,
      currency: "USD",
    });
  });

  it("does not treat unrelated numbers without currency symbols as official prices", () => {
    const result = parseOfficialPricingPage(`
      GPT-5 Input tokens 5 Output tokens 10 Cached input 2
    `, { model: "GPT-5", modelId: "gpt-5", currency: "USD" });

    assert.equal(result, null);
  });

  it("returns a manual fallback instead of guessing when an official page cannot be parsed", async () => {
    const result = await verifyOfficialModelPricing(
      { model: "gpt-5", model_id: "gpt-5", source: "codex" },
      { fetchImpl: async () => ({ ok: true, status: 200, text: async () => "GPT-5 pricing unavailable" }) },
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, "manual_required");
    assert.equal(result.source_url, "https://developers.openai.com/api/docs/models/gpt-5");
  });
});
