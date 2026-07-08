import { describe, expectTypeOf, it } from "vitest";
import type {
  MetricAvailability,
  PricingCoverage,
  ProviderStat,
  RequestUsageRecordsResponse,
  UsageRecord,
} from "../usage";

describe("TICKET-06 truthful usage metrics contract", () => {
  it("PricingCoverage type exists", () => {
    const coverage: PricingCoverage = "partial";
    expectTypeOf(coverage).toBeString();
    expectTypeOf<"complete" | "partial" | "unpriced">().toMatchTypeOf<PricingCoverage>();
  });

  it("MetricAvailability type exists", () => {
    const availability: MetricAvailability = "measured";
    expectTypeOf(availability).toBeString();
    expectTypeOf<"measured" | "aggregate_only" | "unavailable">().toMatchTypeOf<MetricAvailability>();
  });

  it("UsageRecord supports record_kind and nullable metrics", () => {
    const rolloutRecord: UsageRecord = {
      id: "codex:session:1",
      record_kind: "request_event",
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
      pricing_coverage: "unpriced",
      status: null,
      latency_ms: null,
      first_token_ms: null,
      request_source: "codex_rollout",
    };
    expectTypeOf(rolloutRecord.record_kind).toBeString();
    expectTypeOf(rolloutRecord.status).toBeNullable();
    expectTypeOf(rolloutRecord.latency_ms).toBeNullable();
    expectTypeOf(rolloutRecord.pricing_coverage).toBeString();
  });

  it("ProviderStat supports aggregate_only metrics", () => {
    const aggregateProvider: ProviderStat = {
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
    expectTypeOf(aggregateProvider.request_count).toBeNullable();
    expectTypeOf(aggregateProvider.success_rate).toBeNullable();
    expectTypeOf(aggregateProvider.avg_latency_ms).toBeNullable();
    expectTypeOf(aggregateProvider.conversation_count).toBeNumber();
    expectTypeOf(aggregateProvider.metric_availability).toBeString();
  });

  it("RequestUsageRecordsResponse includes granularity, availability, page, and aggregate_only_sources", () => {
    const response: RequestUsageRecordsResponse = {
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
      page: { limit: 100, returned_count: 1, total_count: 5, totals_scope: "all_matching" },
      availability: {
        request_records: "measured",
        status: "unavailable",
        latency: "unavailable",
      },
    };
    expectTypeOf(response.granularity).toBeString();
    expectTypeOf(response.aggregate_only_sources).toBeArray();
    expectTypeOf(response.page).toHaveProperty("limit").toBeNumber();
    expectTypeOf(response.page).toHaveProperty("total_count").toBeNumber();
    expectTypeOf(response.page).toHaveProperty("totals_scope").toBeString();
    expectTypeOf(response.availability).toHaveProperty("request_records").toBeString();
    expectTypeOf(response.availability).toHaveProperty("status").toBeString();
    expectTypeOf(response.availability).toHaveProperty("latency").toBeString();
  });
});