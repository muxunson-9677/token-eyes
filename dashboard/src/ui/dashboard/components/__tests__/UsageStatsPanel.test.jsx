import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import { UsageStatsPanel } from "../UsageStatsPanel.jsx";

// Ticket-02 F: UsageStatsPanel is a pure presentational component. All its
// copy keys are ticket02.stats.* which resolve to the zh-CN CSV fallback in
// any locale, so we pin zh-CN for determinism and assert the wired strings +
// the data-derived formatted numbers (formatChineseTokenCount /
// normalizeHitRate / formatCost).

describe("UsageStatsPanel", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("renders Chinese token units, 4 dimension cards and 3 right cards when summary.totals present", () => {
    render(
      <UsageStatsPanel
        summary={{
          totals: {
            total_tokens: 643308077,
            input_tokens: 55193000,
            output_tokens: 2358000,
            cache_creation_input_tokens: 0,
            cached_input_tokens: 586000000,
            request_count: 5634,
            cost_usd: 228.0715,
            cache_hit_rate: 0.914,
          },
        }}
      />,
    );

    // Main metric uses one Chinese-unit value instead of a duplicated raw/approx pair.
    expect(screen.getByText("真实消耗 Tokens")).toBeInTheDocument();
    expect(screen.getByText("6.43亿")).toBeInTheDocument();
    expect(screen.queryByText("643,308,077")).not.toBeInTheDocument();

    // 4 dimension card labels
    expect(screen.getByText("新增输入")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("创建")).toBeInTheDocument();
    expect(screen.getByText("命中")).toBeInTheDocument();
    expect(screen.getByText("5.52千万")).toBeInTheDocument();

    // Right-side cards
    expect(screen.getByText("总请求数")).toBeInTheDocument();
    expect(screen.getByText("5,634")).toBeInTheDocument();
    expect(screen.getByText("总成本")).toBeInTheDocument();
    expect(screen.getByText("$228.07")).toBeInTheDocument();
    expect(screen.getByText("缓存命中率")).toBeInTheDocument();
    expect(screen.getByText("91.4%")).toBeInTheDocument();
  });

  it("falls back to summary.summary when totals is absent", () => {
    render(
      <UsageStatsPanel
        summary={{
          summary: {
            total_tokens: 1000,
            request_count: 10,
            cost_usd: 1,
            cache_hit_rate: 0.5,
          },
        }}
      />,
    );

    // summary?.totals is undefined → falls back to summary.summary
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("uses conversation_count as request display fallback for aggregate-only summaries", () => {
    render(
      <UsageStatsPanel
        summary={{
          totals: {
            total_tokens: 1700,
            conversation_count: 1193,
            request_count: null,
            cost_usd: 1,
          },
        }}
      />,
    );

    expect(screen.getByText("1,193")).toBeInTheDocument();
  });

  it("renders the selected agent identity beside the real-token label", () => {
    render(
      <UsageStatsPanel
        summary={{
          totals: {
            total_tokens: 400972476,
          },
        }}
        selectedAgent={{ displayName: "Claude Code", queueSource: "claude" }}
      />,
    );

    const selectedAgent = screen.getByTestId("usage-selected-agent");
    expect(selectedAgent).toHaveTextContent("Claude Code");
    expect(screen.getByText("4.01亿")).toBeInTheDocument();
  });

  it("renders compact cost summaries in the same responsive four-column rhythm", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{
          api_usd: 5,
          api_cny: 36,
          subscription_usd: 10,
          subscription_cny: 72,
          combined_usd: 15,
          combined_cny: 108,
          lifetime_combined_usd: 170,
          lifetime_combined_cny: 1224,
        }}
      />,
    );

    const row = screen.getByTestId("usage-cost-summary");
    expect(row).toHaveClass("grid-cols-2", "sm:grid-cols-4");
    expect(within(row).getByText("USD 5.00")).toBeInTheDocument();
    expect(within(row).getByText("CNY 36.00")).toBeInTheDocument();
    expect(within(row).getByText("USD 170.00")).toBeInTheDocument();
  });

  it("keeps missing cost values distinct from genuine zero values", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{
          api_usd: null,
          api_cny: null,
          subscription_usd: 0,
          subscription_cny: 0,
          combined_usd: 0,
          combined_cny: 0,
          lifetime_combined_usd: 0,
          lifetime_combined_cny: 0,
        }}
      />,
    );

    const row = screen.getByTestId("usage-cost-summary");
    expect(within(row).getAllByText("—")).toHaveLength(2);
    expect(within(row).getAllByText("USD 0.00").length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    { current: 120, previous: 100, expected: "较上月新增 20.0%", expectedClass: "text-green-600" },
    { current: 80, previous: 100, expected: "较上月减少 20.0%", expectedClass: "text-green-600" },
    { current: 100, previous: 100, expected: "与上月持平", expectedClass: "text-oai-gray-400" },
    { current: 15, previous: 0, expected: "上月无基数", expectedClass: "text-green-600" },
    { current: 0, previous: 0, expected: "与上月持平", expectedClass: "text-oai-gray-400" },
  ])("renders the monthly total comparison without invalid zero-base percentages", ({ current, previous, expected, expectedClass }) => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{
          api_usd: 0,
          api_cny: 0,
          subscription_usd: 0,
          subscription_cny: 0,
          combined_usd: current,
          combined_cny: current * 7.2,
          previous_combined_usd: previous,
          previous_combined_cny: previous * 7.2,
          lifetime_combined_usd: current,
          lifetime_combined_cny: current * 7.2,
        }}
      />,
    );

    const comparison = screen.getByTestId("monthly-cost-comparison");
    expect(comparison).toHaveTextContent(expected);
    expect(comparison).toHaveClass(expectedClass);
    expect(comparison.parentElement).toHaveAttribute("data-testid", "monthly-cost-cny-row");
    expect(screen.queryByTestId("monthly-cost-heading-row")).not.toBeInTheDocument();
  });

  it("shows API, subscription and total month comparisons beside CNY", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{
          api_usd: 120,
          api_cny: 864,
          previous_api_usd: 100,
          subscription_usd: 80,
          subscription_cny: 576,
          previous_subscription_usd: 100,
          combined_usd: 200,
          combined_cny: 1440,
          previous_combined_usd: 200,
          lifetime_combined_usd: 500,
          lifetime_combined_cny: 3600,
        }}
      />,
    );

    const comparisons = screen.getAllByTestId("monthly-cost-comparison");
    expect(comparisons).toHaveLength(3);
    expect(comparisons[0]).toHaveTextContent("20.0%");
    expect(comparisons[1]).toHaveTextContent("20.0%");
    expect(comparisons[2]).toHaveTextContent("持平");
    expect(screen.getAllByTestId("monthly-cost-cny-row")).toHaveLength(3);
    expect(comparisons[0]).toHaveClass("text-green-600");
    expect(comparisons[1]).toHaveClass("text-green-600");
  });

  it("uses each installed-ledger bucket and renders delta rather than current/previous ratio", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{
          api_usd: 6603.138389,
          api_cny: 47542.596401,
          previous_api_usd: 463.393724,
          subscription_usd: 0,
          subscription_cny: 0,
          previous_subscription_usd: 0,
          combined_usd: 6749.666167,
          combined_cny: 48597.596401,
          previous_combined_usd: 472.143724,
          lifetime_combined_usd: 8637.381556,
          lifetime_combined_cny: 62189.147203,
        }}
      />,
    );

    const comparisons = screen.getAllByTestId("monthly-cost-comparison");
    expect(comparisons).toHaveLength(3);
    expect(comparisons[0]).toHaveTextContent("上月同期基数较低");
    expect(comparisons[1]).toHaveTextContent("与上月持平");
    expect(comparisons[2]).toHaveTextContent("上月同期基数较低");
    expect(screen.queryByText("较上月新增 1425.0%")).not.toBeInTheDocument();
  });

  it("keeps existing stats visible while refreshing", () => {
    render(<UsageStatsPanel summary={{ totals: { total_tokens: 1 } }} loading={true} />);

    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
    expect(screen.getByText("真实消耗 Tokens")).toBeInTheDocument();
  });

  it("shows error text when error is non-null", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        error="boom"
      />,
    );

    expect(screen.getByText("统计数据加载失败")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders empty state when summary is null", () => {
    render(<UsageStatsPanel summary={null} />);

    // The !totals branch currently reuses the loading copy text.
    expect(screen.getByText("加载中")).toBeInTheDocument();
  });

  it("formats totals below 1e8 with Chinese units", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 55193000 } }}
      />,
    );

    expect(screen.getByText("5.52千万")).toBeInTheDocument();
  });

  it("normalizes cache_hit_rate from both 0-1 ratio and 0-100 percent", () => {
    const { unmount } = render(
      <UsageStatsPanel summary={{ totals: { total_tokens: 1, cache_hit_rate: 0.914 } }} />,
    );
    expect(screen.getByText("91.4%")).toBeInTheDocument();
    unmount();

    render(
      <UsageStatsPanel summary={{ totals: { total_tokens: 1, cache_hit_rate: 91.4 } }} />,
    );
    expect(screen.getByText("91.4%")).toBeInTheDocument();
  });
});
