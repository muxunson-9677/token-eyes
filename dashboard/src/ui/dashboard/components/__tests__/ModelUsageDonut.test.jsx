import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ModelUsageDonut } from "../ModelUsageDonut.jsx";

vi.mock("../../../../lib/copy", () => ({
  getCopyLocale: () => "zh-CN",
  copy: (key, params = {}) => ({
    "dashboard.model_distribution.title": "模型消耗分布",
    "dashboard.model_distribution.subtitle": "当前时间范围内各模型 Token 占比",
    "dashboard.model_distribution.total": "模型总消耗",
    "dashboard.model_distribution.empty": "当前范围暂无模型消耗",
    "dashboard.model_distribution.chart_aria": "模型消耗分布图",
    "dashboard.model_distribution.radar_title": "模型活跃雷达",
    "dashboard.model_distribution.radar_subtitle": "序号对应右侧模型排名 · 占比 0–100%",
    "dashboard.model_distribution.radar_summary": `${params.count} 个模型 · 首位 ${params.percent}%`,
    "dashboard.model_distribution.radar_aria": "模型活跃度雷达图",
  }[key] || key),
}));

describe("ModelUsageDonut", () => {
  it("renders an accessible donut, total and exact model legend", () => {
    render(
      <ModelUsageDonut
        totalTokens={12000}
        rows={[
          { id: "gpt-5-5", name: "GPT-5.5", tokens: 9000, percent: 75 },
          { id: "other", name: "其他", tokens: 3000, percent: 25 },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "模型消耗分布图" })).toBeInTheDocument();
    expect(screen.getByText("1.2万")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "模型活跃度雷达图" })).toBeInTheDocument();
    const visuals = screen.getByTestId("model-usage-visuals");
    const legend = screen.getByTestId("model-usage-legend");
    expect(within(legend).getByText("GPT-5.5")).toBeInTheDocument();
    expect(within(legend).getByText("75%")).toBeInTheDocument();
    expect(within(legend).getByText("9,000")).toBeInTheDocument();
    expect(visuals).toContainElement(screen.getByRole("img", { name: "模型消耗分布图" }));
    expect(visuals).toContainElement(screen.getByRole("img", { name: "模型活跃度雷达图" }));
    expect(screen.getByTestId("model-usage-layout")).toContainElement(legend);
    expect(screen.getByTestId("model-usage-layout")).toHaveClass("sm:grid-cols-2");
    expect(legend).toHaveClass("h-full", "overflow-y-auto", "divide-y");
    expect(legend).not.toHaveClass("sm:max-h-none", "overflow-hidden");
    const legendItems = Array.from(legend.querySelectorAll("li"));
    expect(legendItems).toHaveLength(2);
    legendItems.forEach((item) => {
      expect(item).not.toHaveClass("flex-1", "rounded-lg");
      expect(item).toHaveAttribute("data-model-rank-row", "true");
    });
    expect(screen.getByText("2 个模型 · 首位 75%")).toBeVisible();
    expect(screen.getByTestId("model-radar-label-0")).toHaveAttribute(
      "aria-label",
      "GPT-5.5 75%",
    );
    expect(screen.getByTestId("model-radar-label-0")).toHaveTextContent("1");
    expect(screen.getByTestId("model-radar-label-0")).toHaveTextContent("75%");
    expect(screen.getByTestId("model-radar-label-0")).not.toHaveTextContent("GPT-5.5");
    expect(screen.getByTestId("model-usage-summary-count")).toHaveTextContent("2");
    expect(screen.getByTestId("model-usage-summary-top1")).toHaveTextContent("75%");
    expect(screen.getByTestId("model-usage-summary-top3")).toHaveTextContent("100%");
    expect(screen.getByTestId("model-usage-table-head")).toHaveTextContent("Token");
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /2.*模型/ })).toBeInTheDocument();
    expect(screen.getAllByTestId("model-radar-grid-ring")).toHaveLength(4);
    expect(screen.getByTestId("model-radar-frame")).toBeInTheDocument();
    expect(screen.getByTestId("model-radar-value")).toHaveAttribute("fill", "url(#model-radar-fill)");
    expect(screen.getAllByTestId("model-radar-vertex")).toHaveLength(2);
  });

  it("renders an empty state without a misleading chart", () => {
    render(<ModelUsageDonut totalTokens={0} rows={[]} />);

    expect(screen.getByText("当前范围暂无模型消耗")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "模型消耗分布图" })).not.toBeInTheDocument();
  });

  it("keeps every supplied model readable in a scrollable legend without truncating names", () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: `model-${index}`,
      name: `A very long measured model name ${index}`,
      tokens: 1000 - index * 10,
      percent: 14.2,
    }));
    const { container } = render(<ModelUsageDonut totalTokens={6790} rows={rows} />);

    expect(container.firstChild).toHaveClass("tt-surface-nested");
    expect(container.firstChild).not.toHaveClass("tt-surface");
    for (const row of rows) {
      expect(screen.getByText(row.name)).toBeInTheDocument();
    }
    const legend = container.querySelector('[data-testid="model-usage-legend"]');
    expect(legend).toHaveClass("h-full", "min-h-0", "overflow-y-auto");
    expect(legend).not.toHaveClass("sm:max-h-none");
    expect(legend.textContent).not.toContain("Other");
    expect(container.querySelector(".truncate")).toBeNull();
  });
});
