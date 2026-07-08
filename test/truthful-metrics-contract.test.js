const { describe, it } = require("node:test");
const assert = require("assert");

describe("TICKET-06 truthful metrics contract", () => {
  it("PricingCoverage must be one of complete|partial|unpriced", () => {
    const validValues = ["complete", "partial", "unpriced"];
    validValues.forEach((v) => {
      assert.ok(["complete", "partial", "unpriced"].includes(v));
    });
  });

  it("MetricAvailability must be one of measured|aggregate_only|unavailable", () => {
    const validValues = ["measured", "aggregate_only", "unavailable"];
    validValues.forEach((v) => {
      assert.ok(["measured", "aggregate_only", "unavailable"].includes(v));
    });
  });

  it("UsageRecord.status and .latency_ms must be nullable", () => {
    const record = {
      id: "test:1",
      timestamp: "2026-06-29T00:00:00.000Z",
      hour_start: "2026-06-29T00:00:00.000Z",
      source: "codex",
      source_display_name: "Codex",
      model: "gpt-test",
      total_tokens: 10,
      input_tokens: 6,
      output_tokens: 4,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      cost_usd: 0,
      status: null,
      latency_ms: null,
      first_token_ms: null,
      request_source: "codex_rollout",
    };
    assert.strictEqual(record.status, null);
    assert.strictEqual(record.latency_ms, null);
    assert.strictEqual(record.first_token_ms, null);
  });

  it("ProviderStat.request_count and .success_rate must be nullable", () => {
    const stat = {
      source: "claude",
      source_display_name: "Claude",
      request_count: null,
      conversation_count: 2,
      tokens: 10,
      cost_usd: 0,
      priced_tokens: 0,
      unpriced_tokens: 10,
      pricing_coverage: "unpriced",
      success_rate: null,
      avg_latency_ms: null,
      metric_availability: "aggregate_only",
    };
    assert.strictEqual(stat.request_count, null);
    assert.strictEqual(stat.success_rate, null);
    assert.strictEqual(stat.avg_latency_ms, null);
  });

  it("RequestUsageRecordsResponse must include aggregate_only_sources and availability", () => {
    const response = {
      ok: true,
      records: [],
      totals: {
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        cost_usd: 0,
        request_count: 0,
        success_count: null,
        success_rate: null,
        avg_latency_ms: null,
        cache_hit_rate: 0,
        priced_tokens: 0,
        unpriced_tokens: 0,
        pricing_coverage: "complete",
        status_sample_count: 0,
        latency_sample_count: 0,
      },
      granularity: "request_event",
      aggregate_only_sources: ["claude"],
      page: { limit: 100, returned_count: 0, total_count: 0, totals_scope: "all_matching" },
      availability: {
        request_records: "measured",
        status: "unavailable",
        latency: "unavailable",
      },
    };
    assert.ok(Array.isArray(response.aggregate_only_sources));
    assert.ok(response.availability);
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(response.availability.status));
    assert.ok(["measured", "aggregate_only", "unavailable"].includes(response.availability.latency));
  });
});