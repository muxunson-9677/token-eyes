import { describe, expect, it } from "vitest";

import { getMockProviderStats } from "../mock-data";

describe("mock Provider stats contract", () => {
  it("matches the selected-range true-Provider schema", () => {
    const response = getMockProviderStats({
      from: "2026-08-21",
      to: "2026-08-27",
      seed: "provider-contract",
      view: "range",
    });

    expect(response.period).toEqual({
      from: "2026-08-21",
      to: "2026-08-27",
      days: 7,
      time_zone: "UTC",
    });
    expect(response.view).toBe("range");
    expect(response.totals_scope).toBe("all_provider_attributed");
    expect(response.providers.length).toBeGreaterThan(0);
    for (const provider of response.providers) {
      expect(provider.provider_id).toBeTruthy();
      expect(provider.display_name).toBeTruthy();
      expect(provider.cost_usd).toBeGreaterThan(0);
      expect(provider.cost_basis).toEqual({
        authority: "local_list_price_estimate",
        accuracy: "estimated",
      });
      expect(provider.request_count).toBeNull();
      expect(provider.request_count_basis).toBe("unavailable");
      expect(provider.success_rate).toBeNull();
      expect(provider.avg_latency_ms).toBeNull();
      expect(provider.status_sample_count).toBe(0);
      expect(provider.success_rate_sample_count).toBe(0);
      expect(provider.availability).toEqual({ status: "unavailable", latency: "unavailable" });
      expect(provider.daily).toHaveLength(7);
      expect(provider.daily.every((day: { cost_basis: unknown }) => (
        JSON.stringify(day.cost_basis) === JSON.stringify(provider.cost_basis)
      ))).toBe(true);
      expect(provider.daily.map((day: { date: string }) => day.date)).toEqual([
        "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
        "2026-08-25", "2026-08-26", "2026-08-27",
      ]);
      expect(provider).not.toHaveProperty("api_key");
      expect(provider).not.toHaveProperty("request_url");
      expect(provider).not.toHaveProperty("source");
      expect(provider).not.toHaveProperty("source_display_name");
    }
  });

  it("uses an isolated current seven-day scope for API Provider cards", () => {
    const response = getMockProviderStats({
      from: "2020-01-01",
      to: "2030-12-31",
      seed: "recent-provider-contract",
      view: "recent_api_7d",
    });

    expect(response.view).toBe("recent_api_7d");
    expect(response.period.days).toBe(7);
    expect(response.period.from).not.toBe("2020-01-01");
    expect(response.period.to).not.toBe("2030-12-31");
    expect(response.totals_scope).toBe("api_key_attributed_official_billed_cost_positive");
    expect(response.providers.every((provider) => (
      provider.cost_basis.authority === "official_invoice"
      && provider.cost_basis.accuracy === "exact"
    ))).toBe(true);
  });
});
