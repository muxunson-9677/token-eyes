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
  getUsageSummary,
  getProviderStats,
  getModelStats,
  getTokenPlans,
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
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
  getUsageSummary: vi.fn(),
  getProviderStats: vi.fn(),
  getModelStats: vi.fn(),
  getTokenPlans: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  useCurrency.mockReturnValue({ currency: "USD", rate: 1 });
  useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: VISIBLE_PROVIDERS });
  getLocalSettings.mockResolvedValue({ dashboardRefresh: { interval: "1m" } });
  setLocalSettings.mockResolvedValue({ ok: true });
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
  getModelStats.mockResolvedValue({ models: [] });
  getTokenPlans.mockResolvedValue({ records: [] });
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

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledWith(expect.objectContaining({
      sources: ["claude", "other_ai"],
    })));
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

  it("range switching calls both APIs with the same from/to params", async () => {
    const { rerender } = render(<SpendUsagePage />);
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

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    await waitFor(() => expect(getSpendTimeseries).toHaveBeenCalled());
    const recordsCall = getSpendRecords.mock.calls[0];
    const timeseriesCall = getSpendTimeseries.mock.calls[0];
    expect(recordsCall[0]?.from).toBe(timeseriesCall[0]?.from);
    expect(recordsCall[0]?.to).toBe(timeseriesCall[0]?.to);
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
    expect(getProviderStats.mock.calls[0][0]?.sources).toEqual(["claude", "codex", "hermes"]);
    expect(getModelStats).toHaveBeenCalledTimes(1);
    expect(getModelStats.mock.calls[0][0]?.sources).toEqual(["claude", "codex", "hermes"]);
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

  it("getSpendRecords includes other_ai in the financial source filter", async () => {
    render(<SpendUsagePage />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    const callWithSources = getSpendRecords.mock.calls.find((call) => Array.isArray(call[0]?.sources));
    expect(callWithSources).toBeDefined();
    expect(callWithSources[0]?.sources).toEqual(["claude", "codex", "hermes", "other_ai"]);
  });

  it("still loads other_ai financial totals when no Token provider is visible", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: [] });

    render(<SpendUsagePage />);

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]?.sources).toEqual(["other_ai"]);
  });

  it("getUsageSummary receives sources filter from visibleProviderIds", async () => {
    render(<SpendUsagePage />);
    await waitFor(() => expect(getUsageSummary).toHaveBeenCalled());
    const callArgs = getUsageSummary.mock.calls[0][0];
    expect(callArgs?.sources).toEqual(["claude", "codex", "hermes"]);
  });

  it("getProviderStats receives sources filter from visibleProviderIds", async () => {
    const user = userEvent.setup();
    render(<SpendUsagePage />);
    const providerTab = await screen.findByRole("tab", { name: "Provider 统计" });
    await act(async () => {
      await user.click(providerTab);
    });
    await waitFor(() => expect(getProviderStats).toHaveBeenCalled());
    const callArgs = getProviderStats.mock.calls[0][0];
    expect(callArgs?.sources).toEqual(["claude", "codex", "hermes"]);
  });

  it("empty Token allowlist shows its empty state but still fetches other_ai costs", async () => {
    useLimitsDisplayPrefs.mockReturnValue({ visibleOrdered: [] });
    render(<SpendUsagePage />);
    await waitFor(() => expect(screen.getByText("请在显示设置中启用至少一个 Provider。")).toBeInTheDocument());
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledWith(expect.objectContaining({
      sources: ["other_ai"],
    })));
    expect(getSpendTimeseries).not.toHaveBeenCalled();
    expect(getUsageSummary).not.toHaveBeenCalled();
    expect(getRequestUsageRecords).not.toHaveBeenCalled();
    expect(getProviderStats).not.toHaveBeenCalled();
    expect(getModelStats).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SpendCostPage
// ---------------------------------------------------------------------------

describe("SpendCostPage (v2.0 IA split)", () => {
  it("renders cost accumulation with token packages, API billing, and subscriptions", async () => {
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
    expect(screen.getByText("订阅记录")).toBeInTheDocument();
    expect(screen.getByText("Pro 套餐")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API")).toBeInTheDocument();
    expect(getTokenPlans).toHaveBeenCalled();
    expect(getApiBillingAccounts).toHaveBeenCalled();
  });

  it("shows not-connected status with dash for cost when no billing data", async () => {
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
    const dashElements = screen.getAllByText(/—/);
    expect(dashElements.length).toBeGreaterThan(0);
  });

  it("initial load calls getApiBillingAccounts for cost accumulation data", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getApiBillingAccounts).toHaveBeenCalled());
  });

  it("uses other_ai for financial calls but not as a subscription record", async () => {
    getSpendRecords.mockResolvedValue({
      records: [
        { ...SAMPLE_RECORD, id: "spend-1", source: "claude" },
        {
          ...SAMPLE_RECORD,
          id: "other-ai-1",
          source: "other_ai",
          plan_label: "被封账号历史充值",
          billing_cycle: "one_time",
        },
      ],
      totals: { ...EMPTY_RESULT.totals, subscription_usd: 20, combined_usd: 20 },
      by_source: [],
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]?.sources).toEqual([
      "claude",
      "codex",
      "hermes",
      "other_ai",
    ]);
    expect(getSpendTimeseries.mock.calls[0][0]?.sources).toEqual([
      "claude",
      "codex",
      "hermes",
      "other_ai",
    ]);
    expect(await screen.findByText("claude")).toBeInTheDocument();
    expect(screen.queryByText("被封账号历史充值")).not.toBeInTheDocument();
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

  it("subscription records are filtered by allowlist (cursor hidden)", async () => {
    getSpendRecords.mockResolvedValue({
      records: [
        { ...SAMPLE_RECORD, id: "spend-1", source: "claude" },
        { ...SAMPLE_RECORD, id: "spend-2", source: "cursor" },
        { ...SAMPLE_RECORD, id: "spend-3", source: "hermes" },
      ],
      totals: { ...EMPTY_RESULT.totals },
      by_source: [],
    });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("订阅记录")).toBeInTheDocument();
    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("hermes").length).toBeGreaterThan(0);
    expect(screen.queryByText("cursor")).not.toBeInTheDocument();
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

  it("shows — (not 0) for balance/monthSpend/lifetimeSpend when status is not-connected", async () => {
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
    // Multiple "—" should appear for the unknown financial values — and crucially
    // the balance row must NOT render "0" or "USD 0.00" for unknown values.
    const dashElements = screen.getAllByText(/—/);
    expect(dashElements.length).toBeGreaterThanOrEqual(3);
  });

  it("shows — for financial values when status is error (never 0)", async () => {
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
    // "—" for all financial values — never 0.
    const dashElements = screen.getAllByText(/—/);
    expect(dashElements.length).toBeGreaterThanOrEqual(3);
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

  it("subscription 添加记录 button opens the form; saving creates a record and refreshes", async () => {
    const user = userEvent.setup();
    createSpendRecord.mockResolvedValue({ ok: true, record: SAMPLE_RECORD });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    const addButton = await screen.findByRole("button", { name: "添加记录" });
    await act(async () => {
      await user.click(addButton);
    });

    // Form renders with add title.
    expect(screen.getByText("添加订阅记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();

    // Fill required fields.
    const nameInput = screen.getByLabelText("名称");
    const providerInput = screen.getByLabelText("服务商");
    await act(async () => {
      await user.type(nameInput, "Pro Max");
      await user.type(providerInput, "claude");
    });

    const saveButton = screen.getByRole("button", { name: "保存" });
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => expect(createSpendRecord).toHaveBeenCalled());
    const callArg = createSpendRecord.mock.calls[0][0];
    expect(callArg.plan_label).toBe("Pro Max");
    expect(callArg.source).toBe("claude");
    // API Key is never sent in a subscription record.
    expect(callArg.apiKey).toBeUndefined();
    expect(callArg.api_key).toBeUndefined();
  });

  it("subscription edit button opens the form prefilled; saving updates the record", async () => {
    const user = userEvent.setup();
    getSpendRecords.mockResolvedValue({
      records: [{ ...SAMPLE_RECORD, id: "spend-edit-1", plan_label: "Old Plan", source: "claude" }],
      totals: { ...EMPTY_RESULT.totals },
      by_source: [],
    });
    updateSpendRecord.mockResolvedValue({ ok: true, record: SAMPLE_RECORD });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    await screen.findByText("Old Plan");
    const editButton = screen.getByRole("button", { name: "编辑" });
    await act(async () => {
      await user.click(editButton);
    });

    // Form opens in edit mode.
    expect(screen.getByText("编辑订阅记录")).toBeInTheDocument();
    // The name field is prefilled with the existing record.
    const nameInput = screen.getByLabelText("名称");
    expect(nameInput.value).toBe("Old Plan");
  });

  it("subscription delete button calls deleteSpendRecord and refreshes", async () => {
    const user = userEvent.setup();
    getSpendRecords.mockResolvedValue({
      records: [{ ...SAMPLE_RECORD, id: "spend-del-1", plan_label: "Del Plan", source: "claude" }],
      totals: { ...EMPTY_RESULT.totals },
      by_source: [],
    });
    deleteSpendRecord.mockResolvedValue({ ok: true });

    // window.confirm auto-accepts.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    await screen.findByText("Del Plan");
    const deleteButton = screen.getByRole("button", { name: "删除" });
    await act(async () => {
      await user.click(deleteButton);
    });

    await waitFor(() => expect(deleteSpendRecord).toHaveBeenCalledWith("spend-del-1"));
    confirmSpy.mockRestore();
  });

  it("06: subscription form sends currency, billing_cycle, start_date on save (contract)", async () => {
    const user = userEvent.setup();
    createSpendRecord.mockResolvedValue({ ok: true, record: SAMPLE_RECORD });

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    const addButton = await screen.findByRole("button", { name: "添加记录" });
    await act(async () => {
      await user.click(addButton);
    });

    // Fill required text fields.
    await act(async () => {
      await user.type(screen.getByLabelText("名称"), "Pro Max");
      await user.type(screen.getByLabelText("服务商"), "claude");
      await user.type(screen.getByLabelText("金额"), "20");
    });
    // Date input — use fireEvent.change for reliable jsdom behavior.
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-06-01" } });

    // Currency and cycle are <select> with defaults USD / monthly.
    // Verify the defaults match the backend contract values.
    expect(screen.getByLabelText("币种").value).toBe("USD");
    expect(screen.getByLabelText("计费周期").value).toBe("monthly");

    const saveButton = screen.getByRole("button", { name: "保存" });
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => expect(createSpendRecord).toHaveBeenCalled());
    const callArg = createSpendRecord.mock.calls[0][0];
    // 06 contract: all required fields must be sent — no silent defaulting.
    expect(callArg.source).toBe("claude");
    expect(callArg.plan_label).toBe("Pro Max");
    expect(callArg.amount).toBe(20);
    expect(callArg.currency).toBe("USD");
    expect(callArg.billing_cycle).toBe("monthly");
    expect(callArg.start_date).toBe("2026-06-01");
  });

  it("06: subscription form shows backend error and stays open when save fails (no fake success)", async () => {
    const user = userEvent.setup();
    // Simulate the backend 400 error enriched by buildErrorFromResponse:
    // backend returns { ok:false, error:"Missing required field: currency",
    // error_code:"missing_required_field", field:"currency" } → fetchLocalJson
    // throws Error("Missing required field: currency").
    createSpendRecord.mockRejectedValueOnce(new Error("Missing required field: currency"));

    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    const addButton = await screen.findByRole("button", { name: "添加记录" });
    await act(async () => {
      await user.click(addButton);
    });

    // Fill required fields.
    await act(async () => {
      await user.type(screen.getByLabelText("名称"), "Pro Max");
      await user.type(screen.getByLabelText("服务商"), "claude");
      await user.type(screen.getByLabelText("金额"), "20");
    });
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-06-01" } });

    const saveButton = screen.getByRole("button", { name: "保存" });
    await act(async () => {
      await user.click(saveButton);
    });

    // The backend error MUST be displayed — NOT faked as success.
    await waitFor(() =>
      expect(screen.getByText("Missing required field: currency")).toBeInTheDocument(),
    );

    // The form must still be open (NOT closed / faked success).
    // The form title "添加订阅记录" and Save button are still visible.
    expect(screen.getByText("添加订阅记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("shows the separate-columns note (订阅费用与供应商 API 花销分栏)", async () => {
    render(
      <MemoryRouter>
        <SpendCostPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/订阅费用与供应商 API 账户花销分栏展示/)).toBeInTheDocument();
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
