import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageFiltersProvider } from "../use-usage-filters";
import { useUsageSummary } from "../use-usage-summary";
import { useUsageTrend } from "../use-usage-trend";
import { useUsageFilterOptions } from "../use-usage-filter-options";
import { useRequestUsageRecords } from "../use-request-usage-records";
import { useProviderStats, useRecentApiProviderStats } from "../use-provider-stats";
import { useModelStats } from "../use-model-stats";
import { getUsageSummary, getSpendTimeseries, getProviderStats, getRecentApiProviderStats, getModelStats, getRequestUsageRecords } from "../../lib/api";

vi.mock("../../lib/auth-token", () => ({
  isAccessTokenReady: () => false,
  resolveAuthAccessToken: async () => null,
}));
vi.mock("../../lib/mock-data", () => ({ isMockEnabled: () => false }));
vi.mock("../../lib/local-api-url", () => ({
  isLocalDashboardRuntime: () => true,
}));
vi.mock("../../lib/api", () => ({
  getUsageSummary: vi.fn(),
  getSpendTimeseries: vi.fn(),
  getProviderStats: vi.fn(),
  getRecentApiProviderStats: vi.fn(),
  getModelStats: vi.fn(),
  getRequestUsageRecords: vi.fn(),
}));

describe("local usage hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches usage summary without a cloud token", async () => {
    vi.mocked(getUsageSummary).mockResolvedValue({
      ok: true,
      totals: {
        total_tokens: 10,
        input_tokens: 6,
        output_tokens: 4,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        cost_usd: 0,
        request_count: 1,
        success_count: 1,
        success_rate: 100,
        avg_latency_ms: 0,
        cache_hit_rate: 0,
      },
    } as any);

    const { result } = renderHook(
      () => useUsageSummary({ from: "2026-06-01", to: "2026-06-01" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getUsageSummary).toHaveBeenCalledTimes(1);
    expect(result.current.summary?.totals?.total_tokens).toBe(10);
  });

  it("keeps cached usage summary visibly stale when a refresh fails", async () => {
    vi.mocked(getUsageSummary)
      .mockResolvedValueOnce({ ok: true, totals: { total_tokens: 10 } } as any)
      .mockRejectedValueOnce(new Error("usage summary unavailable"));

    const { result } = renderHook(
      () => useUsageSummary({ from: "2026-06-01", to: "2026-06-01", cacheKey: "stale-test" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.summary?.totals?.total_tokens).toBe(10));
    const lastSuccessAt = result.current.fetchedAt;

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.source).toBe("cache");
    expect(result.current.error).toBe("usage summary unavailable");
    expect(result.current.fetchedAt).toBe(lastSuccessAt);
    expect(result.current.summary?.totals?.total_tokens).toBe(10);
  });

  it("fetches usage trend without a cloud token", async () => {
    vi.mocked(getSpendTimeseries).mockResolvedValue({
      ok: true,
      series: [],
    } as any);

    const { result } = renderHook(
      () => useUsageTrend({ from: "2026-06-01", to: "2026-06-01" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSpendTimeseries).toHaveBeenCalledTimes(1);
  });

  it("fetches usage filter options without a cloud token", async () => {
    vi.mocked(getModelStats).mockResolvedValue({
      models: [{ model: "gpt-5", source: "codex", source_display_name: "Codex" }],
    } as any);

    const { result } = renderHook(() => useUsageFilterOptions({ allowedSources: ["codex"] }), {
      wrapper: UsageFiltersProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getProviderStats).not.toHaveBeenCalled();
    expect(getModelStats).toHaveBeenCalledTimes(1);
    expect(result.current.sources).toEqual([{ source: "codex", source_display_name: "Codex" }]);
  });

  it("fetches request usage records without a cloud token", async () => {
    vi.mocked(getRequestUsageRecords).mockResolvedValue({
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
        success_count: 0,
        success_rate: 0,
        avg_latency_ms: 0,
        cache_hit_rate: 0,
      },
    } as any);

    const { result } = renderHook(
      () => useRequestUsageRecords({ from: "2026-06-01", to: "2026-06-01", visibleProviderIds: ["codex"] }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getRequestUsageRecords).toHaveBeenCalled();
  });

  it("fetches provider stats without a cloud token", async () => {
    vi.mocked(getProviderStats).mockResolvedValue({ providers: [] } as any);

    const { result } = renderHook(
      () => useProviderStats({ from: "2026-06-01", to: "2026-06-01" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getProviderStats).toHaveBeenCalledTimes(1);
  });

  it("clears the previous Provider scope when the next range fails", async () => {
    vi.mocked(getProviderStats)
      .mockResolvedValueOnce({ providers: [{ provider_id: "openai", display_name: "OpenAI" }] } as any)
      .mockRejectedValueOnce(new Error("next range unavailable"));

    const { result, rerender } = renderHook(
      ({ from, to }) => useProviderStats({ from, to }),
      {
        initialProps: { from: "2026-06-01", to: "2026-06-30" },
        wrapper: UsageFiltersProvider,
      },
    );

    await waitFor(() => expect(result.current.providers?.providers?.[0]?.provider_id).toBe("openai"));
    rerender({ from: "2026-07-01", to: "2026-07-31" });
    await waitFor(() => expect(result.current.error).toBe("next range unavailable"));

    expect(result.current.providers).toBeNull();
  });

  it("clears Provider rows immediately when the account cache key changes", async () => {
    let resolveNext: ((value: any) => void) | null = null;
    vi.mocked(getProviderStats)
      .mockResolvedValueOnce({ providers: [{ provider_id: "openai", display_name: "OpenAI" }] } as any)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));

    const { result, rerender } = renderHook(
      ({ cacheKey }) => useProviderStats({ from: "2026-06-01", to: "2026-06-30", cacheKey }),
      {
        initialProps: { cacheKey: "user-a" },
        wrapper: UsageFiltersProvider,
      },
    );

    await waitFor(() => expect(result.current.providers?.providers?.[0]?.provider_id).toBe("openai"));
    rerender({ cacheKey: "user-b" });
    expect(result.current.providers).toBeNull();

    await act(async () => {
      resolveNext?.({ providers: [] });
    });
  });

  it("fetches the dedicated current seven-day API Provider view without forwarding page dates", async () => {
    vi.mocked(getRecentApiProviderStats).mockResolvedValue({ providers: [] } as any);

    const { result } = renderHook(
      () => useRecentApiProviderStats({ from: "2020-01-01", to: "2030-12-31" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getRecentApiProviderStats).toHaveBeenCalledTimes(1);
    expect(getRecentApiProviderStats).toHaveBeenCalledWith(expect.not.objectContaining({
      from: expect.anything(),
      to: expect.anything(),
    }));
    expect(getProviderStats).not.toHaveBeenCalled();
  });

  it("fetches model stats without a cloud token", async () => {
    vi.mocked(getModelStats).mockResolvedValue({ models: [] } as any);

    const { result } = renderHook(
      () => useModelStats({ from: "2026-06-01", to: "2026-06-01" }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getModelStats).toHaveBeenCalledTimes(1);
  });
});
