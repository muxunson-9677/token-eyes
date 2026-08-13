import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CostAccumulation } from "../CostAccumulation.jsx";

// V2-W2 subscription ROI card ("回本倍数") on the cost page.
// multiplier = monthApiCostUsd / monthSubscriptionCostUsd.

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));

const BASE_SUMMARY = {
  monthApiCostUsd: 0,
  monthSubscriptionCostUsd: 0,
  monthTotalCostUsd: 0,
  lifetimeTotalCostUsd: 0,
  usdToCny: 7.2,
};

it("shows the ROI hero multiplier when subscription and usage exist", () => {
  render(
    <CostAccumulation
      costSummary={{
        ...BASE_SUMMARY,
        monthApiCostUsd: 316,
        monthSubscriptionCostUsd: 20,
        monthTotalCostUsd: 336,
      }}
    />,
  );
  expect(screen.getByText("15.8×")).toBeInTheDocument();
  expect(
    screen.getByText('spend.cost.roi.subtitle:{"value":"15.8"}'),
  ).toBeInTheDocument();
  expect(screen.getByText("spend.cost.roi.title")).toBeInTheDocument();
});

it("uses neutral framing when the multiplier is below one", () => {
  render(
    <CostAccumulation
      costSummary={{
        ...BASE_SUMMARY,
        monthApiCostUsd: 5,
        monthSubscriptionCostUsd: 20,
        monthTotalCostUsd: 25,
      }}
    />,
  );
  expect(screen.getByText("0.3×")).toBeInTheDocument();
  expect(
    screen.getByText('spend.cost.roi.below_one:{"percent":"25"}'),
  ).toBeInTheDocument();
});

it("shows the guidance state when there is no subscription spend", () => {
  render(<CostAccumulation costSummary={{ ...BASE_SUMMARY }} />);
  expect(screen.getByText("spend.cost.roi.empty")).toBeInTheDocument();
  expect(screen.queryByText("spend.cost.roi.title")).not.toBeInTheDocument();
});
