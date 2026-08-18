import { act, render, renderHook, waitFor } from "@testing-library/react";
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

function timeseriesTotals(overrides = {}, bySource = null) {
  const totals = {
    api_usd: 10,
    subscription_usd: 20,
    other_ai_usd: 30,
    combined_usd: 60,
    lifetime_combined_usd: 600,
    ...overrides,
  };
  return {
    totals,
    by_source: bySource ?? (totals.api_usd > 0 ? [{
      source: "codex",
      api_cost_usd: totals.api_usd,
      billing_mode_token_totals: { api_key: 1, token_plan: 0, unknown: 0 },
      billing_provider_token_totals: [{ provider_id: "openai", api_key: 1, token_plan: 0, unknown: 0 }],
    }] : []),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function officialPeriod(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return {
    monthKey,
    billingPeriodStart: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    billingPeriodEnd: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
}

const OTHER_AI_SOURCES = ["other_ai"];
const CODEX_SOURCES = ["codex"];
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
      .mockResolvedValueOnce(timeseriesTotals({ api_usd: 5, subscription_usd: 10, other_ai_usd: 15, combined_usd: 30 }))
      .mockResolvedValueOnce(timeseriesTotals());
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
    expect(getSpendTimeseries).toHaveBeenNthCalledWith(3, expect.not.objectContaining({
      sources: expect.anything(),
    }));
    expect(getSpendTimeseries.mock.calls[2][0]).toEqual(expect.objectContaining({
      from: "2025-06-01",
      to: "2025-06-30",
      timeZone: "UTC",
      tzOffsetMinutes: 0,
    }));
    expect(getSpendRecords).toHaveBeenCalledWith(expect.objectContaining({
      summary_month: "2025-06",
    }));
    expect(getApiBillingAccounts).toHaveBeenCalledWith({
      month: "2025-06",
      timeZone: "UTC",
    });
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

  it("keeps the global UTC ledger on the same month key at a local month boundary", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2025-07-31T16:30:00.000Z"));
    try {
      renderHook(() => useCostAccumulation({
        selectedMonth: "2025-08",
        timeZone: "Asia/Shanghai",
        tzOffsetMinutes: 480,
        sources: CODEX_SOURCES,
      }));

      await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(3));
      expect(getApiBillingAccounts).toHaveBeenCalledWith({ month: "2025-08", timeZone: "UTC" });
      expect(getSpendTimeseries.mock.calls[2][0]).toEqual(expect.objectContaining({
        from: "2025-08-01",
        to: "2025-08-01",
        timeZone: "UTC",
        tzOffsetMinutes: 0,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps subscription cash, API equivalent value, and official API cash in separate ledgers", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockResolvedValueOnce(timeseriesTotals({
        api_usd: 40,
        subscription_usd: 20,
        other_ai_usd: 0,
        combined_usd: 60,
        billing_mode_cost_totals: { api_key: 10, token_plan: 30, unknown: 0 },
      }))
      .mockResolvedValueOnce(timeseriesTotals())
      .mockResolvedValueOnce(timeseriesTotals({
        api_usd: 40,
        subscription_usd: 20,
        other_ai_usd: 0,
        combined_usd: 60,
        billing_mode_cost_totals: { api_key: 10, token_plan: 30, unknown: 0 },
      }));
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        id: "official-api",
        provider: "openai",
        accountName: "Billing",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 8,
        status: "connected",
        ...officialPeriod("2025-06"),
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiEquivalentUsd: 40,
      monthTokenPlanEquivalentUsd: 30,
      monthOfficialApiSpendUsd: 8,
      monthActualCashSpendUsd: 28,
      actualCashCoverage: "exact",
    }));
    expect(
      result.current.costSummary.monthTokenPlanEquivalentUsd
      - result.current.costSummary.monthSubscriptionCostUsd,
    ).toBe(10);
    expect(result.current.costSummary.monthActualCashSpendUsd).not.toBe(68);
  });

  it("keeps the official cash ledger global when usage value is source-filtered", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockResolvedValueOnce(timeseriesTotals({
        api_usd: 0,
        subscription_usd: 0,
        other_ai_usd: 30,
        combined_usd: 30,
      }, [{
        source: "other_ai",
        api_cost_usd: 0,
        billing_mode_token_totals: { api_key: 0, token_plan: 0, unknown: 0 },
        billing_provider_token_totals: [],
      }]))
      .mockResolvedValueOnce(timeseriesTotals())
      .mockResolvedValueOnce(timeseriesTotals());
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        id: "official-api",
        provider: "openai",
        accountName: "Billing",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 8,
        status: "connected",
        ...officialPeriod("2025-06"),
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: OTHER_AI_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthOfficialApiSpendUsd: 8,
      monthActualCashSpendUsd: 58,
      actualCashCoverage: "exact",
    }));
  });

  it("does not attempt to split a shared provider invoice across filtered agents", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        id: "official-api",
        provider: "openai",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 8,
        ...officialPeriod("2025-06"),
      }],
    });
    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "UTC",
      sources: CODEX_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthOfficialApiSpendUsd: 8,
      monthActualCashSpendUsd: 58,
      actualCashCoverage: "exact",
    }));
  });

  it("does not mix filtered usage with a global invoice when global financial totals fail", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockResolvedValueOnce(timeseriesTotals())
      .mockResolvedValueOnce(timeseriesTotals())
      .mockRejectedValueOnce(new Error("global financial totals unavailable"));
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        id: "official-api",
        provider: "openai",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 8,
        ...officialPeriod("2025-06"),
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: CODEX_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiEquivalentUsd: 10,
      monthOfficialApiSpendUsd: null,
      monthActualCashSpendUsd: null,
      actualCashCoverage: "unknown",
    }));
    expect(result.current.costSummaryStale).toBe(true);
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
        spendAuthority: "local_list_price_estimate",
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

  it("keeps mixed official and unavailable API accounts partially covered", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({ api_usd: 10 }, [{
      source: "codex",
      api_cost_usd: 8,
      billing_mode_token_totals: { api_key: 80, token_plan: 0, unknown: 0 },
      billing_provider_token_totals: [{ provider_id: "openai", api_key: 80, token_plan: 0, unknown: 0 }],
    }, {
      source: "anthropic",
      api_cost_usd: 2,
      billing_mode_token_totals: { api_key: 20, token_plan: 0, unknown: 0 },
      billing_provider_token_totals: [{ provider_id: "anthropic", api_key: 20, token_plan: 0, unknown: 0 }],
    }]));
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        provider: "openai",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 8,
        ...officialPeriod("2025-06"),
      }, {
        provider: "anthropic",
        billingSource: "api",
        spendAuthority: "unavailable",
        monthCostUsd: null,
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthOfficialApiSpendUsd: 8,
      monthActualCashSpendUsd: 58,
      actualCashCoverage: "partial",
    }));
  });

  it("marks cash coverage partial when another API-key source has no matching official invoice", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({ api_usd: 35 }, [{
      source: "codex",
      api_cost_usd: 30,
      billing_mode_token_totals: { api_key: 100, token_plan: 0, unknown: 0 },
      billing_provider_token_totals: [{ provider_id: "openai", api_key: 100, token_plan: 0, unknown: 0 }],
    }, {
      source: "anthropic",
      api_cost_usd: 5,
      billing_mode_token_totals: { api_key: 50, token_plan: 0, unknown: 0 },
      billing_provider_token_totals: [{ provider_id: "anthropic", api_key: 50, token_plan: 0, unknown: 0 }],
    }]));
    getApiBillingAccounts.mockResolvedValue({ accounts: [{
      provider: "openai",
      billingSource: "api",
      spendAuthority: "official_invoice",
      monthCostUsd: 8,
      ...officialPeriod("2025-06"),
    }] });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.monthOfficialApiSpendUsd).toBe(8);
    expect(result.current.costSummary.actualCashCoverage).toBe("partial");
  });

  it.each([
    {
      name: "does not let an agent source override a different trusted provider",
      source: "codex",
      providers: [{ provider_id: "deepseek", api_key: 10, token_plan: 0, unknown: 0 }],
      expected: "partial",
    },
    {
      name: "covers a non-provider agent source through trusted OpenAI attribution",
      source: "hermes",
      providers: [{ provider_id: "openai", api_key: 10, token_plan: 0, unknown: 0 }],
      expected: "exact",
    },
    {
      name: "keeps missing trusted provider attribution partial",
      source: "codex",
      providers: [],
      expected: "partial",
    },
    {
      name: "keeps an ambiguous cumulative provider bucket partial",
      source: "hermes",
      providers: [{ provider_id: "unknown", api_key: 10, token_plan: 0, unknown: 0 }],
      expected: "partial",
    },
    {
      name: "keeps one source with covered and uncovered providers partial",
      source: "codex",
      providers: [
        { provider_id: "openai", api_key: 5, token_plan: 0, unknown: 0 },
        { provider_id: "deepseek", api_key: 5, token_plan: 0, unknown: 0 },
      ],
      expected: "partial",
    },
  ])("$name", async ({ source, providers, expected }) => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({ api_usd: 10 }, [{
      source,
      api_cost_usd: 10,
      billing_mode_token_totals: { api_key: 10, token_plan: 0, unknown: 0 },
      billing_provider_token_totals: providers,
    }]));
    getApiBillingAccounts.mockResolvedValue({ accounts: [{
      provider: "openai",
      billingSource: "api",
      spendAuthority: "official_invoice",
      monthCostUsd: 8,
      ...officialPeriod("2025-06"),
    }] });
    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "UTC",
      sources: COST_SOURCES,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.actualCashCoverage).toBe(expected);
  });

  it("does not require an API cash invoice for pure token-plan equivalent usage", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({
      api_usd: 30,
      subscription_usd: 20,
      other_ai_usd: 0,
      combined_usd: 50,
    }, [{
      source: "codex",
      api_cost_usd: 30,
      billing_mode_token_totals: { api_key: 0, token_plan: 100, unknown: 0 },
    }]));
    getApiBillingAccounts.mockResolvedValue({ accounts: [] });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
      monthApiEquivalentUsd: 30,
      monthOfficialApiSpendUsd: null,
      monthActualCashSpendUsd: 20,
      actualCashCoverage: "exact",
    }));
  });

  it("normalizes legacy official_api DTOs without inventing invoice authority", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        provider: "openai",
        billingSource: "official_api",
        monthCostUsd: 7,
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.apiBillingAccounts).toContainEqual(expect.objectContaining({
      billingSource: "api",
      spendAuthority: "unavailable",
    }));
    expect(result.current.costSummary.monthOfficialApiSpendUsd).toBeNull();
    expect(result.current.costSummary.actualCashCoverage).toBe("partial");
  });

  it("does not promote a legacy API DTO without spend authority to actual cash", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        provider: "openai",
        billingSource: "api",
        monthCostUsd: 10,
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.apiBillingAccounts).toContainEqual(expect.objectContaining({
      billingSource: "api",
      spendAuthority: "unavailable",
    }));
    expect(result.current.costSummary.monthOfficialApiSpendUsd).toBeNull();
    expect(result.current.costSummary.actualCashCoverage).toBe("partial");
  });

  it("rejects a negative official invoice amount instead of reducing actual cash", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        provider: "openai",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: -8,
        ...officialPeriod("2025-06"),
      }],
    });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "Asia/Shanghai",
      sources: COST_SOURCES,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary).toEqual(expect.objectContaining({
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

  it("never reuses a January official invoice for the February selection", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals());
    getApiBillingAccounts.mockResolvedValue({
      accounts: [{
        provider: "openai",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 8,
        ...officialPeriod("2025-01"),
      }],
    });

    const { result, rerender } = renderHook(
      ({ selectedMonth }) => useCostAccumulation({
        selectedMonth,
        timeZone: "Asia/Shanghai",
        sources: COST_SOURCES,
      }),
      { initialProps: { selectedMonth: "2025-01" } },
    );

    await waitFor(() => expect(result.current.costSummary.monthOfficialApiSpendUsd).toBe(8));
    rerender({ selectedMonth: "2025-02" });
    await waitFor(() => expect(getApiBillingAccounts).toHaveBeenLastCalledWith({
      month: "2025-02",
      timeZone: "UTC",
    }));
    await waitFor(() => expect(result.current.costSummary.monthOfficialApiSpendUsd).toBeNull());
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
    expect(result.current.costSummary.monthActualCashSpendUsd).toBe(50);

    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockRejectedValueOnce(new Error("financial refresh unavailable"))
      .mockResolvedValueOnce(timeseriesTotals({ api_usd: 5 }))
      .mockRejectedValueOnce(new Error("global financial refresh unavailable"));

    rerender({ refreshRevision: 1 });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.monthApiCostUsd).toBe(10);
    expect(result.current.costSummary.monthActualCashSpendUsd).toBe(50);
    expect(result.current.error).toContain("financial refresh unavailable");
    expect(result.current.costSummaryStale).toBe(true);
    expect(result.current.costLastSuccessfulAt).toEqual(expect.any(String));
  });

  it("does not reuse a previous source scope when the new scoped request fails", async () => {
    getSpendRecords.mockResolvedValueOnce({
      records: [],
      other_ai_group_totals: [{ group_key: "previous-scope", record_count: 1, amount: 9 }],
    });
    const { result, rerender } = renderHook(
      ({ sources }) => useCostAccumulation({
        selectedMonth: "2025-06",
        timeZone: "UTC",
        sources,
      }),
      { initialProps: { sources: ["codex"] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.monthApiEquivalentUsd).toBe(10);
    expect(result.current.otherAiGroupCosts).toHaveLength(1);
    expect(result.current.costLastSuccessfulAt).toEqual(expect.any(String));

    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockRejectedValueOnce(new Error("claude scope unavailable"))
      .mockResolvedValueOnce(timeseriesTotals())
      .mockResolvedValueOnce(timeseriesTotals());
    getSpendRecords.mockRejectedValueOnce(new Error("claude records unavailable"));
    rerender({ sources: ["claude"] });
    expect(result.current.costSummary.monthApiEquivalentUsd).toBeNull();
    expect(result.current.otherAiGroupCosts).toEqual([]);
    expect(result.current.costLastSuccessfulAt).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.costSummary.monthApiEquivalentUsd).toBeNull();
    expect(result.current.otherAiGroupCosts).toEqual([]);
    expect(result.current.costLastSuccessfulAt).toBeNull();
    expect(result.current.costSummaryStale).toBe(true);
  });

  it("never renders the previous source scope during a scope transition", async () => {
    const renderedStates = [];
    function Probe({ sources }) {
      const value = useCostAccumulation({ selectedMonth: "2025-06", timeZone: "UTC", sources });
      renderedStates.push({ api: value.costSummary.monthApiEquivalentUsd, loading: value.loading });
      return null;
    }
    const view = render(<Probe sources={CODEX_SOURCES} />);
    await waitFor(() => expect(renderedStates).toContainEqual({ api: 10, loading: false }));
    renderedStates.length = 0;

    getSpendTimeseries.mockReset();
    getSpendTimeseries
      .mockRejectedValueOnce(new Error("claude scope unavailable"))
      .mockResolvedValueOnce(timeseriesTotals())
      .mockResolvedValueOnce(timeseriesTotals());
    view.rerender(<Probe sources={["claude"]} />);

    expect(renderedStates[0].api).toBeNull();
    await waitFor(() => expect(renderedStates.at(-1)).toEqual({ api: null, loading: false }));
    view.unmount();
  });

  it("keeps a same-month official invoice visibly stale until billing refresh recovers", async () => {
    const officialAccount = {
      provider: "openai",
      billingSource: "api",
      spendAuthority: "official_invoice",
      monthCostUsd: 8,
      status: "synced",
      ...officialPeriod("2025-06"),
    };
    getApiBillingAccounts.mockResolvedValueOnce({ accounts: [officialAccount] });
    const { result, rerender } = renderHook(
      ({ refreshRevision }) => useCostAccumulation({
        selectedMonth: "2025-06",
        timeZone: "Asia/Shanghai",
        sources: COST_SOURCES,
        refreshRevision,
      }),
      { initialProps: { refreshRevision: 0 } },
    );
    await waitFor(() => expect(result.current.costSummary.actualCashCoverage).toBe("exact"));

    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals());
    getApiBillingAccounts.mockRejectedValueOnce(new Error("billing refresh failed"));
    rerender({ refreshRevision: 1 });
    await waitFor(() => expect(result.current.billingStale).toBe(true));
    expect(result.current.costSummary.monthOfficialApiSpendUsd).toBe(8);
    expect(result.current.costSummary.actualCashCoverage).toBe("partial");
    expect(result.current.billingError).toContain("billing refresh failed");

    getApiBillingAccounts.mockResolvedValueOnce({ accounts: [officialAccount] });
    rerender({ refreshRevision: 2 });
    await waitFor(() => expect(result.current.billingStale).toBe(false));
    expect(result.current.costSummary.actualCashCoverage).toBe("exact");
    expect(result.current.billingError).toBeNull();

    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({ api_usd: 30 }, [{
      source: "codex",
      api_cost_usd: 30,
      billing_mode_token_totals: { api_key: 0, token_plan: 100, unknown: 0 },
      billing_provider_token_totals: [{ provider_id: "openai", api_key: 0, token_plan: 100, unknown: 0 }],
    }]));
    getApiBillingAccounts.mockRejectedValueOnce(new Error("billing refresh failed again"));
    rerender({ refreshRevision: 3 });
    await waitFor(() => expect(result.current.billingStale).toBe(true));
    expect(result.current.costSummary.actualCashCoverage).toBe("partial");
  });

  it("preserves ambiguous billing metadata and ignores a slower old billing response", async () => {
    const oldBilling = deferred();
    getApiBillingAccounts.mockReset();
    getApiBillingAccounts
      .mockImplementationOnce(() => oldBilling.promise)
      .mockResolvedValueOnce({ accounts: [{
        provider: "openai",
        accountName: "OpenAI Billing",
        billingSource: "api",
        spendAuthority: "unavailable",
        status: "ambiguous",
        errorCode: "official_invoice_ambiguous",
        candidateCount: 2,
      }] });
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals());

    const { result, rerender } = renderHook(
      ({ selectedMonth }) => useCostAccumulation({ selectedMonth, timeZone: "UTC", sources: COST_SOURCES }),
      { initialProps: { selectedMonth: "2025-05" } },
    );
    rerender({ selectedMonth: "2025-06" });
    await waitFor(() => expect(result.current.apiBillingAccounts[0]).toEqual(expect.objectContaining({
      status: "ambiguous",
      errorCode: "official_invoice_ambiguous",
      candidateCount: 2,
    })));
    expect(result.current.costSummary.actualCashCoverage).toBe("partial");
    await act(async () => {
      oldBilling.resolve({ accounts: [{
        provider: "openai",
        billingSource: "api",
        spendAuthority: "official_invoice",
        monthCostUsd: 99,
        ...officialPeriod("2025-05"),
      }] });
    });
    expect(result.current.apiBillingAccounts[0]).toEqual(expect.objectContaining({
      status: "ambiguous",
      candidateCount: 2,
    }));
  });

  it("keeps pure token-plan cash coverage exact while showing ambiguous billing diagnostics", async () => {
    getSpendTimeseries.mockReset();
    getSpendTimeseries.mockResolvedValue(timeseriesTotals({ api_usd: 30 }, [{
      source: "codex",
      api_cost_usd: 30,
      billing_mode_token_totals: { api_key: 0, token_plan: 100, unknown: 0 },
    }]));
    getApiBillingAccounts.mockResolvedValue({ accounts: [{
      provider: "openai",
      accountName: "OpenAI 官方账单",
      billingSource: "api",
      spendAuthority: "unavailable",
      status: "ambiguous",
      errorCode: "official_invoice_ambiguous",
      candidateCount: 2,
    }] });

    const { result } = renderHook(() => useCostAccumulation({
      selectedMonth: "2025-06",
      timeZone: "UTC",
      sources: COST_SOURCES,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.apiBillingAccounts[0]).toEqual(expect.objectContaining({
      errorCode: "official_invoice_ambiguous",
      candidateCount: 2,
    }));
    expect(result.current.costSummary.actualCashCoverage).toBe("exact");
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
    const calls = [deferred(), deferred(), deferred(), deferred(), deferred(), deferred()];
    calls.forEach(({ promise }) => getSpendTimeseries.mockImplementationOnce(() => promise));

    const { result, rerender } = renderHook(
      ({ selectedMonth }) => useCostAccumulation({
        selectedMonth,
        timeZone: "Asia/Shanghai",
        sources: OTHER_AI_SOURCES,
      }),
      { initialProps: { selectedMonth: "2025-06" } },
    );

    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(3));
    rerender({ selectedMonth: "2025-07" });
    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(6));

    await act(async () => {
      calls[3].resolve(timeseriesTotals({ combined_usd: 70 }));
      calls[4].resolve(timeseriesTotals({ combined_usd: 35 }));
      calls[5].resolve(timeseriesTotals({ combined_usd: 80 }));
    });
    await waitFor(() => expect(result.current.costSummary.monthTotalCostUsd).toBe(70));

    await act(async () => {
      calls[0].resolve(timeseriesTotals({ combined_usd: 60 }));
      calls[1].resolve(timeseriesTotals({ combined_usd: 30 }));
      calls[2].resolve(timeseriesTotals({ combined_usd: 65 }));
    });
    expect(result.current.costSummary.monthTotalCostUsd).toBe(70);
  });
});
