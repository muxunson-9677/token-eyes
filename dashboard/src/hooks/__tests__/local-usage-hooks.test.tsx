import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageFiltersProvider } from "../use-usage-filters";
import { useUsageSummary } from "../use-usage-summary";
import { useUsageTrend } from "../use-usage-trend";
import { useUsageFilterOptions } from "../use-usage-filter-options";
import { useRequestUsageRecords } from "../use-request-usage-records";
import { useProviderStats } from "../use-provider-stats";
import { useModelStats } from "../use-model-stats";
import { getUsageSummary, getSpendTimeseries, getProviderStats, getModelStats, getRequestUsageRecords } from "../../lib/api";

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
    vi.mocked(getProviderStats).mockResolvedValue({ providers: [] } as any);
    vi.mocked(getModelStats).mockResolvedValue({ models: [] } as any);

    const { result } = renderHook(() => useUsageFilterOptions(), {
      wrapper: UsageFiltersProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getProviderStats).toHaveBeenCalledTimes(1);
    expect(getModelStats).toHaveBeenCalledTimes(1);
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
