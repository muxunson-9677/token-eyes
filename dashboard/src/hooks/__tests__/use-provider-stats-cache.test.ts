import { describe, expect, it } from "vitest";

import {
  buildProviderStatsStorageKey,
  createProviderStatsCacheEntry,
  isProviderStatsCachePayload,
  parseProviderStatsCacheEntry,
  resolveProviderStatsDayKey,
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
      ? "api_key_attributed_activity_with_official_cost_when_available"
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
  it("keys an unbounded fallback view by the selected local day", () => {
    const instant = new Date("2026-08-27T17:22:00.000Z");

    expect(resolveProviderStatsDayKey({
      view: "recent_api_7d",
      timeZone: "Asia/Shanghai",
      offsetMinutes: 480,
      date: instant,
    })).toBe("2026-08-28");
    expect(resolveProviderStatsDayKey({
      view: "range",
      timeZone: "Asia/Shanghai",
      offsetMinutes: 480,
      date: instant,
    })).toBe("2026-08-28");
  });

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

  it("isolates range and API activity caches by selected page dates", () => {
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
    expect(recentA).not.toBe(recentB);
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

  it("accepts an API activity provider whose official cost is unavailable", () => {
    const recent = response("recent_api_7d");
    recent.providers[0] = {
      ...recent.providers[0],
      cost_basis: null,
    };

    expect(isProviderStatsCachePayload(recent, "recent_api_7d")).toBe(true);
  });

  it("accepts only a cache matching the selected API activity range", () => {
    const entry = createProviderStatsCacheEntry(
      response("recent_api_7d"),
      "recent_api_7d",
      "2026-08-27T03:00:00.000Z",
    );

    expect(parseProviderStatsCacheEntry(
      JSON.stringify(entry),
      "recent_api_7d",
      "2026-08-30",
      "2026-08-21",
      "2026-08-27",
    )).toEqual(entry);
    expect(parseProviderStatsCacheEntry(
      JSON.stringify(entry),
      "recent_api_7d",
      "2026-08-30",
      "2026-08-22",
      "2026-08-28",
    )).toBeNull();
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
