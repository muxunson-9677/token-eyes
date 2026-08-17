import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApiBillingAccounts,
  getSpendRecords,
  getSpendTimeseries,
  getTokenPlans,
} from "../lib/api";
import { useCostAccumulation } from "./use-cost-accumulation.js";

vi.mock("../lib/api", () => ({
  getApiBillingAccounts: vi.fn(),
  getSpendRecords: vi.fn(),
  getSpendTimeseries: vi.fn(),
  getTokenPlans: vi.fn(),
}));

function timeseriesTotals(overrides = {}) {
  return {
    totals: {
      api_usd: 10,
      subscription_usd: 20,
      other_ai_usd: 30,
      combined_usd: 60,
      lifetime_combined_usd: 600,
      ...overrides,
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

const OTHER_AI_SOURCES = ["other_ai"];
const COST_SOURCES = ["codex", "other_ai"];

describe("useCostAccumulation selected month", () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.clearAllMocks();
    getTokenPlans.mockResolvedValue({ records: [] });
    getApiBillingAccounts.mockResolvedValue({ accounts: [] });
    getSpendRecords.mockResolvedValue({ records: [], other_ai_group_totals: [] });
    getSpendTimeseries
      .mockResolvedValueOnce(timeseriesTotals())
      .mockResolvedValueOnce(timeseriesTotals({ api_usd: 5, subscription_usd: 10, other_ai_usd: 15, combined_usd: 30 }));
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("queries the selected and comparison months and preserves each ledger component", async () => {
    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      tzOffsetMinutes: 480,
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getSpendTimeseries).toHaveBeenNthCalledWith(1, expect.objectContaining({
      from: "2025-06-01",
      to: "2025-06-30",
      timeZone: "Asia/Shanghai",
      tzOffsetMinutes: 480,
    }));
    expect(getSpendTimeseries.mock.calls[0][0]).toHaveProperty("sources", COST_SOURCES);
    expect(getSpendTimeseries).toHaveBeenNthCalledWith(2, expect.objectContaining({
      from: "2025-05-01",
      to: "2025-05-31",
    }));
    expect(getSpendRecords).toHaveBeenCalledWith(expect.objectContaining({
      summary_month: "2025-06",
    }));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiCostUsd: 10,
      monthSubscriptionCostUsd: 20,
      monthOtherAiCostUsd: 30,
      monthTotalCostUsd: 60,
      previousMonthApiCostUsd: 5,
      previousMonthSubscriptionCostUsd: 10,
      previousMonthOtherAiCostUsd: 15,
      previousMonthTotalCostUsd: 30,
      lifetimeTotalCostUsd: 600,
    }));
  });

  it("separates actual cash spend from API list-price equivalent value", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        id: "official-api",
        provider: "openai",
        accountName: "Billing",
        billingSource: "official_api",
        monthCostUsd: 7,
        status: "connected",
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiEquivalentUsd: 10,
      monthOfficialApiSpendUsd: 7,
      monthActualCashSpendUsd: 57,
      actualCashCoverage: "exact",
    }));
    expect(result.current.costSummary.monthActualCashSpendUsd).not.toBe(60);
  });

  it("marks actual cash spend partial when official API billing is unavailable", async () => {
    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiEquivalentUsd: 10,
      monthOfficialApiSpendUsd: null,
      monthActualCashSpendUsd: 50,
      actualCashCoverage: "partial",
    }));
  });

  it("does not mislabel a local list-price API estimate as official cash spend", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        id: "local-estimate",
        provider: "openai",
        accountName: "Detected usage",
        billingSource: "api",
        monthCostUsd: 10,
        status: "synced",
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiEquivalentUsd: 10,
      monthOfficialApiSpendUsd: null,
      monthActualCashSpendUsd: 50,
      actualCashCoverage: "partial",
    }));
  });

  it("keeps missing timeseries unavailable instead of inventing zero", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockRejectedValueOnce(new Error("selected month unavailable"));
    getSpendTimeseries.mockResolvedValueOnce(timeseriesTotals({
      api_usd: 0,
      subscription_usd: 0,
      other_ai_usd: 0,
      combined_usd: 0,
    }));

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: OTHER_AI_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiCostUsd: null,
      monthSubscriptionCostUsd: null,
      monthOtherAiCostUsd: null,
      monthTotalCostUsd: null,
    }));
    expect(result.current.error).toContain("selected month unavailable");
  });

  it("keeps the last successful financial totals and reports them stale when refresh fails", async () => {
    const { result, rerender } = renderHook(
      ({ refreshRevision }) => useCostAccumulation({
        selectedMonth: "2025-06",
        timeZone: "Asia/Shanghai",
        sources: COST_SOURCES,
        refreshRevision,
      }),
      { initialProps: { refreshRevision: 0 } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.monthApiCostUsd).toBe(10);

    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockRejectedValueOnce(new Error("financial refresh unavailable"))
      .mockResolvedValueOnce(timeseriesTotals({ api_usd: 5 }));

    rerender({ refreshRevision: 1 });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.monthApiCostUsd).toBe(10);
    expect(result.current.error).toContain("financial refresh unavailable");
    expect(result.current.costSummaryStale).toBe(true);
    expect(result.current.costLastSuccessfulAt).toEqual(expect.any(String));
  });

  it("preserves explicit real zero totals", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({
      api_usd: 0,
      subscription_usd: 0,
      other_ai_usd: 0,
      combined_usd: 0,
      lifetime_combined_usd: 0,
    }));

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: OTHER_AI_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiCostUsd: 0,
      monthSubscriptionCostUsd: 0,
      monthOtherAiCostUsd: 0,
      monthTotalCostUsd: 0,
      lifetimeTotalCostUsd: 0,
    }));
  });

  it("mirrors paid expired token plans into subscription records as read-only history", async () => {
    getTokenPlans.mockResolvedValue({
      records: [{
        id: "expired-plan",
        source: "codex",
        provider_id: "codex",
        plan_label: "Plus",
        subscription_amount: 20,
        subscription_currency: "USD",
        subscription_cycle: "monthly",
        subscription_start_date: "2025-01-01",
        subscription_end_date: "2025-02-01",
        expires_at: "2025-02-01",
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscriptionRecords).toContainEqual(expect.objectContaining({
      id: "token-plan-cost:expired-plan",
      name: "Plus",
      provider: "codex",
      amount: 20,
      currency: "USD",
      cycle: "monthly",
      status: "expired",
      origin: "token_plan",
      readOnly: true,
    }));
    expect(result.current.tokenPackages).toEqual([]);
  });

  it("does not let a slower old month overwrite the latest selection", async () => {
    getSpendTimeseries.mockReset();
    const calls = [deferred(), deferred(), deferred(), deferred()];
    calls.forEach(({ promise }) => getSpendTimeseries.mockImplementationOnce(() => promise));

    const { result, rerender } = renderHook(
      ({ selectedMonth }) => useCostAccumulation({
        selectedMonth,
        timeZone: "Asia/Shanghai",
        sources: OTHER_AI_SOURCES,
      }),
      { initialProps: { selectedMonth: "2025-06" } },
    );

    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(2));
    rerender({ selectedMonth: "2025-07" });
    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(4));

    await act(async () => {
      calls[2].resolve(timeseriesTotals({ combined_usd: 70 }));
      calls[3].resolve(timeseriesTotals({ combined_usd: 35 }));
    });
    await waitFor(() => expect(result.current.costSummary.monthTotalCostUsd).toBe(70));

    await act(async () => {
      calls[0].resolve(timeseriesTotals({ combined_usd: 60 }));
      calls[1].resolve(timeseriesTotals({ combined_usd: 30 }));
    });
    expect(result.current.costSummary.monthTotalCostUsd).toBe(70);
  });
});
