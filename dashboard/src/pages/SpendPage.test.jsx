import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SpendUsagePage, SpendCostPage } from "./SpendPage.jsx";
import {
  createSpendRecord,
  deleteSpendRecord,
  getSpendRecords,
  updateSpendRecord,
  getSpendTimeseries,
  getLocalSettings,
  setLocalSettings,
  getRequestUsageRecords,
  getUsageBounds,
  getUsageSummary,
  getProviderStats,
  getUsageAttribution,
  getLimitAccounts,
  getObservabilityExport,
  getModelStats,
  getTokenPlans,
  getConsoleSessions,
  getApiBillingAccounts,
  getProviderApiConfigs,
  getProviderApiBalances,
  refreshProviderApiBalance,
} from "../lib/api";
import { useCurrency } from "../hooks/useCurrency.js";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";

// SpendPage split tests for the v2.0 IA refactor (work order 01) +
// 03-ia-api-balance provider-balance + subscription-CRUD coverage.
// - SpendUsagePage covers stats panel, summary cards, trend chart, and the
//   three usage detail tabs (requests / provider / model). The independent
//   "按来源拆分" table is GONE — tests that asserted it are removed.
// - SpendCostPage covers the CostAccumulation component, including the NEW
//   provider API account section (03) and subscription CRUD (03).
// - Top-level "使用统计 / 成本累积" Tab UI is GONE — each route renders its
//   own content; tests no longer click a tab to switch.

vi.mock("../lib/api", () => ({
  createSpendRecord: vi.fn(),
  deleteSpendRecord: vi.fn(),
  getSpendRecords: vi.fn(),
  updateSpendRecord: vi.fn(),
  getSpendTimeseries: vi.fn(),
  getRequestUsageRecords: vi.fn(),
  getUsageBounds: vi.fn(),
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
  getUsageSummary: vi.fn(),
  getProviderStats: vi.fn(),
  getUsageAttribution: vi.fn(),
  getLimitAccounts: vi.fn(),
  getObservabilityExport: vi.fn(),
  getModelStats: vi.fn(),
  getTokenPlans: vi.fn(),
  getConsoleSessions: vi.fn(),
  syncCodexConsoleQuota: vi.fn(),
  syncTraeConsoleQuota: vi.fn(),
  saveTokenPlan: vi.fn(),
  getApiBillingAccounts: vi.fn(),
  // 03-ia-api-balance: provider API config / balance functions.
  getProviderApiConfigs: vi.fn(),
  getProviderApiBalances: vi.fn(),
  refreshProviderApiBalance: vi.fn(),
  saveProviderApiConfig: vi.fn(),
  updateProviderApiConfig: vi.fn(),
  deleteProviderApiConfig: vi.fn(),
  saveProviderApiSecret: vi.fn(),
  deleteProviderApiSecret: vi.fn(),
  testProviderApiConfig: vi.fn(),
}));

vi.mock("../lib/mock-data", () => ({
  isMockEnabled: () => true,
}));

vi.mock("../hooks/useCurrency.js", () => ({
  useCurrency: vi.fn(() => ({ currency: "USD", rate: 1 })),
}));

vi.mock("../hooks/use-limits-display-prefs.js", () => ({
  useLimitsDisplayPrefs: vi.fn(),
  limitProviderName: (id) => {
    const map = { claude: "Claude", codex: "Codex", hermes: "Hermes", cursor: "Cursor" };
    return map[id] || id;
  },
}));

const EMPTY_RESULT = {
  records: [],
  totals: {
    subscription_usd: 0, subscription_cny: 0,
    api_usd: 0, api_cny: 0,
    combined_usd: 0, combined_cny: 0,
    lifetime_subscription_usd: 0, lifetime_subscription_cny: 0,
    lifetime_api_usd: 0, lifetime_api_cny: 0,
    lifetime_combined_usd: 0, lifetime_combined_cny: 0,
    total_usd: 0, total_cny: 0,
  },
  by_source: [],
};

const SAMPLE_RECORD = {
  id: "spend-1",
  source: "claude",
  plan_label: "Max",
  amount: 10,
  currency: "USD",
  billing_cycle: "monthly",
  start_date: "2026-06-01",
  end_date: "",
  note: "manual",
  created_at: "2026-06-21T00:00:00.000Z",
  updated_at: "2026-06-21T00:00:00.000Z",
};

