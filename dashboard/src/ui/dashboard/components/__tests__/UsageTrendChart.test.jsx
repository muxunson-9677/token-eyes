import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom doesn't ship ResizeObserver — install a no-op stub before the
// component module evaluates so its useEffect never throws. observe() is a
// no-op so containerWidth stays 0 and the chart falls back to its 640px
// intrinsic width, which is plenty for these assertions.
const resizeObservers = [];

class ResizeObserverStub {
  constructor(callback) {
    this.callback = callback;
    resizeObservers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  resize(width, height) {
    this.callback([{ contentRect: { width, height } }]);
  }
}
globalThis.ResizeObserver = ResizeObserverStub;

// useCurrency() already has a USD@1 fallback when no provider is mounted,
// but mocking keeps the test independent of context wiring and explicit.
vi.mock("../../../../hooks/useCurrency.js", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

// Mock copy() to deterministic English so assertions don't depend on the
// test runner's locale resolution. The real copy() pulls from copy.csv +
// dashboard.json; both paths work, but a fixed map removes flakiness.
vi.mock("../../../../lib/copy", () => ({
  copy: (key, vars = {}) => {
    const map = {
      "usage.trend.chart.title": "Usage Trend",
      "usage.trend.chart.empty": "No trend data yet",
      "usage.trend.chart.loading": "Loading trend data...",
      "usage.trend.chart.error": "Failed to load trend data",
      "usage.trend.chart.retry": "Retry",
      "usage.trend.chart.legend.input": "Input",
      "usage.trend.chart.legend.output": "Output",
      "usage.trend.chart.legend.cache_creation": "Cache Creation",
      "usage.trend.chart.legend.cache_hit": "Cache Hit",
      "usage.trend.chart.legend.cost": "Cost",
      "usage.trend.chart.legend.toggle_aria": `Toggle ${vars.name} visibility`,
      "usage.trend.chart.aria.label": "Usage trend chart",
      "usage.trend.chart.yaxis.tokens": "Tokens",
      "usage.trend.chart.yaxis.cost": "Cost (USD)",
    };
    return map[key] || key;
  },
  getCopyLocale: () => "en-US",
}));

import {
  UsageTrendChart,
  aggregateSeriesByBucket,
  downsampleBuckets,
  buildSmoothPath,
  buildAreaPath,
  niceAxisMax,
  computeYTicks,
  formatTokenAxis,
  formatCostAxis,
  formatTooltipToken,
  formatTooltipCost,
} from "../UsageTrendChart.jsx";

// 3-bucket single-source fixture. input_tokens dominates so we can verify the
// left Y-axis rescales when Input is hidden. Values are chosen so the tooltip
// output and axis labels both use the shared Chinese token formatter.
function makeSeries() {
  return [
    {
      bucket_start: "2026-06-01", label: "2026-06-01", source: "codex",
      input_tokens: 1000, output_tokens: 500,
      cache_creation_input_tokens: 200, cached_input_tokens: 100, cost_usd: 1.5,
    },
    {
      bucket_start: "2026-06-02", label: "2026-06-02", source: "codex",
      input_tokens: 2000, output_tokens: 800,
      cache_creation_input_tokens: 300, cached_input_tokens: 200, cost_usd: 2.5,
    },
    {
      bucket_start: "2026-06-03", label: "2026-06-03", source: "codex",
      input_tokens: 1500, output_tokens: 600,
      cache_creation_input_tokens: 250, cached_input_tokens: 150, cost_usd: 2.0,
    },
  ];
}

const SERIES_COLORS = ["#3b82f6", "#10b981", "#f97316", "#8b5cf6", "#ef4444"];
const LEGEND_NAMES = ["Input", "Output", "Cache Creation", "Cache Hit", "Cost"];

describe("pure helpers", () => {
  describe("formatTokenAxis", () => {
    it("returns '0' for non-positive or NaN input", () => {
      expect(formatTokenAxis(0)).toBe("0");
      expect(formatTokenAxis(-5)).toBe("0");
      expect(formatTokenAxis(NaN)).toBe("0");
    });
    it("formats values with Chinese units", () => {
      expect(formatTokenAxis(1500)).toBe("1,500");
      expect(formatTokenAxis(2_500_000)).toBe("250万");
      expect(formatTokenAxis(3_000_000_000)).toBe("30亿");
    });
  });

  describe("formatCostAxis", () => {
    it("returns '$0' for non-positive input", () => {
      expect(formatCostAxis(0)).toBe("$0");
      expect(formatCostAxis(-1)).toBe("$0");
    });
    it("formats whole amounts without decimals", () => {
      expect(formatCostAxis(5)).toBe("$5");
    });
  });

  describe("formatTooltipToken", () => {
    it("returns '0' for non-positive input", () => {
      expect(formatTooltipToken(0)).toBe("0");
    });
    it("uses the Chinese token formatter", () => {
      expect(formatTooltipToken(12_345_000)).toBe("1.23千万");
    });
  });

  describe("formatTooltipCost", () => {
    it("always uses 6 decimal places", () => {
      expect(formatTooltipCost(0.5)).toBe("$0.500000");
      expect(formatTooltipCost(5)).toBe("$5.000000");
    });
  });

  describe("aggregateSeriesByBucket", () => {
    it("returns [] for empty or null input", () => {
      expect(aggregateSeriesByBucket([])).toEqual([]);
      expect(aggregateSeriesByBucket(null)).toEqual([]);
    });
    it("sums fields for entries sharing the same bucket_start", () => {
      const result = aggregateSeriesByBucket([
        {
          bucket_start: "b1", label: "B1", source: "codex",
          input_tokens: 100, output_tokens: 50,
          cache_creation_input_tokens: 10, cached_input_tokens: 5, cost_usd: 0.5,
        },
        {
          bucket_start: "b1", label: "B1", source: "hermes",
          input_tokens: 200, output_tokens: 30,
          cache_creation_input_tokens: 5, cached_input_tokens: 3, cost_usd: 0.2,
        },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        bucket_start: "b1", label: "B1",
        input_tokens: 300, output_tokens: 80,
        cache_creation_input_tokens: 15, cached_input_tokens: 8, cost_usd: 0.7,
      });
    });
    it("preserves first-seen bucket order", () => {
      const result = aggregateSeriesByBucket([
        { bucket_start: "b", label: "b" },
        { bucket_start: "a", label: "a" },
        { bucket_start: "b", label: "b" },
      ]);
      expect(result.map((b) => b.bucket_start)).toEqual(["b", "a"]);
    });
  });

  describe("downsampleBuckets", () => {
    it("returns a shallow copy when length <= maxPoints", () => {
      const input = [{ v: 1 }, { v: 2 }, { v: 3 }];
      const out = downsampleBuckets(input, 10);
      expect(out).not.toBe(input);
      expect(out).toEqual(input);
    });
    it("always preserves the last bucket when downsampling", () => {
      const input = Array.from({ length: 100 }, (_, i) => ({ v: i }));
      const out = downsampleBuckets(input, 10);
      expect(out[out.length - 1]).toBe(input[99]);
      expect(out.length).toBeLessThanOrEqual(11);
    });
  });

  describe("buildSmoothPath", () => {
    it("returns '' for empty input", () => {
      expect(buildSmoothPath([])).toBe("");
    });
    it("returns a single M command for one point", () => {
      expect(buildSmoothPath([{ x: 1, y: 2 }])).toBe("M 1,2");
    });
    it("returns a straight line for two points", () => {
      expect(buildSmoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe("M 0,0 L 10,10");
    });
    it("uses cubic bezier segments for 3+ points", () => {
      const path = buildSmoothPath([
        { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 },
      ]);
      expect(path.startsWith("M 0,0 C ")).toBe(true);
    });
  });

  describe("buildAreaPath", () => {
    it("returns '' when linePath is empty", () => {
      expect(buildAreaPath("", 0, 10, 100)).toBe("");
    });
    it("closes the path to baselineY with L and Z", () => {
      expect(buildAreaPath("M 0,0 L 10,10", 0, 10, 100)).toBe(
        "M 0,0 L 10,10 L 10,100 L 0,100 Z",
      );
    });
  });

  describe("niceAxisMax", () => {
    it("returns 1 for non-positive input", () => {
      expect(niceAxisMax(0)).toBe(1);
      expect(niceAxisMax(-5)).toBe(1);
    });
    it("snaps to the nearest 1/2/5/10 × 10^n", () => {
      expect(niceAxisMax(1)).toBe(1);
      expect(niceAxisMax(1.5)).toBe(2);
      expect(niceAxisMax(3)).toBe(5);
      expect(niceAxisMax(7)).toBe(10);
      expect(niceAxisMax(15)).toBe(20);
      expect(niceAxisMax(50)).toBe(50);
      expect(niceAxisMax(75)).toBe(100);
    });
  });

  describe("computeYTicks", () => {
    it("returns count+1 ticks spanning 0..niceMax", () => {
      const ticks = computeYTicks(100, 4);
      expect(ticks).toHaveLength(5);
      expect(ticks[0].value).toBe(0);
      expect(ticks[4].value).toBe(100);
      expect(ticks[2].ratio).toBe(0.5);
    });
  });
});

describe("UsageTrendChart", () => {
  it("uses the shared glass surface for data and state views", () => {
    const { container, rerender } = render(
      React.createElement(UsageTrendChart, { series: makeSeries() }),
    );

    expect(container.firstChild).toHaveClass("tt-surface");

    rerender(React.createElement(UsageTrendChart, { series: [], loading: true }));
    expect(container.firstChild).toHaveClass("tt-surface");
  });

  it("keeps the final two date labels far enough apart to remain readable", () => {
    resizeObservers.length = 0;
    const series = Array.from({ length: 20 }, (_, index) => ({
      bucket_start: `2026-07-${String(index + 1).padStart(2, "0")}`,
      label: `07-${String(index + 1).padStart(2, "0")}~${String(index + 7).padStart(2, "0")}`,
      source: "codex",
      input_tokens: 100 + index,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cached_input_tokens: 5,
      cost_usd: 1,
    }));
    const { container } = render(<UsageTrendChart series={series} />);

    act(() => resizeObservers.at(-1).resize(900, 620));

    const labels = Array.from(container.querySelectorAll('svg[role="img"] text'))
      .filter((node) => /^07-\d{2}~\d{2}$/.test(node.textContent || ""));
    const lastTwo = labels.slice(-2);
    expect(lastTwo).toHaveLength(2);
    expect(
      Number(lastTwo[1].getAttribute("x")) - Number(lastTwo[0].getAttribute("x")),
    ).toBeGreaterThanOrEqual(72);
  });

  it("grows the plot SVG to the measured available height", () => {
    resizeObservers.length = 0;
    const { container } = render(<UsageTrendChart series={makeSeries()} />);
    const plot = screen.getByTestId("usage-trend-plot");
    expect(plot).toHaveClass("flex-1");

    act(() => resizeObservers.at(-1).resize(900, 620));

    const svg = container.querySelector('svg[role="img"]');
    expect(svg).toHaveAttribute("width", "900");
    expect(svg).toHaveAttribute("height", "620");
  });

  it("renders the title and 5 legend buttons with aria-pressed=true", () => {
    render(<UsageTrendChart series={makeSeries()} />);
    expect(screen.getByText("Usage Trend")).toBeInTheDocument();
    for (const name of LEGEND_NAMES) {
      const btn = screen.getByRole("button", { name: `Toggle ${name} visibility` });
      expect(btn).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("renders all 5 colored line paths in the chart svg", () => {
    const { container } = render(<UsageTrendChart series={makeSeries()} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    for (const color of SERIES_COLORS) {
      expect(svg.querySelector(`path[stroke="${color}"]`)).not.toBeNull();
    }
  });

  it("hides the line and flips aria-pressed when its legend button is clicked", () => {
    const { container } = render(<UsageTrendChart series={makeSeries()} />);
    const inputBtn = screen.getByRole("button", { name: "Toggle Input visibility" });
    fireEvent.click(inputBtn);
    expect(inputBtn).toHaveAttribute("aria-pressed", "false");
    const svg = container.querySelector('svg[role="img"]');
    expect(svg.querySelector('path[stroke="#3b82f6"]')).toBeNull();
    // The other 4 lines remain.
    for (const color of ["#10b981", "#f97316", "#8b5cf6", "#ef4444"]) {
      expect(svg.querySelector(`path[stroke="${color}"]`)).not.toBeNull();
    }
  });

  it("auto-rescales the left Y axis when the dominant token series is hidden", () => {
    // Initial max tokens = 2000 (input bucket 1) → niceAxisMax(2000) = 2000.
    // After hiding Input, max visible tokens = 800 (output bucket 1) →
    //   niceAxisMax(800) = 1000.
    const { container } = render(<UsageTrendChart series={makeSeries()} />);
    const svg = container.querySelector('svg[role="img"]');
    const yTexts = () =>
      Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);

    expect(yTexts()).toContain("2,000");

    fireEvent.click(screen.getByRole("button", { name: "Toggle Input visibility" }));
    expect(yTexts()).toContain("1,000");
    expect(yTexts()).not.toContain("2,000");
  });

  it("shows a tooltip with all visible dimensions on bucket hover", () => {
    const { container } = render(<UsageTrendChart series={makeSeries()} />);
    const svg = container.querySelector('svg[role="img"]');
    const hitRect = svg.querySelector('rect[fill="transparent"]');
    fireEvent.mouseEnter(hitRect);

    // Bucket 0 values: input=1000, cacheCreation=200, cached=100, cost=1.5.
    const tooltip = screen.getByTestId("usage-trend-tooltip");
    expect(within(tooltip).getByText("1,000")).toBeInTheDocument();
    expect(within(tooltip).getByText("200")).toBeInTheDocument();
    expect(within(tooltip).getByText("100")).toBeInTheDocument();
    // Cost row uses 6 decimals — always unique to the tooltip.
    expect(within(tooltip).getByText("$1.500000")).toBeInTheDocument();
  });

  it("renders loading state with copy text and no chart svg", () => {
    const { container } = render(<UsageTrendChart series={[]} loading={true} />);
    expect(screen.getByText("Loading trend data...")).toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("keeps the existing chart visible while refreshing", () => {
    const { container } = render(<UsageTrendChart series={makeSeries()} loading={true} />);
    expect(screen.queryByText("Loading trend data...")).not.toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it("renders error state with retry button that calls onRetry", () => {
    const onRetry = vi.fn();
    render(<UsageTrendChart series={[]} error="boom" onRetry={onRetry} />);
    expect(screen.getByText("Failed to load trend data")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when series is empty and not loading", () => {
    render(<UsageTrendChart series={[]} />);
    expect(screen.getByText("No trend data yet")).toBeInTheDocument();
  });

  it("renders a single bucket with visible data points (not just invisible M paths)", () => {
    // F3.2: 单条数据要"正常显示点和 tooltip". buildSmoothPath 对单点返回
    // "M x,y" — SVG 中单独的 M 命令不绘制任何可见内容，所以必须额外渲染 <circle>
    // 让数据点可见。此测试专门防止该回归。
    const single = [
      {
        bucket_start: "2026-06-01", label: "2026-06-01", source: "codex",
        input_tokens: 100, output_tokens: 50,
        cache_creation_input_tokens: 10, cached_input_tokens: 5, cost_usd: 0.5,
      },
    ];
    const { container } = render(<UsageTrendChart series={single} />);
    expect(screen.getByText("Usage Trend")).toBeInTheDocument();
    const svg = container.querySelector('svg[role="img"]');
    // All 5 line paths still render (as "M x,y" moves).
    expect(svg.querySelectorAll('path[stroke]').length).toBe(5);
    // Crucially, 5 visible circles must render — one per dimension — since the
    // line paths alone are invisible for a single point.
    expect(svg.querySelectorAll("circle").length).toBe(5);
    // Each circle should be at the center X (single bucket → scaleX centers it).
    const centerX = svg.querySelector("circle").getAttribute("cx");
    for (const circle of svg.querySelectorAll("circle")) {
      expect(circle.getAttribute("cx")).toBe(centerX);
    }
  });

  it("does not render always-visible circles for multi-bucket series (only on hover)", () => {
    // B3: "默认不显示数据点，hover 时显示". Multi-bucket must NOT render
    // always-visible circles — only the hover dots (which require mouseEnter).
    const { container } = render(<UsageTrendChart series={makeSeries()} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg.querySelectorAll("circle").length).toBe(0);
  });

  it("aggregates multi-source buckets into a single rendered series", () => {
    // Two sources with the same bucket_start → aggregator merges them into
    // one bucket. Hovering the rendered chart should reveal summed values
    // from both sources, proving the aggregation ran before rendering.
    const multi = [
      {
        bucket_start: "2026-06-01", label: "2026-06-01", source: "codex",
        input_tokens: 100, output_tokens: 50,
        cache_creation_input_tokens: 10, cached_input_tokens: 5, cost_usd: 0.5,
      },
      {
        bucket_start: "2026-06-01", label: "2026-06-01", source: "hermes",
        input_tokens: 200, output_tokens: 30,
        cache_creation_input_tokens: 5, cached_input_tokens: 3, cost_usd: 0.2,
      },
    ];
    const { container } = render(<UsageTrendChart series={multi} />);
    const svg = container.querySelector('svg[role="img"]');
    // Only one bucket should be rendered → exactly one hit rect.
    expect(svg.querySelectorAll('rect[fill="transparent"]')).toHaveLength(1);
    fireEvent.mouseEnter(svg.querySelector('rect[fill="transparent"]'));
    // Aggregated totals: input=300, output=80, cacheCreation=15, cached=8, cost=0.7.
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("$0.700000")).toBeInTheDocument();
  });
});
