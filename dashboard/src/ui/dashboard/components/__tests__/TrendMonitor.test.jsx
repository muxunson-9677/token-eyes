import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The zoom modal pulls in use-trend-data (a .ts hook imported with a .js
// specifier) which vitest's resolver can't follow the way the Vite build does.
// The small-card tests never open the modal, so stub it out.
vi.mock("../TrendMonitorZoomModal", () => ({
  TrendMonitorZoomModal: () => <div data-testid="trend-zoom-modal" />,
}));

import {
  TrendMonitor,
  computeInterpolatedSeries,
  computeMovingAverageSeries,
  getTrendMonitorScale,
} from "../TrendMonitor.jsx";

describe("getTrendMonitorScale", () => {
  it("clips isolated outliers before deriving the chart max", () => {
    const scale = getTrendMonitorScale([80, 90, 95, 110, 120, 140, 10000]);

    expect(scale.rawMax).toBe(10000);
    expect(scale.effectiveMax).toBeLessThan(300);
    expect(scale.clippedValues.at(-1)).toBe(scale.effectiveMax);
    expect((scale.clippedValues[0] / scale.effectiveMax) * 100).toBeGreaterThan(30);
  });
});

describe("computeMovingAverageSeries", () => {
  it("computes a trailing moving average without inventing future observations", () => {
    expect(computeMovingAverageSeries([10, 20, 30, 40], 3)).toEqual([10, 15, 20, 30]);
  });
});

describe("TrendMonitor", () => {
  it("uses a semantic icon in the usage-trend heading", () => {
    render(<TrendMonitor rows={[]} />);

    expect(screen.getByTestId("trend-monitor-title").querySelector("svg")).not.toBeNull();
  });

  it("renders the reference daily-granularity control", () => {
    render(<TrendMonitor rows={[]} />);

    expect(screen.getByTestId("trend-granularity")).toHaveTextContent("天");
  });

  it("opens the real granularity picker when the granularity control is clicked", () => {
    render(<TrendMonitor rows={[]} zoomConfig={{ baseUrl: "http://localhost" }} />);

    const control = screen.getByTestId("trend-granularity");
    expect(control.tagName).toBe("BUTTON");
    fireEvent.click(control);
    expect(screen.getByTestId("trend-zoom-modal")).toBeInTheDocument();
  });

  it("renders the reference chart y-axis from the real scale", () => {
    render(<TrendMonitor rows={[{ billable_total_tokens: 100 }, { billable_total_tokens: 200 }]} />);
    expect(screen.getByTestId("trend-y-axis").children).toHaveLength(6);
    expect(screen.getByTestId("trend-y-axis")).toHaveTextContent("200");
  });

  it("keeps normal bars visible when a single day is an outlier", () => {
    const rows = [80, 90, 95, 110, 120, 140, 10000].map((value) => ({
      billable_total_tokens: value,
    }));

    const { container } = render(
      <TrendMonitor rows={rows} showTimeZoneLabel={false} />,
    );
    const bars = Array.from(container.querySelectorAll('[data-trend-bar="true"]'));

    expect(container.firstChild).toHaveClass("tt-surface");
    expect(container.firstChild).not.toHaveClass("tt-surface-nested");
    expect(screen.getByTestId("trend-moving-average-line")).toBeInTheDocument();
    expect(bars).toHaveLength(rows.length);
    expect(parseFloat(bars[0].parentElement?.style.height ?? "")).toBeGreaterThan(30);
    expect(parseFloat(bars.at(-1)?.parentElement?.style.height ?? "")).toBe(100);
    expect(bars[0].parentElement?.className).toContain("absolute");
    expect(bars[0].parentElement?.parentElement?.className).toContain("self-stretch");
  });

  it("keeps dense daily bars alongside the moving-average line in the narrow overview column", () => {
    const rows = Array.from({ length: 214 }, (_, index) => ({
      billable_total_tokens: 100 + (index % 17) * 10,
    }));

    const { container } = render(
      <TrendMonitor rows={rows} showTimeZoneLabel={false} />,
    );

    expect(screen.getByTestId("trend-bar-row")).toHaveClass("gap-0");
    expect(container.querySelectorAll('[data-trend-bar="true"]')).toHaveLength(rows.length);
    expect(screen.getByTestId("trend-moving-average-line")).toBeInTheDocument();
  });

  it("renders real-zero observations as flat baseline bars, not interpolated", () => {
    // Two real values bracketing a real zero: the zero must NOT be filled in.
    const rows = [
      { billable_total_tokens: 100 },
      { billable_total_tokens: 0 },
      { billable_total_tokens: 100 },
    ];
    const { container } = render(
      <TrendMonitor rows={rows} showTimeZoneLabel={false} />,
    );
    const bars = Array.from(container.querySelectorAll('[data-trend-bar="true"]'));
    expect(bars).toHaveLength(3);
    // Real-zero gets the baseline pixel height, not a percentage interpolation.
    expect(bars[1].parentElement?.style.height).toBe("2px");
  });

  it("does not render a speculative future bar as observed usage", () => {
    const rows = [
      { billable_total_tokens: 100 },
      { billable_total_tokens: 100 },
      { future: true },
    ];
    const { container } = render(
      <TrendMonitor rows={rows} showTimeZoneLabel={false} />,
    );
    const bars = Array.from(container.querySelectorAll('[data-trend-bar="true"]'));
    expect(bars).toHaveLength(2);
    expect(container.textContent).not.toContain("Predicted");
  });

  it("renders X-axis tick labels only in zoom mode (small card unchanged)", () => {
    const rows = [
      { hour: "2026-05-29T14:00:00", billable_total_tokens: 100 },
      { hour: "2026-05-29T14:30:00", billable_total_tokens: 200 },
    ];

    const plain = render(<TrendMonitor rows={rows} period="day" showTimeZoneLabel={false} />);
    expect(plain.container.textContent).not.toContain("14:00");

    const zoomed = render(
      <TrendMonitor rows={rows} period="day" isZoom showTimeZoneLabel={false} />,
    );
    expect(zoomed.container.textContent).toContain("14:00");
    expect(zoomed.container.textContent).toContain("14:30");
  });

  it("shows the maximize button only when zoomConfig is provided", () => {
    const rows = [{ billable_total_tokens: 100 }];

    const without = render(<TrendMonitor rows={rows} showTimeZoneLabel={false} />);
    expect(without.queryByRole("button", { name: /展开全屏|open/i })).toBeNull();

    const withCfg = render(
      <TrendMonitor rows={rows} zoomConfig={{ baseUrl: "http://localhost" }} showTimeZoneLabel={false} />,
    );
    expect(withCfg.container.querySelector(".lucide-maximize-2")?.closest("button"))
      .toHaveClass("tt-analytics-focusable");
  });
});

describe("computeInterpolatedSeries", () => {
  it("passes observed values through unchanged (including zero)", () => {
    expect(computeInterpolatedSeries([10, 0, 20])).toEqual([10, 0, 20]);
  });

  it("linearly interpolates between two bracketing observations", () => {
    const out = computeInterpolatedSeries([100, null, null, 400]);
    expect(out[1]).toBeCloseTo(200);
    expect(out[2]).toBeCloseTo(300);
  });

  it("extrapolates trailing gaps with decay toward zero", () => {
    const out = computeInterpolatedSeries([100, 100, 100, null, null]);
    // Each successive future step shrinks by the per-step decay factor.
    expect(out[3]).toBeGreaterThan(0);
    expect(out[4]).toBeGreaterThan(0);
    expect(out[4]).toBeLessThan(out[3]);
    // Extrapolation never exceeds the observed base.
    expect(out[3]).toBeLessThan(100);
  });

  it("returns all zeros when no observations exist", () => {
    expect(computeInterpolatedSeries([null, null, null])).toEqual([0, 0, 0]);
  });
});
