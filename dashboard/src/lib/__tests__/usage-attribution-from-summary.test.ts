import { describe, expect, it } from "vitest";
import { snapshotsFromProviderStats } from "../usage-attribution-from-summary";
import type { ProviderStat } from "../types/usage";

describe("snapshotsFromProviderStats", () => {
  it("maps provider rows into unknown-environment v2 snapshots", () => {
    const providers = [
      {
        source: "Claude",
        source_display_name: "Claude",
        request_count: 2,
        conversation_count: 2,
        tokens: 120,
        cost_usd: 0,
        success_rate: null,
        avg_latency_ms: null,
        metric_availability: "aggregate_only",
        priced_tokens: 120,
        unpriced_tokens: 0,
        pricing_coverage: "complete",
      },
    ] as ProviderStat[];

    const snapshots = snapshotsFromProviderStats(providers);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].dimensions.agent_id).toBe("claude");
    expect(snapshots[0].dimensions.environment_kind).toBe("unknown");
    expect(snapshots[0].tokens.total_tokens).toBe(120);
  });

  it("returns an empty array when providers are missing", () => {
    expect(snapshotsFromProviderStats(null)).toEqual([]);
  });
});
