import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it.each(["light", "dark"])(
    "keeps the complete glass statistics hierarchy and content in %s theme",
    (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      const { container } = render(
        <UsageStatsPanel
          summary={{
            totals: {
              total_tokens: 643308077,
              input_tokens: 55193000,
              output_tokens: 2358000,
              cache_creation_input_tokens: 1200,
              cached_input_tokens: 586000000,
              request_count: 5634,
              cost_usd: 228.0715,
              cache_hit_rate: 0.914,
            },
          }}
          costSummary={{
            api_usd: 120,
            api_cny: 864,
            previous_api_usd: 100,
            subscription_usd: 80,
            subscription_cny: 576,
            previous_subscription_usd: null,
            combined_usd: 200,
            combined_cny: 1440,
            previous_combined_usd: 200,
            lifetime_combined_usd: 500,
            lifetime_combined_cny: 3600,
          }}
        />,
      );

      const layout = screen.getByTestId("usage-stats-layout");
      expect(layout).toHaveClass("min-w-0");
      expect(layout).not.toHaveClass("overflow-hidden", "overflow-x-auto", "overflow-y-auto");

      const dimensionCards = screen.getAllByTestId("usage-dimension-card");
      expect(dimensionCards).toHaveLength(4);
      for (const card of dimensionCards) {
        expect(card).toHaveClass("tt-surface-nested", "!bg-none");
      }

      const icons = screen.getAllByTestId("usage-dimension-icon");
      expect(icons).toHaveLength(4);
      const iconColors = icons.map((icon) => (
        icon.getAttribute("class").split(/\s+/).find((name) => name.startsWith("text-"))
      ));
      expect(new Set(iconColors)).toEqual(new Set([
        "text-oai-blue-500",
        "text-green-500",
        "text-orange-500",
        "text-purple-500",
      ]));

      expect(dimensionCards[0]).toHaveClass("!bg-emerald-50/70", "dark:!bg-emerald-950/25");
      expect(dimensionCards[1]).toHaveClass("!bg-green-50/70", "dark:!bg-green-950/25");
      expect(dimensionCards[2]).toHaveClass("!bg-orange-50/70", "dark:!bg-orange-950/25");
      expect(dimensionCards[3]).toHaveClass("!bg-purple-50/70", "dark:!bg-purple-950/25");

      expect(screen.getAllByTestId("usage-cost-cny")).toHaveLength(4);
      expect(container.querySelectorAll("[data-monthly-cost-status]")).toHaveLength(3);
      expect(screen.getAllByText("上月无基数")).toHaveLength(1);

      expect(screen.getByTestId("usage-request-summary")).toHaveClass("tt-surface-nested");
      expect(screen.getByTestId("usage-total-cost-summary")).toHaveClass("tt-surface-nested");
      expect(screen.getByTestId("usage-summary-rail")).toHaveClass(
        "flex",
        "flex-row",
        "lg:w-52",
        "lg:flex-col",
      );
      expect(screen.getByTestId("usage-cache-hit-summary")).toHaveClass(
        "tt-surface-nested",
      );
      expect(screen.getByText("5,634")).toBeInTheDocument();
      expect(screen.getByText("$228.07")).toBeInTheDocument();
      expect(screen.getByText("91.4%")).toBeInTheDocument();
    },
  );

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

  it("shows a compact, inspectable ledger-integrity line below the totals", () => {
    render(
      <UsageStatsPanel
        summary={{
          totals: { total_tokens: 8022132528 },
          data_integrity: {
            status: "verified",
            visible_records: 2844,
            visible_from: "2026-03-16T05:30:00.000Z",
            visible_to: "2026-07-29T11:00:00.000Z",
            raw_records: 3391,
            duplicate_records: 547,
            malformed_records: 0,
            updated_at: "2026-07-29T11:01:00.000Z",
          },
        }}
      />,
    );

    const integrity = screen.getByTestId("usage-data-integrity");
    expect(integrity).toHaveTextContent("2,844");
    expect(integrity).toHaveAttribute("title", expect.stringContaining("3,391"));
    expect(integrity).toHaveAttribute("title", expect.stringContaining("547"));
  });

  it("does not render Unix epoch dates when the visible ledger is empty", () => {
    render(
      <UsageStatsPanel
        summary={{
          totals: { total_tokens: 0 },
          data_integrity: {
            status: "verified",
            visible_records: 0,
            visible_from: null,
            visible_to: null,
            raw_records: 0,
            duplicate_records: 0,
            malformed_records: 0,
            updated_at: null,
          },
        }}
      />,
    );

    const integrity = screen.getByTestId("usage-data-integrity");
    expect(integrity).not.toHaveTextContent("1970");
    expect(integrity).not.toHaveTextContent("至");
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
    expect(within(row).getAllByTestId("usage-cost-card")).toHaveLength(4);
    for (const card of within(row).getAllByTestId("usage-cost-card")) {
      expect(card.querySelector("svg")).not.toBeNull();
      expect(card.querySelector(".truncate")).toBeNull();
    }
    expect(within(row).getByText("USD 5.00")).toBeInTheDocument();
    expect(within(row).getByText("¥36")).toBeInTheDocument();
    expect(within(row).getByText("USD 170.00")).toBeInTheDocument();
  });

  it("keeps complete comparison copy beside compact CNY and places statistic icons with values", () => {
    const { container } = render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1, request_count: 120, cost_usd: 12 } }}
        costSummary={{
          api_usd: 13548.56,
          api_cny: 97549.63,
          previous_api_usd: 100,
          previous_api_cny: 720,
          subscription_usd: 0,
          subscription_cny: 0,
          previous_subscription_usd: 0,
          previous_subscription_cny: 0,
          combined_usd: 13548.56,
          combined_cny: 97549.63,
          previous_combined_usd: 100,
          previous_combined_cny: 720,
          lifetime_combined_usd: 15000,
          lifetime_combined_cny: 108000,
        }}
      />,
    );

    expect(screen.getAllByText("¥9.75万").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("CNY 97,549.63")).not.toBeInTheDocument();
    const comparison = screen.getAllByTestId("monthly-cost-comparison")[0];
    expect(comparison).toHaveTextContent(comparison.getAttribute("aria-label"));
    expect(comparison.querySelector("svg")).toBeNull();
    expect(container.querySelector('[data-testid="monthly-cost-cny-row"]')).toHaveClass(
      "flex-row",
      "items-center",
      "justify-between",
    );
    expect(screen.getByTestId("usage-request-label").querySelector("svg")).toBeNull();
    expect(screen.getByTestId("usage-request-value").querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("usage-total-cost-summary").querySelector("svg")).toBeNull();
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
    expect(within(row).getAllByText("未提供字段")).toHaveLength(2);
    expect(row).not.toHaveTextContent("—");
    expect(within(row).getAllByText("USD 0.00").length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    { current: 120, previous: 100, expected: "20.0%", direction: "increase", expectedClass: "text-green-600" },
    { current: 80, previous: 100, expected: "20.0%", direction: "decrease", expectedClass: "text-green-600" },
    { current: 100, previous: 100, expected: "0.0%", direction: "flat", expectedClass: "text-oai-gray-400" },
    { current: 15, previous: 0, expected: "100.0%", direction: "increase", expectedClass: "text-green-600" },
    { current: 0, previous: 0, expected: "0.0%", direction: "flat", expectedClass: "text-oai-gray-400" },
  ])("renders the complete monthly comparison copy without invalid zero-base percentages", ({ current, previous, expected, direction, expectedClass }) => {
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
    expect(comparison).toHaveAttribute("data-direction", direction);
    expect(comparison.textContent.length).toBeGreaterThan(expected.length);
    expect(comparison.querySelector("svg")).toBeNull();
    expect(comparison).not.toHaveTextContent("↑");
    expect(comparison).not.toHaveTextContent("↓");
    expect(comparison).not.toHaveTextContent("→");
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
    expect(comparisons[2]).toHaveTextContent("0.0%");
    expect(screen.getAllByTestId("monthly-cost-cny-row")).toHaveLength(3);
    expect(comparisons[0]).toHaveClass("text-green-600");
    expect(comparisons[1]).toHaveClass("text-green-600");
  });

  it("shows only the requested month-over-month percentage even for a low baseline", () => {
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
    expect(comparisons[0]).toHaveTextContent("1325.0%");
    expect(comparisons[1]).toHaveTextContent("0.0%");
    expect(comparisons[2]).toHaveTextContent("1329.6%");
    expect(comparisons[0].textContent).not.toContain("¥");
  });

  it("shows explicit unavailable states instead of fake zeros or dash placeholders", () => {
    const { container } = render(
      <UsageStatsPanel
        summary={{
          totals: {
            total_tokens: 10,
          },
        }}
      />,
    );

    expect(screen.getAllByText("未提供字段").length).toBeGreaterThanOrEqual(7);
    expect(container).not.toHaveTextContent("—");
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
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

    expect(screen.getByText("暂无统计数据")).toBeInTheDocument();
    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
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
