import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  UsageFiltersProvider,
} from "../use-usage-filters";
import { useRequestUsageRecords } from "../use-request-usage-records";

vi.mock("../../lib/api", () => ({
  getRequestUsageRecords: vi.fn(),
}));

vi.mock("../../lib/auth-token", () => ({
  isAccessTokenReady: () => true,
  resolveAuthAccessToken: async () => "test-token",
}));

const mockState = vi.hoisted(() => ({ mockEnabled: false }));

vi.mock("../../lib/mock-data", () => ({
  isMockEnabled: () => mockState.mockEnabled,
}));

import { getRequestUsageRecords } from "../../lib/api";

function makeRecord(source: string, model: string, ts: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${source}-${model}-${ts}`,
    timestamp: ts,
    hour_start: ts,
    source,
    source_display_name: source.charAt(0).toUpperCase() + source.slice(1),
    model,
    status: 200,
    latency_ms: 830,
    first_token_ms: 200,
    request_source: "session_log",
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    cost_usd: 0.01,
    ...overrides,
  };
}

function makeTotals(overrides: Record<string, unknown> = {}) {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    cost_usd: 0.01,
    request_count: 1,
    success_count: 1,
    success_rate: 100,
    avg_latency_ms: 830,
    cache_hit_rate: 0,
    priced_tokens: 100,
    unpriced_tokens: 0,
    pricing_coverage: "complete",
    status_sample_count: 1,
    latency_sample_count: 1,
    ...overrides,
  };
}

function setup(visibleProviderIds: string[], options: Record<string, unknown> = {}) {
  return renderHook(
    () =>
      useRequestUsageRecords({
        from: "2026-06-01",
        to: "2026-06-30",
        visibleProviderIds,
        baseUrl: "http://localhost:3000",
        accessToken: "test-token",
        guestAllowed: false,
        cacheKey: "test",
        timeZone: "UTC",
        tzOffsetMinutes: 0,
        ...options,
      }),
    { wrapper: UsageFiltersProvider },
  );
}

describe("useRequestUsageRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.mockEnabled = false;
    window.localStorage.clear();
  });

  it("returns empty records without fetching when visibleProviderIds is empty", async () => {
    const { result } = setup([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.records).toEqual([]);
    expect(getRequestUsageRecords).not.toHaveBeenCalled();
  });

  it("fetches all sources when visibleProviderIds is omitted", async () => {
    getRequestUsageRecords.mockResolvedValue({
      records: [makeRecord("hermes", "deepseek-v4-pro", "2026-06-24T03:00:00.000Z")],
      totals: makeTotals(),
      page: { page: 1, pageSize: 10, total: 1, total_pages: 1 },
    });

    const { result } = renderHook(
      () =>
        useRequestUsageRecords({
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
      expect(result.current.records.length).toBe(1);
    });

    expect(getRequestUsageRecords).toHaveBeenCalledTimes(1);
    expect(getRequestUsageRecords).toHaveBeenCalledWith(
      expect.objectContaining({ sources: undefined }),
    );
  });

  it("fetches all visible providers in a single request with sources parameter", async () => {
    const codexRecords = [makeRecord("codex", "gpt-5", "2026-06-24T01:00:00.000Z")];
    const claudeRecords = [makeRecord("claude", "sonnet", "2026-06-24T02:00:00.000Z")];
    const hermesRecords = [makeRecord("hermes", "llama", "2026-06-24T03:00:00.000Z")];

    getRequestUsageRecords.mockResolvedValue({
      records: [...codexRecords, ...claudeRecords, ...hermesRecords],
      totals: makeTotals(),
      page: { page: 1, pageSize: 10, total: 3, total_pages: 1 },
    });

    const { result } = setup(["codex", "claude", "hermes"]);

    await waitFor(() => {
      expect(result.current.records.length).toBe(3);
    });

    expect(getRequestUsageRecords).toHaveBeenCalledTimes(1);
    const callArgs = getRequestUsageRecords.mock.calls[0][0];
    expect(callArgs.sources).toEqual(["codex", "claude", "hermes"]);

    const sources = result.current.records.map((r) => r.source);
    expect(sources).toContain("codex");
    expect(sources).toContain("claude");
    expect(sources).toContain("hermes");
  });

  it("returns totals from single backend response", async () => {
    getRequestUsageRecords.mockResolvedValue({
      records: [
        makeRecord("codex", "gpt-5", "2026-06-24T01:00:00.000Z"),
        makeRecord("claude", "sonnet", "2026-06-24T02:00:00.000Z"),
      ],
      totals: makeTotals({
        input_tokens: 300,
        output_tokens: 150,
        total_tokens: 450,
        cost_usd: 0.03,
        request_count: 3,
        success_count: 3,
        success_rate: 100,
        avg_latency_ms: 610,
      }),
      page: { page: 1, pageSize: 10, total: 2, total_pages: 1 },
    });

    const { result } = setup(["codex", "claude"]);

    await waitFor(() => {
      expect(result.current.totals).not.toBeNull();
    });

    const totals = result.current.totals!;
    expect(totals.input_tokens).toBe(300);
    expect(totals.output_tokens).toBe(150);
    expect(totals.total_tokens).toBe(450);
    expect(totals.cost_usd).toBeCloseTo(0.03, 6);
    expect(totals.request_count).toBe(3);
    expect(totals.success_rate).toBe(100);
    expect(totals.avg_latency_ms).toBe(610);
  });

  it("returns backend-provided pagination metadata", async () => {
    getRequestUsageRecords.mockResolvedValue({
      records: [makeRecord("codex", "gpt-5", "2026-06-24T01:00:00.000Z")],
      totals: makeTotals(),
      page: { page: 1, pageSize: 10, total: 5000, total_pages: 500 },
    });

    const { result } = setup(["codex"]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(500);
    expect(result.current.total).toBe(5000);
  });

  it("returns correct page metadata when requesting page 2", async () => {
    getRequestUsageRecords.mockResolvedValue({
      records: [makeRecord("codex", "gpt-5", "2026-06-24T01:00:00.000Z")],
      totals: makeTotals(),
      page: { page: 2, pageSize: 10, total: 5000, total_pages: 500 },
    });

    const { result } = setup(["codex"], { page: 2, pageSize: 10 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(getRequestUsageRecords).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
    expect(result.current.page).toBe(2);
  });

  it("caches request records separately for each page and page size", async () => {
    getRequestUsageRecords.mockResolvedValue({
      records: [makeRecord("codex", "gpt-5", "2026-06-24T01:00:00.000Z")],
      totals: makeTotals(),
      page: { page: 2, pageSize: 10, total: 20, total_pages: 2 },
    });

    const { result } = setup(["codex"], { page: 2, pageSize: 10 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const keys = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index) || "",
    );
    expect(keys.some((key) => key.includes(".p2.s10"))).toBe(true);
  });

  it("restores pagination metadata from cache while a refresh is unavailable", async () => {
    getRequestUsageRecords.mockResolvedValueOnce({
      records: [makeRecord("codex", "gpt-5", "2026-06-24T01:00:00.000Z")],
      totals: makeTotals({ request_count: 33 }),
      page: { page: 1, pageSize: 10, total: 33, total_pages: 4 },
    });

    const first = setup(["codex"], { page: 1, pageSize: 10 });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    getRequestUsageRecords.mockRejectedValueOnce(new Error("refresh unavailable"));
    const cached = setup(["codex"], { page: 1, pageSize: 10 });

    await waitFor(() => expect(cached.result.current.loading).toBe(false));
    expect(cached.result.current.records).toHaveLength(1);
    expect(cached.result.current.total).toBe(33);
    expect(cached.result.current.totalPages).toBe(4);
  });

  it("sets error when fetch fails", async () => {
    getRequestUsageRecords.mockRejectedValue(new Error("api down"));

    const { result } = setup(["codex", "claude"]);

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toBe("api down");
    expect(result.current.records).toEqual([]);
  });
});
