import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import { getMonthlyCostComparison, UsageStatsPanel } from "../UsageStatsPanel.jsx";

const completeSummary = {
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
};

describe("UsageStatsPanel", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it.each(["light", "dark"])("keeps the usage hierarchy in %s theme", (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    render(<UsageStatsPanel summary={completeSummary} />);

    expect(screen.getAllByTestId("usage-dimension-card")).toHaveLength(4);
    expect(screen.getByTestId("usage-request-summary")).toBeInTheDocument();
    expect(screen.getByTestId("usage-cache-hit-summary")).toBeInTheDocument();
    expect(screen.getByTestId("usage-total-cost-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("usage-cost-summary")).not.toBeInTheDocument();
    expect(screen.getByText("5,634")).toBeInTheDocument();
    expect(screen.getByText("91.4%")).toBeInTheDocument();
  });

  it("pairs the three summary cards with the matching left-side content rows", () => {
    const { container } = render(
      <UsageStatsPanel summary={completeSummary} costSummary={{
        api_usd: 10,
        api_cny: 70,
        subscription_usd: 5,
        subscription_cny: 35,
        combined_usd: 15,
        combined_cny: 105,
        lifetime_combined_usd: 120,
        lifetime_combined_cny: 840,
      }} />,
    );

    expect(container.querySelectorAll('[data-layout-row="headline"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-layout-row="tokens"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-layout-row="costs"]')).toHaveLength(2);
    expect(screen.getByTestId("usage-summary-rail")).toHaveClass("tt-usage-summary-rail");
    expect(screen.getByTestId("usage-stats-layout")).toHaveClass("tt-usage-stats-reference");
    expect(screen.getByTestId("usage-request-summary")).toHaveClass("tt-usage-summary-card");
  });

  it("renders exact token status and all four token dimensions", () => {
    render(<UsageStatsPanel summary={completeSummary} fetchedAt="2026-08-01T08:00:00.000Z" />);

    expect(screen.getByTestId("usage-token-confidence")).toHaveAttribute(
      "data-confidence-state",
      "exact",
    );
    expect(screen.getAllByTestId("usage-dimension-card").map((card) => card.dataset.dimension))
      .toEqual(["input", "output", "cache_create", "cache_hit"]);
    expect(screen.getByText("输出")).toBeInTheDocument();
    expect(screen.getByText("6.43亿")).toBeInTheDocument();
  });

  it("renders English token values without Chinese magnitude suffixes", () => {
    setCopyLocale("en");
    const { container } = render(
      <UsageStatsPanel summary={{ totals: { total_tokens: 4_716_100, input_tokens: 20_000 } }} />,
    );

    expect(screen.getByText("4.72M")).toBeInTheDocument();
    expect(screen.getByText("20K")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/[万亿]/u);
  });

  it("marks totals partial when ledger reconciliation needs attention", () => {
    render(
      <UsageStatsPanel
        summary={{
          totals: { total_tokens: 100 },
          data_integrity: { status: "attention", token_delta: 4 },
        }}
      />,
    );

    expect(screen.getByTestId("usage-token-confidence")).toHaveAttribute(
      "data-confidence-state",
      "partial",
    );
  });

  it("keeps provider component attribution gaps out of the user-facing confidence state", () => {
    const { container } = render(
      <UsageStatsPanel
        summary={{
          totals: { total_tokens: 214151 },
          data_integrity: {
            status: "verified",
            token_delta: 0,
            component_token_delta: 9774,
            component_mismatch_records: 1,
          },
        }}
      />,
    );

    expect(screen.getByTestId("usage-token-confidence")).toHaveAttribute(
      "data-confidence-state",
      "exact",
    );
    expect(container).not.toHaveTextContent("9,774");
  });

  it("falls back to the legacy summary object", () => {
    render(<UsageStatsPanel summary={{ summary: { total_tokens: 1000, request_count: 10 } }} />);
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("uses conversation count for aggregate-only request summaries", () => {
    render(<UsageStatsPanel summary={{ totals: { total_tokens: 1700, conversation_count: 1193 } }} />);
    expect(screen.getByText("1,193")).toBeInTheDocument();
  });

  it("keeps ledger diagnostics out of the summary card", () => {
    const { rerender } = render(createElement(UsageStatsPanel, {
      summary: {
        totals: { total_tokens: 8022132528 },
        data_integrity: {
          status: "verified",
          visible_records: 2844,
          raw_records: 3391,
          duplicate_records: 547,
        },
      },
    }));

    expect(screen.queryByTestId("usage-data-integrity")).not.toBeInTheDocument();
    expect(screen.queryByText(/2,844|3,391|547/)).not.toBeInTheDocument();

    rerender(createElement(UsageStatsPanel, {
      summary: {
        totals: { total_tokens: 0 },
        data_integrity: {
          status: "attention",
          token_delta: 4,
        },
      },
    }));
    expect(screen.queryByTestId("usage-data-integrity")).not.toBeInTheDocument();
  });

  it("renders the selected agent identity", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 400972476 } }}
        selectedAgent={{ displayName: "Claude Code", queueSource: "claude" }}
      />,
    );
    expect(screen.getByTestId("usage-selected-agent")).toHaveTextContent("Claude Code");
  });

  it("restores monthly financial cards, prior-month comparison, and lifetime total", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 100, cost_usd: 12 } }}
        costSummary={{
          api_usd: 8.25,
          previous_api_usd: 7.36,
          subscription_usd: 20,
          previous_subscription_usd: 20,
          combined_usd: 28.25,
          previous_combined_usd: 29.43,
          lifetime_combined_usd: 138.4,
        }}
      />,
    );

    const cards = screen.getAllByTestId("usage-cost-card");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent("本月 API 标价等价价值");
    expect(cards[0]).toHaveTextContent("USD 8.25");
    expect(cards[0].querySelector('[data-direction="increase"]')).toHaveTextContent("12.1%");
    expect(cards[1]).toHaveTextContent("本月订阅成本");
    expect(cards[1].querySelector('[data-direction="flat"]')).toHaveTextContent("与上月持平");
    expect(cards[2]).toHaveTextContent("本月总成本");
    expect(cards[2].querySelector('[data-direction="decrease"]')).toHaveTextContent("4.0%");
    expect(cards[3]).toHaveTextContent("累计总成本");
    expect(cards[3]).toHaveTextContent("USD 138.40");
    expect(cards[3].querySelector("[data-direction]")).toBeNull();
  });

  it("shows real zeroes, hides missing current cards, and omits a missing baseline", () => {
    const { rerender } = render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{ api_usd: 0, previous_api_usd: 0 }}
      />,
    );

    const zeroCostSummary = screen.getByTestId("usage-cost-summary");
    expect(within(zeroCostSummary).getAllByTestId("usage-cost-card")).toHaveLength(1);
    expect(within(zeroCostSummary).getByText("USD 0.00")).toBeInTheDocument();
    expect(within(zeroCostSummary).getByTestId("monthly-cost-comparison")).toHaveAttribute("data-direction", "flat");
    expect(within(zeroCostSummary).queryByText("未提供字段")).not.toBeInTheDocument();

    rerender(createElement(UsageStatsPanel, {
      summary: { totals: { total_tokens: 1 } },
      costSummary: { api_usd: 5, subscription_usd: null },
    }));
    expect(screen.getAllByTestId("usage-cost-card")).toHaveLength(1);
    expect(screen.queryByTestId("monthly-cost-comparison")).not.toBeInTheDocument();
  });

  it("keeps the confirmed newly-added wording for a zero baseline without inventing a rate or amount", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{ api_usd: 5, previous_api_usd: 0 }}
      />,
    );

    const comparison = screen.getByTestId("monthly-cost-comparison");
    expect(comparison).toHaveAttribute("data-direction", "new");
    expect(comparison).toHaveClass("text-emerald-700");
    expect(comparison).toHaveTextContent("较上月新增");
    expect(comparison).not.toHaveTextContent("USD");
    expect(comparison).not.toHaveTextContent("CNY");
    expect(comparison).not.toHaveTextContent("100%");
  });

  it("keeps the confirmed month-over-month percentage wording even when the prior baseline is low", () => {
    expect(getMonthlyCostComparison(2566.34, 36.62)).toEqual({
      kind: "increase",
      percent: expect.any(Number),
      delta: 2529.72,
    });

    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        costSummary={{
          api_usd: 2566.34,
          previous_api_usd: 36.62,
          api_cny: 18477.68,
          previous_api_cny: 263.66,
        }}
      />,
    );

    const comparison = screen.getByTestId("monthly-cost-comparison");
    expect(comparison).toHaveAttribute("data-direction", "increase");
    expect(comparison).toHaveClass("text-emerald-700");
    expect(comparison).toHaveAttribute(
      "title",
      expect.stringContaining("(本期 - 上期) ÷ 上期"),
    );
    expect(comparison).toHaveTextContent("较上月新增 6908.0%");
    expect(comparison).not.toHaveTextContent("上月同期基数低");
    expect(comparison).not.toHaveTextContent("CNY 18,214.02");
    expect(comparison.closest('[data-testid="usage-cost-secondary-row"]')).toBeInTheDocument();
  });

  it("does not expose provider component attribution gaps as a ledger defect", () => {
    render(<UsageStatsPanel summary={{ totals: { total_tokens: 10 }, data_integrity: {
      status: "attention", token_delta: 0, component_token_delta: 20155, component_mismatch_records: 2,
    } }} />);
    expect(screen.queryByTestId("usage-data-integrity")).not.toBeInTheDocument();
    expect(screen.queryByText(/Token 差值/)).not.toBeInTheDocument();
  });

  it("hides metrics that were not provided instead of rendering placeholders", () => {
    const { container } = render(<UsageStatsPanel summary={{ totals: { total_tokens: 10 } }} />);
    expect(screen.queryAllByTestId("usage-dimension-card")).toHaveLength(0);
    expect(screen.queryByTestId("usage-request-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("usage-cache-hit-summary")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("未提供字段");
    expect(container).not.toHaveTextContent("—");
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("keeps real zero metrics visible", () => {
    render(<UsageStatsPanel summary={{ totals: {
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cached_input_tokens: 0,
      request_count: 0,
      cost_usd: 0,
      cache_hit_rate: 0,
    } }} />);

    expect(screen.getAllByTestId("usage-dimension-card")).toHaveLength(4);
    expect(screen.getByTestId("usage-request-summary")).toHaveTextContent("0");
    expect(screen.getByTestId("usage-total-cost-summary")).toHaveTextContent("$0");
    expect(screen.getByTestId("usage-cache-hit-summary")).toHaveTextContent("0.0%");
  });

  it("keeps successful totals visible while refreshing", () => {
    render(<UsageStatsPanel summary={{ totals: { total_tokens: 1 } }} loading />);
    expect(screen.getByTestId("usage-token-confidence")).toBeInTheDocument();
    expect(screen.queryByTestId("usage-stats-state")).not.toBeInTheDocument();
  });

  it("keeps the last successful totals visible and marks them stale after failure", () => {
    render(
      <UsageStatsPanel
        summary={{ totals: { total_tokens: 1 } }}
        error="local usage unavailable"
        fetchedAt="2026-08-01T08:00:00.000Z"
      />,
    );
    expect(screen.getByTestId("usage-token-confidence")).toHaveAttribute(
      "data-confidence-state",
      "stale",
    );
    expect(screen.getByRole("status")).toHaveTextContent("local usage unavailable");
  });

  it("shows an error state when the first request fails", () => {
    render(<UsageStatsPanel summary={null} error="offline" />);
    expect(screen.getByTestId("usage-stats-state")).toHaveAttribute("data-state", "error");
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("shows loading and empty states without fabricated metrics", () => {
    const { rerender } = render(<UsageStatsPanel summary={null} loading />);
    expect(screen.getByTestId("usage-stats-state")).toHaveAttribute("data-state", "loading");

    rerender(<UsageStatsPanel summary={null} />);
    expect(screen.getByTestId("usage-stats-state")).toHaveAttribute("data-state", "empty");
  });

  it.each([
    [0.5, "50.0%"],
    [50, "50.0%"],
  ])("normalizes cache hit rate %s", (value, expected) => {
    render(<UsageStatsPanel summary={{ totals: { total_tokens: 1, cache_hit_rate: value } }} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("derives the cache hit rate from token dimensions when the aggregate omits it", () => {
    render(<UsageStatsPanel summary={{ totals: {
      total_tokens: 1_000,
      input_tokens: 50,
      cache_creation_input_tokens: 10,
      cached_input_tokens: 940,
    } }} />);

    expect(screen.getByTestId("usage-cache-hit-summary")).toHaveTextContent("94.0%");
  });
});