const VISIBLE_PROVIDERS = ["claude", "codex", "hermes"];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCurrency.mockReturnValue({ currency: "USD", rate: 1 });
  useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: VISIBLE_PROVIDERS });
  getLocalSettings.mockResolvedValue({ dashboardRefresh: { interval: "1m" } });
  setLocalSettings.mockResolvedValue({ ok: true });
  getUsageBounds.mockResolvedValue({
    ok: true,
    from: "2026-06-01",
    to: "2026-06-30",
    empty: false,
  });
  getSpendRecords.mockResolvedValue(EMPTY_RESULT);
  getSpendTimeseries.mockResolvedValue({
    sources: [],
    series: [],
    totals: { api_cost_usd: 0, api_cost_cny: 0, subscription_cost_usd: 0, subscription_cost_cny: 0, combined_usd: 0, combined_cny: 0 },
    by_source: [],
    bucket: "day",
    from: "2026-06-01",
    to: "2026-06-30",
    timezone: { tz: "UTC", tz_offset_minutes: 0 },
    currency: { base: "USD", usd_to_cny: 7.2 },
  });
  getRequestUsageRecords.mockImplementation(({ source }) => {
    const sourceSuffix = source ? `-${source}` : "";
    return Promise.resolve({
      records: [
        {
          id: `req-1${sourceSuffix}`,
          timestamp: "2026-06-24T01:10:00.000Z",
          agent: "Codex",
          model: "gpt-5",
          input_tokens: 2165,
          output_tokens: 1208,
          cached_input_tokens: 756864,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 760237,
          cost_usd: 0.004736,
          origin: "proxy",
        },
      ],
      totals: {
        input_tokens: 2165,
        output_tokens: 1208,
        cached_input_tokens: 756864,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 760237,
        cost_usd: 0.004736,
      },
      page: { total: 1, total_pages: 1, page: 1, pageSize: 10 },
    });
  });
  createSpendRecord.mockResolvedValue({ ok: true, record: SAMPLE_RECORD });
  deleteSpendRecord.mockResolvedValue(EMPTY_RESULT);
  updateSpendRecord.mockResolvedValue({ ok: true, record: SAMPLE_RECORD });
  getUsageSummary.mockResolvedValue({
    totals: {
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cached_input_tokens: 0,
      request_count: 0,
      cost_usd: 0,
      cache_hit_rate: 0,
    },
  });
  getProviderStats.mockResolvedValue({ providers: [] });
  getUsageAttribution.mockResolvedValue({ snapshots: [] });
  getLimitAccounts.mockResolvedValue({ accounts: [], forecasts: [] });
  getObservabilityExport.mockResolvedValue({ format: "json", content: "[]" });
  getModelStats.mockResolvedValue({ models: [] });
  getTokenPlans.mockResolvedValue({ records: [] });
  getConsoleSessions.mockResolvedValue({ sessions: [] });
  getApiBillingAccounts.mockResolvedValue({ accounts: [] });
  // 03-ia-api-balance: default empty provider API configs/balances.
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [] } });
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: null } });
});

// ---------------------------------------------------------------------------
// SpendUsagePage
// ---------------------------------------------------------------------------

