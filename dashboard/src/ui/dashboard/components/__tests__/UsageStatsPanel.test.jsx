import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import { UsageStatsPanel } from "../UsageStatsPanel.jsx";

// Ticket-02 F: UsageStatsPanel is a pure presentational component. All its
// copy keys are ticket02.stats.* which resolve to the zh-CN CSV fallback in
// any locale, so we pin zh-CN for determinism and assert the wired strings +
// the data-derived formatted numbers (formatFullNum / formatApprox /
// normalizeHitRate / formatCost).

describe("UsageStatsPanel", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("renders main metric, approx, 4 dimension cards and 3 right cards when summary.totals present", () => {
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

    // Main metric + approx
    expect(screen.getByText("真实消耗 Tokens")).toBeInTheDocument();
    expect(screen.getByText("643,308,077")).toBeInTheDocument();
    expect(screen.getByText("≈ 6.43 亿")).toBeInTheDocument();

    // 4 dimension card labels
    expect(screen.getByText("新增输入")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("创建")).toBeInTheDocument();
    expect(screen.getByText("命中")).toBeInTheDocument();
    // One compact-formatted dimension value to verify formatCompactNumber wiring
    expect(screen.getByText("55.2M")).toBeInTheDocument();

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
    expect(screen.getByText("400,972,476")).toBeInTheDocument();
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

  it("shows loading text when loading is true", () => {
    render(<UsageStatsPanel summary={{ totals: { total_tokens: 1 } }} loading={true} />);

    expect(screen.getByText("加载中")).toBeInTheDocument();
    expect(screen.queryByText("真实消耗 Tokens")).not.toBeInTheDocument();
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

  it("formats approx as 万 for totals below 1e8 but at least 1e4", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 55193000 } }}
      />,
    );

    // 55193000 / 1e4 = 5519.3 → "5519.3 万"
    expect(screen.getByText("≈ 5519.3 万")).toBeInTheDocument();
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
