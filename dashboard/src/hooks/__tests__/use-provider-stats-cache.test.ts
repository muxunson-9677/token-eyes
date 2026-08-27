import { describe, expect, it } from "vitest";

import {
  buildProviderStatsStorageKey,
  createProviderStatsCacheEntry,
  isProviderStatsCachePayload,
  parseProviderStatsCacheEntry,
} from "../use-provider-stats";

function response(view: "range" | "recent_api_7d") {
  const recent = view === "recent_api_7d";
  return {
    ok: true,
    view,
    from: "2026-08-21",
    to: "2026-08-27",
    period: { from: "2026-08-21", to: "2026-08-27", days: 7, time_zone: "UTC" },
    totals_scope: recent
      ? "api_key_attributed_official_billed_cost_positive"
      : "all_provider_attributed",
    providers: [{
      provider_id: "deepseek",
      display_name: "DeepSeek",
      cost_basis: recent
        ? { authority: "official_invoice", accuracy: "exact" }
        : { authority: "local_list_price_estimate", accuracy: "estimated" },
      daily: [],
      request_count_basis: "unavailable",
      success_rate_sample_count: 0,
    }],
    totals: {},
  };
}

describe("Provider stats cache contract", () => {
  it("accepts only the current true-Provider DTO for the requested view", () => {
    expect(isProviderStatsCachePayload(response("range"), "range")).toBe(true);
    expect(isProviderStatsCachePayload(response("recent_api_7d"), "recent_api_7d")).toBe(true);
    expect(isProviderStatsCachePayload(response("range"), "recent_api_7d")).toBe(false);
  });

  it("rejects the legacy Agent-shaped Provider cache", () => {
    const legacy = response("range");
    legacy.providers = [{
      ...legacy.providers[0],
      source: "codex",
      source_display_name: "Codex",
    }];

    expect(isProviderStatsCachePayload(legacy, "range")).toBe(false);
  });

  it("isolates range and recent caches while keeping page dates out of the recent key", () => {
    const base = {
      cacheKey: "usage",
      baseUrl: "http://127.0.0.1:7680",
      timeZone: "UTC",
      tzOffsetMinutes: 0,
      filterCacheKey: "all|all|all",
      sources: ["codex"],
    };
    const range = buildProviderStatsStorageKey({
      ...base,
      view: "range",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    const recentA = buildProviderStatsStorageKey({
      ...base,
      view: "recent_api_7d",
      from: "2020-01-01",
      to: "2020-01-07",
      currentDayKey: "2026-08-27",
    });
    const recentB = buildProviderStatsStorageKey({
      ...base,
      view: "recent_api_7d",
      from: "2030-12-01",
      to: "2030-12-07",
      currentDayKey: "2026-08-27",
    });
    const recentNextDay = buildProviderStatsStorageKey({
      ...base,
      view: "recent_api_7d",
      currentDayKey: "2026-08-28",
    });

    expect(range).toContain("providerStats.v2.range");
    expect(recentA).toContain("providerStats.v2.recent_api_7d");
    expect(range).not.toBe(recentA);
    expect(recentA).toBe(recentB);
    expect(recentNextDay).not.toBe(recentA);
  });

  it("keeps cached recent usage on the same local day without persisting account or balance overlays", () => {
    const recent = response("recent_api_7d");
    recent.providers[0] = {
      ...recent.providers[0],
      account_label: "finance@example.com",
      account_ref: "provider-api:deepseek:main",
      balance: { amount: 88, currency: "CNY", observed_at: "2026-08-27T03:00:00.000Z" },
    };
    const entry = createProviderStatsCacheEntry(
      recent,
      "recent_api_7d",
      "2026-08-27T03:00:00.000Z",
    );

    expect(entry.providers.providers[0]).toMatchObject({
      account_label: null,
      account_ref: null,
      balance: null,
    });
    expect(parseProviderStatsCacheEntry(
      JSON.stringify(entry),
      "recent_api_7d",
      "2026-08-27",
    )).toEqual(entry);
  });

  it("rejects a previous-day recent cache and an entry without a valid fetch timestamp", () => {
    const entry = createProviderStatsCacheEntry(
      response("recent_api_7d"),
      "recent_api_7d",
      "2026-08-27T03:00:00.000Z",
    );

    expect(parseProviderStatsCacheEntry(
      JSON.stringify(entry),
      "recent_api_7d",
      "2026-08-28",
    )).toBeNull();
    expect(parseProviderStatsCacheEntry(
      JSON.stringify({ ...entry, fetchedAt: "not-a-date" }),
      "recent_api_7d",
      "2026-08-27",
    )).toBeNull();
  });
});