describe("SpendUsagePage (v2.0 IA split)", () => {
  it("loads usage content with stats panel and summary cards", async () => {
    getSpendRecords.mockResolvedValue({
      records: [SAMPLE_RECORD],
      totals: { ...EMPTY_RESULT.totals, subscription_usd: 10, subscription_cny: 72, combined_usd: 10, combined_cny: 72, total_usd: 10, total_cny: 72 },
      by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
    });

    render(<SpendUsagePage />);

    expect(await screen.findByText("真实消耗 Tokens")).toBeInTheDocument();
    expect(await screen.findByText("本月订阅成本")).toBeInTheDocument();
  });

  it("does not fetch or display unrequested account quota and usage attribution panels", async () => {
    render(<SpendUsagePage />);

    await screen.findByText("真实消耗 Tokens");
    expect(getLimitAccounts).not.toHaveBeenCalled();
    expect(getUsageAttribution).not.toHaveBeenCalled();
    expect(screen.queryByText("账户配额")).not.toBeInTheDocument();
    expect(screen.queryByText("使用归因")).not.toBeInTheDocument();
  });

  it("displays monthly API, subscription, combined, and lifetime costs", async () => {
    getSpendRecords.mockResolvedValue({
      records: [SAMPLE_RECORD],
      totals: {
        subscription_usd: 10, subscription_cny: 72,
        api_usd: 5, api_cny: 36,
        combined_usd: 15, combined_cny: 108,
        lifetime_subscription_usd: 120, lifetime_subscription_cny: 864,
        lifetime_api_usd: 50, lifetime_api_cny: 360,
        lifetime_combined_usd: 170, lifetime_combined_cny: 1224,
        total_usd: 15, total_cny: 108,
      },
      by_source: [],
    });

    render(<SpendUsagePage />);

    expect(await screen.findByText("本月 API 成本")).toBeInTheDocument();
    expect(screen.getByText("本月订阅成本")).toBeInTheDocument();
    expect(screen.getByText("本月总成本")).toBeInTheDocument();
    expect(screen.getByText("累计总成本")).toBeInTheDocument();
  });

  it("loads adjacent natural months and renders the combined-cost comparison", async () => {
    getSpendRecords
      .mockResolvedValueOnce({
        ...EMPTY_RESULT,
        totals: {
          ...EMPTY_RESULT.totals,
          api_usd: 40,
          api_cny: 288,
          subscription_usd: 60,
          subscription_cny: 432,
          other_ai_usd: 20,
          other_ai_cny: 144,
          combined_usd: 120,
          combined_cny: 864,
          lifetime_combined_usd: 300,
          lifetime_combined_cny: 2160,
        },
      })
      .mockResolvedValueOnce({
        ...EMPTY_RESULT,
        totals: {
          ...EMPTY_RESULT.totals,
          api_usd: 20,
          api_cny: 144,
          subscription_usd: 50,
          subscription_cny: 360,
          combined_usd: 100,
          combined_cny: 720,
        },
      });

    render(<SpendUsagePage />);

    const comparisons = await screen.findAllByTestId("monthly-cost-comparison");
    expect(comparisons).toHaveLength(3);
    expect(comparisons[0]).toHaveTextContent("100.0%");
    expect(comparisons[1]).toHaveTextContent("20.0%");
    expect(comparisons[2]).toHaveTextContent("20.0%");
    for (const comparison of comparisons) {
      expect(comparison).toHaveAttribute("data-direction", "increase");
      expect(comparison.querySelector("svg")).toBeNull();
      expect(comparison.textContent).toBe(comparison.getAttribute("aria-label"));
    }
    expect(screen.getAllByTestId("monthly-cost-cny-row")).toHaveLength(3);
    expect(getSpendRecords).toHaveBeenCalledTimes(2);
    const [currentCall, previousCall] = getSpendRecords.mock.calls;
    expect(currentCall[0].from > previousCall[0].from).toBe(true);
    expect(currentCall[0].sources).toEqual(previousCall[0].sources);
    expect(currentCall[0]).not.toHaveProperty("timeZone");
    expect(currentCall[0]).not.toHaveProperty("tzOffsetMinutes");
  });

  it("hides totals from the previous financial scope while the new scope is pending or fails", async () => {
    const nextCurrent = deferred();
    const nextPrevious = deferred();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getSpendRecords
      .mockResolvedValueOnce({
        ...EMPTY_RESULT,
        totals: { ...EMPTY_RESULT.totals, combined_usd: 50, combined_cny: 360 },
      })
      .mockResolvedValueOnce({
        ...EMPTY_RESULT,
        totals: { ...EMPTY_RESULT.totals, combined_usd: 40, combined_cny: 288 },
      })
      .mockReturnValueOnce(nextCurrent.promise)
      .mockReturnValueOnce(nextPrevious.promise);

    const user = userEvent.setup();
    render(<SpendUsagePage />);
    expect(await screen.findByText("USD 50.00")).toBeInTheDocument();

    await act(async () => {
      await user.click(await screen.findByTitle("Claude Code"));
    });
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("USD 50.00")).not.toBeInTheDocument();

    await act(async () => {
      nextCurrent.reject(new Error("codex totals unavailable"));
      nextPrevious.resolve(EMPTY_RESULT);
      await Promise.allSettled([nextCurrent.promise, nextPrevious.promise]);
    });

    expect(screen.queryByText("USD 50.00")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("ignores a previous financial scope that resolves after the active scope", async () => {
    const oldCurrent = deferred();
    const oldPrevious = deferred();
    const nextCurrent = deferred();
    const nextPrevious = deferred();
    getSpendRecords
      .mockReturnValueOnce(oldCurrent.promise)
      .mockReturnValueOnce(oldPrevious.promise)
      .mockReturnValueOnce(nextCurrent.promise)
      .mockReturnValueOnce(nextPrevious.promise);

    const user = userEvent.setup();
    render(<SpendUsagePage />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledTimes(2));

    await act(async () => {
      await user.click(await screen.findByTitle("Codex"));
    });
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledTimes(4));

    await act(async () => {
      nextCurrent.resolve({
        ...EMPTY_RESULT,
        totals: { ...EMPTY_RESULT.totals, combined_usd: 20, combined_cny: 144 },
      });
      nextPrevious.resolve(EMPTY_RESULT);
      await Promise.all([nextCurrent.promise, nextPrevious.promise]);
    });
    expect(await screen.findByText("USD 20.00")).toBeInTheDocument();

    await act(async () => {
      oldCurrent.resolve({
        ...EMPTY_RESULT,
        totals: { ...EMPTY_RESULT.totals, combined_usd: 80, combined_cny: 576 },
      });
      oldPrevious.resolve(EMPTY_RESULT);
      await Promise.all([oldCurrent.promise, oldPrevious.promise]);
    });

    expect(screen.getByText("USD 20.00")).toBeInTheDocument();
    expect(screen.queryByText("USD 80.00")).not.toBeInTheDocument();
  });

  it("does NOT render the independent '按来源拆分' table", async () => {
    getSpendRecords.mockResolvedValue({
      records: [SAMPLE_RECORD],
      totals: { ...EMPTY_RESULT.totals },
      by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
    });

    render(<SpendUsagePage />);

    expect(await screen.findByText("真实消耗 Tokens")).toBeInTheDocument();
    expect(screen.queryByText("按来源拆分")).not.toBeInTheDocument();
    expect(screen.queryByText("订阅成本")).not.toBeInTheDocument();
  });

  it("does NOT render the top-level '使用统计 / 成本累积' Tab UI", async () => {
    render(<SpendUsagePage />);
    expect(await screen.findByText("真实消耗 Tokens")).toBeInTheDocument();
    // The old top-level tabs must not appear as toggle buttons.
    expect(screen.queryByRole("button", { name: "成本累积" })).not.toBeInTheDocument();
  });

  it("renders the cost summary inside the usage statistics panel", async () => {
    getSpendRecords.mockResolvedValue({
      records: [SAMPLE_RECORD],
      totals: {
        ...EMPTY_RESULT.totals,
        api_usd: 5,
        api_cny: 36,
        combined_usd: 15,
        combined_cny: 108,
        lifetime_combined_usd: 170,
        lifetime_combined_cny: 1224,
      },
      by_source: [],
    });

    render(<SpendUsagePage />);

    const costRow = await screen.findByTestId("usage-cost-summary");
    expect(within(costRow).getByText("USD 5.00")).toBeInTheDocument();
    expect(within(costRow).getByText("USD 170.00")).toBeInTheDocument();
    expect(screen.getAllByTestId("usage-cost-summary")).toHaveLength(1);
  });

  it("mirrors the selected AgentSwitcher agent in the real-token headline", async () => {
    const user = userEvent.setup();

    render(<SpendUsagePage />);

    const claudeButton = await screen.findByTitle("Claude Code");
    await act(async () => {
      await user.click(claudeButton);
    });

    const selectedAgent = await screen.findByTestId("usage-selected-agent");
    expect(selectedAgent).toHaveTextContent("Claude Code");
    await waitFor(() => {
      const latestFinancialCall = getSpendRecords.mock.calls.at(-1)?.[0];
      expect(latestFinancialCall?.sources).toEqual(["claude"]);
    });
  });

  it("does not mix other_ai into a selected service when it is the only visible provider", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: ["claude"] });
    const user = userEvent.setup();
    render(<SpendUsagePage />);

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledTimes(2));
    for (const [params] of getSpendRecords.mock.calls) {
      expect(params).not.toHaveProperty("sources");
    }
    await act(async () => {
      await user.click(await screen.findByTitle("Claude Code"));
    });

    await waitFor(() => {
      const latestFinancialCall = getSpendRecords.mock.calls.at(-1)?.[0];
      expect(latestFinancialCall?.sources).toEqual(["claude"]);
    });
  });

  it("initial load defers trend chart and request log until after first paint", async () => {
    render(<SpendUsagePage />);

    expect(getSpendTimeseries).not.toHaveBeenCalled();
    expect(getRequestUsageRecords).not.toHaveBeenCalled();
    expect(screen.queryByText(/正在加载趋势数据/)).not.toBeInTheDocument();
    expect(screen.queryByText(/正在加载请求记录/)).not.toBeInTheDocument();

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalled());
    await waitFor(() => expect(getRequestUsageRecords).toHaveBeenCalled());
  });

  it("range switching leaves natural-month finance totals unchanged", async () => {
    render(<SpendUsagePage />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    vi.clearAllMocks();

    const user = userEvent.setup();
    const timeTrigger = screen.getByRole("button", { name: "时间范围" });
    await act(async () => {
      await user.click(timeTrigger);
    });
    const sevenDayBtn = await screen.findByRole("button", { name: "7d" });
    await act(async () => {
      await user.click(sevenDayBtn);
    });

    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalled());
    expect(getSpendRecords).not.toHaveBeenCalled();
  });

  it("shows empty state when timeseries has no series", async () => {
    getSpendTimeseries.mockResolvedValue({
      sources: [],
      series: [],
      totals: { api_cost_usd: 0, api_cost_cny: 0, subscription_cost_usd: 0, subscription_cost_cny: 0, combined_usd: 0, combined_cny: 0 },
      by_source: [],
      bucket: "day",
      from: "2026-06-01",
      to: "2026-06-30",
      timezone: { tz: "UTC", tz_offset_minutes: 0 },
      currency: { base: "USD", usd_to_cny: 7.2 },
    });

    render(<SpendUsagePage />);
    await waitFor(() => expect(screen.getByText("暂无趋势数据")).toBeInTheDocument());
  });

  it("renders usage statistics and request/provider/model tabs", async () => {
    render(<SpendUsagePage />);
    expect(await screen.findByText("真实消耗 Tokens")).toBeInTheDocument();
    expect(screen.getByText("总请求数")).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "请求日志" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Provider 统计" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "模型统计" })).toBeInTheDocument();
    await waitFor(() => expect(getRequestUsageRecords).toHaveBeenCalled());
  });

  it("does not mount inactive provider/model detail tabs on initial load", async () => {
    render(<SpendUsagePage />);

    await waitFor(() => expect(getRequestUsageRecords).toHaveBeenCalled());

    // One call each is expected for the top filter dropdown metadata. Hidden
    // detail tabs must not add extra provider/model stats requests.
    expect(getProviderStats).toHaveBeenCalledTimes(1);
    expect(getProviderStats.mock.calls[0][0]?.sources).toEqual(VISIBLE_PROVIDERS);
    expect(getModelStats).toHaveBeenCalledTimes(1);
    expect(getModelStats.mock.calls[0][0]?.sources).toEqual(VISIBLE_PROVIDERS);
  });

  it("renders UsageTrendChartCard", async () => {
    getSpendTimeseries.mockResolvedValue({
      sources: ["claude"],
      series: [
        {
          bucket_start: "2026-06-01",
          label: "06-01",
          source: "claude",
          input_tokens: 1000,
          output_tokens: 500,
          cached_input_tokens: 200,
          cache_creation_input_tokens: 100,
          cost_usd: 0.05,
        },
      ],
      totals: { api_cost_usd: 0.05, api_cost_cny: 0.36, subscription_cost_usd: 0, subscription_cost_cny: 0, combined_usd: 0.05, combined_cny: 0.36 },
      by_source: [],
      bucket: "day",
      from: "2026-06-01",
      to: "2026-06-01",
      timezone: { tz: "UTC", tz_offset_minutes: 0 },
      currency: { base: "USD", usd_to_cny: 7.2 },
    });

    render(<SpendUsagePage />);
    await waitFor(() => expect(screen.getByRole("img", { name: "使用趋势图" })).toBeInTheDocument());
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.queryByText(/1970-01-01/)).not.toBeInTheDocument();
  });

  it("places a compact paginated Token service list beside the usage trend", async () => {
    getSpendTimeseries.mockResolvedValue({
      sources: ["codex"],
      series: [
        {
          bucket_start: "2026-07-20",
          label: "07-20",
          source: "codex",
          input_tokens: 1_000,
          output_tokens: 500,
          cached_input_tokens: 200,
          cache_creation_input_tokens: 100,
          cost_usd: 0.05,
        },
      ],
      totals: { api_cost_usd: 0.05, api_cost_cny: 0.36, subscription_cost_usd: 0, subscription_cost_cny: 0, combined_usd: 0.05, combined_cny: 0.36 },
      by_source: [],
      bucket: "day",
      from: "2026-07-20",
      to: "2026-07-20",
      timezone: { tz: "UTC", tz_offset_minutes: 0 },
      currency: { base: "USD", usd_to_cny: 7.2 },
    });
    getTokenPlans.mockResolvedValue({
      records: Array.from({ length: 6 }, (_, index) => ({
        id: `plan-${index + 1}`,
        source: `source-${index + 1}`,
        plan_label: `套餐 ${index + 1}`,
        total_quota: 1_000,
        used_quota: 900 - index * 100,
        remaining_quota: 100 + index * 100,
        quota_unit: "tokens",
        expires_at: "2099-12-31",
      })),
    });

    render(<SpendUsagePage />);

    const layout = await screen.findByTestId("usage-chart-token-services-layout");
    expect(within(layout).getByText("Token 服务列表")).toBeInTheDocument();
    expect(within(layout).getAllByTestId("token-service-row")).toHaveLength(5);
    expect(layout).toHaveClass("lg:items-stretch");
    expect(layout).toHaveClass("lg:grid-cols-[minmax(0,1fr)_17rem]");
    expect(within(layout).getByTestId("token-service-list")).toHaveClass("h-full");
    expect(await within(layout).findByTestId("usage-trend-plot")).toHaveClass("flex-1");
    expect(getTokenPlans).toHaveBeenCalledTimes(1);
  });

  it("provider tab renders ProviderUsageTable with hook data", async () => {
    const user = userEvent.setup();
    getProviderStats.mockResolvedValue({
      providers: [
        {
          source: "claude",
          source_display_name: "Claude (Session)",
          request_count: 10,
          tokens: 1000,
          cost_usd: 0.5,
          success_rate: 100,
          avg_latency_ms: 200,
        },
      ],
    });

    render(<SpendUsagePage />);
    const providerTab = await screen.findByRole("tab", { name: "Provider 统计" });
    await act(async () => {
      await user.click(providerTab);
    });
    await waitFor(() => expect(screen.getByText("Claude (Session)")).toBeInTheDocument());
  });

  it("model tab renders ModelUsageTable with hook data", async () => {
    const user = userEvent.setup();
    getModelStats.mockResolvedValue({
      models: [
        {
          model: "claude-3-opus",
          source: "claude",
          source_display_name: "Claude",
          request_count: 10,
          tokens: 1000,
          cost_usd: 0.5,
          success_rate: 100,
          avg_latency_ms: 200,
        },
      ],
    });

    render(<SpendUsagePage />);
    const modelTab = await screen.findByRole("tab", { name: "模型统计" });
    await act(async () => {
      await user.click(modelTab);
    });
    await waitFor(() => expect(screen.getByText("claude-3-opus")).toBeInTheDocument());
  });

  it("omits the financial source filter for the default all-ledger view", async () => {
    render(<SpendUsagePage />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls).toHaveLength(2);
    for (const [params] of getSpendRecords.mock.calls) {
      expect(params).not.toHaveProperty("sources");
    }
  });

  it("still loads all-ledger financial totals when no Token provider is visible", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: [] });

    render(<SpendUsagePage />);

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]).not.toHaveProperty("sources");
  });

  it("scopes usage totals to providers enabled in Limits display", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: ["claude"] });
    render(<SpendUsagePage />);
    await waitFor(() => expect(getUsageSummary).toHaveBeenCalled());
    const callArgs = getUsageSummary.mock.calls[0][0];
    expect(callArgs?.sources).toEqual(["claude"]);
  });

  it("scopes provider statistics to providers enabled in Limits display", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: ["claude"] });
    const user = userEvent.setup();
    render(<SpendUsagePage />);
    const providerTab = await screen.findByRole("tab", { name: "Provider 统计" });
    await act(async () => {
      await user.click(providerTab);
    });
    await waitFor(() => expect(getProviderStats).toHaveBeenCalled());
    const callArgs = getProviderStats.mock.calls[0][0];
    expect(callArgs?.sources).toEqual(["claude"]);
  });

  it("shows no usage statistics when no provider is enabled in Limits display", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: [] });
    render(<SpendUsagePage />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]).not.toHaveProperty("sources");
    expect(getUsageSummary).not.toHaveBeenCalled();
    expect(getProviderStats).not.toHaveBeenCalled();
    expect(getModelStats).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SpendCostPage
