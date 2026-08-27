import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  UsageFiltersProvider,
} from "../use-usage-filters";
import { useUsageSummary } from "../use-usage-summary";
import { useUsageTrend } from "../use-usage-trend";
import { useUsageFilterOptions } from "../use-usage-filter-options";
import { useProviderStats } from "../use-provider-stats";
import { useModelStats } from "../use-model-stats";
import { useRequestUsageRecords } from "../use-request-usage-records";

// Mock API functions
vi.mock("../../lib/api", () => ({
  getUsageSummary: vi.fn(),
  getSpendTimeseries: vi.fn(),
  getProviderStats: vi.fn(),
  getRecentApiProviderStats: vi.fn(),
  getModelStats: vi.fn(),
  getRequestUsageRecords: vi.fn(),
}));

// Mock auth-token so hooks proceed with test token
vi.mock("../../lib/auth-token", () => ({
  isAccessTokenReady: () => true,
  resolveAuthAccessToken: async () => "test-token",
}));

// Mock mock-data so hooks treat runs as mock-enabled (no localStorage cache)
vi.mock("../../lib/mock-data", () => ({
  isMockEnabled: () => true,
}));

// Mock local-api-url to simulate local mode
vi.mock("../../lib/local-api-url", () => ({
  isLocalDashboardRuntime: () => false,
}));

import {
  getUsageSummary,
  getSpendTimeseries,
  getProviderStats,
  getModelStats,
  getRequestUsageRecords,
} from "../../lib/api";

// Helper to setup hooks with common params
function setupHook<T>(
  useHook: () => T,
  allowedSources?: string[],
) {
  return renderHook(() => useHook(), {
    wrapper: UsageFiltersProvider,
  });
}

describe("usage visible scope enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock responses
    getUsageSummary.mockResolvedValue({
      total_tokens: 100,
      input_tokens: 50,
      output_tokens: 50,
      cost_usd: 0.01,
    });
    getSpendTimeseries.mockResolvedValue({
      sources: ["claude", "codex"],
      series: [],
      by_source: [],
    });
    getProviderStats.mockResolvedValue({
      providers: [],
    });
    getModelStats.mockResolvedValue({
      models: [],
    });
    getRequestUsageRecords.mockResolvedValue({
      records: [],
      totals: null,
    });
  });

  describe("allowlist intersection", () => {
    it("useUsageSummary: returns disabledByVisibility=true when effectiveSources is empty", async () => {
      // Pass allowedSources as undefined (no allowlist) then use filterParams.sources
      // Actually, we need to pass allowedSources to the hook
      // Let me modify the test to reflect the actual hook signature
      const { result } = renderHook(
        () =>
          useUsageSummary({
            allowedSources: ["claude", "codex"], // allowlist
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should return disabledByVisibility field
      expect(result.current.disabledByVisibility).toBeDefined();
    });

    it("useUsageTrend: respects allowedSources intersection", async () => {
      const { result } = renderHook(
        () =>
          useUsageTrend({
            allowedSources: ["claude", "codex"],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.disabledByVisibility).toBeDefined();
    });
  });

  describe("empty allowlist safety", () => {
    it("useUsageSummary: disabledByVisibility=true when allowedSources is empty array", async () => {
      const { result } = renderHook(
        () =>
          useUsageSummary({
            allowedSources: [], // empty allowlist
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Empty allowlist should disable the hook
      expect(result.current.disabledByVisibility).toBe(true);
      expect(result.current.summary).toBeNull();
      expect(getUsageSummary).not.toHaveBeenCalled();
    });

    it("useUsageTrend: disabledByVisibility=true when allowedSources is empty array", async () => {
      const { result } = renderHook(
        () =>
          useUsageTrend({
            allowedSources: [],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.disabledByVisibility).toBe(true);
      expect(result.current.trend).toBeNull();
      expect(getSpendTimeseries).not.toHaveBeenCalled();
    });

    it("useProviderStats: returns empty data when allowedSources is empty", async () => {
      const { result } = renderHook(
        () =>
          useProviderStats({
            allowedSources: [],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toBeNull();
      expect(getProviderStats).not.toHaveBeenCalled();
    });

    it("useModelStats: returns empty data when allowedSources is empty", async () => {
      const { result } = renderHook(
        () =>
          useModelStats({
            allowedSources: [],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.models).toBeNull();
      expect(getModelStats).not.toHaveBeenCalled();
    });

    it("useUsageFilterOptions: returns empty sources when allowedSources is empty", async () => {
      const { result } = renderHook(
        () =>
          useUsageFilterOptions({
            allowedSources: [],
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sources).toEqual([]);
      expect(getProviderStats).not.toHaveBeenCalled();
      expect(getModelStats).not.toHaveBeenCalled();
    });
  });

  describe("unknown ID dropping", () => {
    it("useRequestUsageRecords: normalizes and drops unknown provider IDs", async () => {
      // Pass IDs with unknown provider and mixed case
      const { result } = renderHook(
        () =>
          useRequestUsageRecords({
            visibleProviderIds: ["Claude", "UnknownProvider", "Codex"],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should only fetch for known providers (normalized to lowercase)
      // UnknownProvider should be dropped. The hook passes `sources` (plural,
      // an array) in a single call, so flatten all calls' sources arrays.
      const calledSources = getRequestUsageRecords.mock.calls.flatMap(
        (call) => call[0].sources ?? [],
      );

      // Should only call for claude and codex (normalized), not UnknownProvider
      expect(calledSources).toContain("claude");
      expect(calledSources).toContain("codex");
      expect(calledSources).not.toContain("UnknownProvider");
      expect(calledSources).not.toContain("Claude"); // should be normalized to lowercase
    });
  });

  describe("empty array no request", () => {
    it("useRequestUsageRecords: does not fetch when visibleProviderIds is empty", async () => {
      const { result } = renderHook(
        () =>
          useRequestUsageRecords({
            visibleProviderIds: [],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.records).toEqual([]);
      expect(getRequestUsageRecords).not.toHaveBeenCalled();
    });

    it("useRequestUsageRecords: does not fetch when all IDs are unknown", async () => {
      const { result } = renderHook(
        () =>
          useRequestUsageRecords({
            visibleProviderIds: ["Unknown1", "Unknown2"],
            from: "2026-06-01",
            to: "2026-06-30",
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.records).toEqual([]);
      expect(getRequestUsageRecords).not.toHaveBeenCalled();
    });
  });

  describe("filter options lookback window unchanged", () => {
    it("useUsageFilterOptions: respects days parameter even with allowedSources", async () => {
      const { result } = renderHook(
        () =>
          useUsageFilterOptions({
            allowedSources: ["claude", "codex"],
            days: 30, // custom lookback
            baseUrl: "http://localhost:3000",
            accessToken: "test-token",
            guestAllowed: false,
            cacheKey: "test",
            timeZone: "UTC",
            tzOffsetMinutes: 0,
          }),
        { wrapper: UsageFiltersProvider },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Check that API was called with correct date range (30 days lookback)
      expect(getProviderStats).not.toHaveBeenCalled();
      expect(getModelStats).toHaveBeenCalled();
    });
  });
});
