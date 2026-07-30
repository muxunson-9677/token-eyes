import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ModelUsageDonut } from "../ModelUsageDonut.jsx";

vi.mock("../../../../lib/copy", () => ({
  copy: (key) => ({
    "dashboard.model_distribution.title": "模型消耗分布",
    "dashboard.model_distribution.subtitle": "当前时间范围内各模型 Token 占比",
    "dashboard.model_distribution.total": "模型总消耗",
    "dashboard.model_distribution.empty": "当前范围暂无模型消耗",
    "dashboard.model_distribution.chart_aria": "模型消耗分布图",
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
    expect(screen.getByText("GPT-5.5")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("9,000")).toBeInTheDocument();
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
    expect(legend).toHaveClass("overflow-y-auto");
    expect(legend.textContent).not.toContain("Other");
    expect(container.querySelector(".truncate")).toBeNull();
  });
});