// ---------------------------------------------------------------------------

describe("SpendCostPage (v2.0 IA split)", () => {
  it("uses local month boundaries across the complete financial ledger", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(2));
    for (const [params] of getSpendTimeseries.mock.calls) {
      expect(params).toHaveProperty("timeZone");
      expect(params).toHaveProperty("tzOffsetMinutes");
      expect(params).toHaveProperty("sources", ["claude", "codex", "hermes", "other_ai"]);
    }
  });

  it("changes only the independent cost month and reloads the selected historical ledger", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    const picker = await screen.findByLabelText("选择成本月份");
    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(2));
    fireEvent.change(picker, { target: { value: "2025-06" } });

    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalledTimes(4));
    expect(getSpendTimeseries).toHaveBeenNthCalledWith(3, expect.objectContaining({
      from: "2025-06-01",
      to: "2025-06-30",
    }));
    expect(getSpendTimeseries).toHaveBeenNthCalledWith(4, expect.objectContaining({
      from: "2025-05-01",
      to: "2025-05-31",
    }));
    expect(getSpendRecords).toHaveBeenLastCalledWith(expect.objectContaining({
      summary_month: "2025-06",
    }));
  });

  it("renders cost accumulation with token packages and API billing", async () => {
    getTokenPlans.mockResolvedValue({
      records: [
        {
          id: "plan-1",
          source: "claude",
          plan_label: "Pro 套餐",
          total_quota: 1000000,
          used_quota: 500000,
          remaining_quota: 500000,
          quota_unit: "tokens",
          expires_at: "2026-12-31",
          sync_status: "synced",
        },
      ],
    });
    getApiBillingAccounts.mockResolvedValue({
      accounts: [
        {
          provider: "openai",
          accountName: "OpenAI API",
          billingSource: "api",
          monthCostUsd: 15.5,
          lifetimeCostUsd: 120.0,
          status: "synced",
          lastSyncedAt: "2026-06-29T10:00:00.000Z",
        },
      ],
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Token 套餐")).toBeInTheDocument();
    expect(screen.getByText("API 计费")).toBeInTheDocument();
    expect(screen.getByText("Pro 套餐")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API")).toBeInTheDocument();
    expect(getTokenPlans).toHaveBeenCalled();
    expect(getApiBillingAccounts).toHaveBeenCalled();
  });

  it("shows an explicit unavailable state for cost when no billing data is connected", async () => {
    getApiBillingAccounts.mockResolvedValue({
      accounts: [
        {
          provider: "anthropic",
          accountName: "Anthropic",
          billingSource: "api",
          monthCostUsd: 0,
          lifetimeCostUsd: 0,
          status: "not-connected",
          lastSyncedAt: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
    expect(screen.getAllByText("未提供字段").length).toBeGreaterThan(0);
    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });

  it("initial load calls getApiBillingAccounts for cost accumulation data", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getApiBillingAccounts).toHaveBeenCalled());
  });

  it("keeps the cost page available for other_ai when no provider is visible", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: [] });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Token 套餐")).toBeInTheDocument();
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]?.sources).toEqual(["other_ai"]);
  });

  it("does NOT render the top-level '使用统计 / 成本累积' Tab UI", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Token 套餐")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用统计" })).not.toBeInTheDocument();
  });

  it("does NOT render the independent '按来源拆分' table", async () => {
    getSpendRecords.mockResolvedValue({
      records: [],
      totals: { ...EMPTY_RESULT.totals },
      by_source: [{ source: "claude", subscription_usd: 10, subscription_cny: 72, api_usd: 0, api_cny: 0, combined_usd: 10, combined_cny: 72 }],
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Token 套餐")).toBeInTheDocument();
    expect(screen.queryByText("按来源拆分")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 03-ia-api-balance: provider API account section + subscription CRUD
  // -------------------------------------------------------------------------

  it("renders the 供应商账户 section and calls provider API balance endpoints on mount", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: {
        configs: [
          {
            id: "cfg-1",
            providerId: "openai",
            label: "OpenAI 主账户",
            enabled: true,
            apiKeyRef: "ref-1",
            refreshIntervalSeconds: 300,
          },
        ],
      },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: {
        balances: [
          {
            configId: "cfg-1",
            providerId: "openai",
            accountLabel: "OpenAI 主账户",
            balance: 125.5,
            monthSpend: 32.1,
            lifetimeSpend: 480.0,
            currency: "USD",
            status: "synced",
            lastSyncedAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("供应商账户")).toBeInTheDocument();
    // Balance card shows provider + financial data from 02 endpoints.
    expect(screen.getByText("OpenAI 主账户")).toBeInTheDocument();
    expect(screen.getByText(/125\.50/)).toBeInTheDocument();
    // mount triggers an immediate refresh of enabled+keyed configs.
    await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-1"));
  });

  it("shows an explicit unavailable state for balance and spend fields when status is not-connected", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: {
        configs: [
          { id: "cfg-2", providerId: "anthropic", label: "Anthropic", enabled: true, apiKeyRef: "ref-2", refreshIntervalSeconds: 300 },
        ],
      },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: {
        balances: [
          {
            configId: "cfg-2",
            providerId: "anthropic",
            accountLabel: "Anthropic",
            balance: null,
            monthSpend: null,
            lifetimeSpend: null,
            currency: null,
            status: "not-connected",
            lastSyncedAt: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
    // The status badge text for not-connected.
    expect(screen.getByText("未连接")).toBeInTheDocument();
    expect(screen.getAllByText("未提供字段").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });

  it("shows an explicit unavailable state for financial values when status is error", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: {
        configs: [
          { id: "cfg-3", providerId: "kimi", label: "Kimi 账户", enabled: true, apiKeyRef: "ref-3", refreshIntervalSeconds: 300 },
        ],
      },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: {
        balances: [
          {
            configId: "cfg-3",
            providerId: "kimi",
            accountLabel: "Kimi 账户",
            balance: null,
            monthSpend: null,
            lifetimeSpend: null,
            currency: null,
            status: "error",
            lastSyncedAt: null,
            errorMessage: "请求超时",
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Kimi 账户")).toBeInTheDocument();
    expect(screen.getByText("同步错误")).toBeInTheDocument();
    // The actionable error message renders.
    expect(screen.getByText("请求超时")).toBeInTheDocument();
    expect(screen.getAllByText("未提供字段").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });

  it("does NOT render any API Key input on /spend/cost (keys only in settings)", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    await screen.findByText("Token 套餐");
    // No password inputs and no api key labeled inputs anywhere on the cost page.
    const passwordInputs = screen.queryAllByLabelText(/api.?key/i);
    expect(passwordInputs).toHaveLength(0);
    const typePassword = document.querySelectorAll('input[type="password"]');
    expect(typePassword).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// 03-ia-api-balance: /spend/usage must NOT call provider balance endpoints
// ---------------------------------------------------------------------------

describe("SpendUsagePage does not call provider balance endpoints (03 work order)", () => {
  it("/spend/usage does NOT call getProviderApiConfigs / getProviderApiBalances / refreshProviderApiBalance", async () => {
    render(<SpendUsagePage />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    // Allow the page to settle all mount effects.
    await waitFor(() => expect(getUsageSummary).toHaveBeenCalled());
    expect(getProviderApiConfigs).not.toHaveBeenCalled();
    expect(getProviderApiBalances).not.toHaveBeenCalled();
    expect(refreshProviderApiBalance).not.toHaveBeenCalled();
  });
});
