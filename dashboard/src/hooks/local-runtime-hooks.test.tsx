import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectUsageSummary,
  getUsageHourly,
  getUsageDaily,
  getUsageModelBreakdown,
  getUsageMonthly,
  getUsageSummary,
} from "../lib/api";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { UsageFiltersProvider } from "./use-usage-filters";
import { useProjectUsageSummary } from "./use-project-usage-summary";
import { useTrendData } from "./use-trend-data";
import { useUsageData } from "./use-usage-data";
import { useUsageModelBreakdown } from "./use-usage-model-breakdown";

vi.mock("../lib/api", () => ({
  fetchCloudUsageDaily: vi.fn(),
  fetchCloudUsageHourly: vi.fn(),
  fetchCloudUsageModelBreakdown: vi.fn(),
  fetchCloudUsageMonthly: vi.fn(),
  fetchCloudUsageSummary: vi.fn(),
  getProjectUsageSummary: vi.fn(),
  getUsageDaily: vi.fn(),
  getUsageHourly: vi.fn(),
  getUsageModelBreakdown: vi.fn(),
  getUsageMonthly: vi.fn(),
  getUsageSummary: vi.fn(),
}));

vi.mock("../lib/auth-token", () => ({
  isAccessTokenReady: vi.fn(),
  resolveAuthAccessToken: vi.fn(),
}));

vi.mock("../lib/mock-data", () => ({
  isMockEnabled: vi.fn(() => false),
}));

describe("local dashboard runtime hooks", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.mocked(isAccessTokenReady).mockReturnValue(false);
    vi.mocked(resolveAuthAccessToken).mockResolvedValue(null);
    vi.mocked(getUsageSummary).mockReset().mockResolvedValue({
      totals: { total_tokens: 123, billable_total_tokens: 123, conversation_count: 2 },
      rolling: {},
    });
    vi.mocked(getUsageDaily).mockReset().mockResolvedValue({ data: [] });
    vi.mocked(getUsageHourly).mockReset().mockResolvedValue({ data: [] });
    vi.mocked(getUsageMonthly).mockReset().mockResolvedValue({ data: [] });
    vi.mocked(getUsageModelBreakdown).mockReset().mockResolvedValue({ sources: [] });
    vi.mocked(getProjectUsageSummary).mockReset().mockResolvedValue({ entries: [] });
    (window as any).__TAURI__ = {};
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: "token-eyes.local",
        origin: "https://token-eyes.local",
      },
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    delete (window as any).__TAURI__;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    window.localStorage.clear();
  });

  it("loads overview usage from the local API in Tauri even without a login token", async () => {
    renderHook(
      () =>
        useUsageData({
          baseUrl: "http://127.0.0.1:7680",
          accessToken: null,
          from: "2026-07-06",
          to: "2026-07-06",
          includeDaily: false,
        }),
      { wrapper: UsageFiltersProvider },
    );

    await waitFor(() => expect(getUsageSummary).toHaveBeenCalledTimes(1));
  });

  it("loads trend data from the local API in Tauri even without a login token", async () => {
    renderHook(() =>
      useTrendData({
        baseUrl: "http://127.0.0.1:7680",
        accessToken: null,
        period: "total",
        from: "2026-07-06",
        to: "2026-07-06",
      }),
    );

    await waitFor(() => expect(getUsageMonthly).toHaveBeenCalledTimes(1));
  });

  it("loads model breakdown from the local API in Tauri even without a login token", async () => {
    renderHook(() =>
      useUsageModelBreakdown({
        baseUrl: "http://127.0.0.1:7680",
        accessToken: null,
        from: "2026-07-06",
        to: "2026-07-06",
      }),
    );

    await waitFor(() => expect(getUsageModelBreakdown).toHaveBeenCalledTimes(1));
  });

  it("loads project usage summary from the local API in Tauri even without a login token", async () => {
    renderHook(() =>
      useProjectUsageSummary({
        baseUrl: "http://127.0.0.1:7680",
        accessToken: null,
        from: "2026-07-06",
        to: "2026-07-06",
      }),
    );

    await waitFor(() => expect(getProjectUsageSummary).toHaveBeenCalledTimes(1));
  });

  it("keeps the last project usage entries visible when a refresh fails", async () => {
    vi.mocked(getProjectUsageSummary).mockResolvedValueOnce({
      entries: [{ project: "muxunson-9677/token-eyes", total_tokens: "82588123" }],
    });
    const { result } = renderHook(() =>
      useProjectUsageSummary({
        baseUrl: "http://127.0.0.1:7680",
        accessToken: null,
        from: "2026-07-06",
        to: "2026-07-06",
      }),
    );

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    vi.mocked(getProjectUsageSummary).mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe("offline");
    expect(result.current.entries).toEqual([
      { project: "muxunson-9677/token-eyes", total_tokens: "82588123" },
    ]);
  });
});
