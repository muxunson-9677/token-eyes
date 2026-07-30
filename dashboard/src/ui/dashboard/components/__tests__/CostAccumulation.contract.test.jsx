import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CostAccumulation, getMonthComparison } from "../CostAccumulation.jsx";

// 02 work order contract tests for CostAccumulation.
//
// Covers:
//  - F6/Task-10 (未知成本不得显示 0): missing totals → explicit unavailable state, real 0 → "0.00".
//    Both summary cards and API billing cards must distinguish "field absent"
//    from "genuinely zero cost".
//  - F5 (one_time contract): the subscription form's cycle select offers the
//    wire-contract value `one_time` (underscore), not `one-time` (hyphen).
//  - F6 (currency contract): the subscription form's currency select offers
//    ONLY USD and CNY — EUR/GBP are removed.
//  - MoM copy direction: increase/decrease both emerald; copy keys accurate.

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key, params) => {
    if (key === "shared.unit.percent") return "%";
    if (!params) return key;
    if (key === "spend.cost.month_picker.value") return `${params.year}年${params.month}月`;
    if (key === "spend.cost.month_picker.year_to_month") return `${params.year}年截至${params.month}月`;
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      key.includes("increase") || key.includes("decrease")
        ? `${key}:{{value}}%`
        : key.includes("new_amount")
          ? `${key}:{{amount}}`
          : key,
    );
  },
}));

const BASE_SUMMARY = {
  monthApiCostUsd: 0,
  monthSubscriptionCostUsd: 0,
  monthTotalCostUsd: 0,
  lifetimeTotalCostUsd: 0,
  usdToCny: 7.2,
};

it("renders API, subscription, and total month comparisons beside the CNY line", () => {
  render(
    <CostAccumulation
      costSummary={{
        ...BASE_SUMMARY,
        monthApiCostUsd: 120,
        previousMonthApiCostUsd: 100,
        monthSubscriptionCostUsd: 80,
        previousMonthSubscriptionCostUsd: 100,
        monthTotalCostUsd: 200,
        previousMonthTotalCostUsd: 200,
      }}
    />,
  );

  expect(screen.getByTestId("monthly-cost-comparison-api")).toBeInTheDocument();
  expect(screen.getByTestId("monthly-cost-comparison-subscription")).toBeInTheDocument();
  expect(screen.getByTestId("monthly-cost-comparison-total")).toBeInTheDocument();
  for (const testId of ["api", "subscription", "total"]) {
    const comparison = screen.getByTestId(`monthly-cost-comparison-${testId}`);
    expect(comparison.parentElement).toHaveTextContent("CNY");
    expect(comparison.parentElement).toHaveClass("justify-between");
    expect(comparison.querySelector("svg")).toBeNull();
  }
  expect(screen.getByTestId("monthly-cost-comparison-api")).toHaveTextContent(
    "spend.monthly_change.increase:20.0%",
  );
  expect(screen.getByTestId("monthly-cost-comparison-api")).toHaveClass("text-emerald-600");
  expect(screen.getByTestId("monthly-cost-comparison-subscription")).toHaveClass("text-emerald-600");
});

it("visually separates the summary and each existing management section without changing their controls", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      tokenPackages={[]}
      providerApiBalances={[]}
      apiBillingAccounts={[]}
      subscriptionRecords={[]}
    />,
  );

  expect(screen.getByTestId("cost-summary-region")).toHaveClass("rounded-xl", "border");
  expect(screen.getAllByTestId("cost-summary-icon")).toHaveLength(4);
  expect(screen.getByTestId("cost-summary-icon-api")).toHaveAttribute("data-tone", "blue");
  expect(screen.getByTestId("cost-summary-icon-subscription")).toHaveAttribute("data-tone", "violet");
  expect(screen.getByTestId("cost-summary-icon-total")).toHaveAttribute("data-tone", "green");
  expect(screen.getByTestId("cost-summary-icon-lifetime")).toHaveAttribute("data-tone", "orange");
  for (const id of ["token-packages", "provider-api", "api-billing", "subscriptions"]) {
    const section = document.querySelector(`[data-cost-section="${id}"]`);
    expect(section).toHaveClass("rounded-xl", "border");
    expect(within(section).getByTestId("cost-section-icon")).toBeInTheDocument();
  }
});

it("lets the user browse historical cost months without advancing into the future", () => {
  const onSelectedMonthChange = vi.fn();
  const { rerender } = render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      selectedMonth="2025-06"
      currentMonth="2026-07"
      onSelectedMonthChange={onSelectedMonthChange}
      otherAiGroupCosts={[{
        group_id: "learning",
        group_name: "AI learning",
        record_count: 1,
        month_usd: 10,
        month_cny: 72,
        year_usd: 30,
        year_cny: 216,
        lifetime_usd: 60,
        lifetime_cny: 432,
      }]}
    />,
  );

  const picker = screen.getByLabelText("spend.cost.month_picker.label");
  expect(picker).toHaveValue("2025-06");
  expect(picker).toHaveAttribute("max", "2026-07");
  expect(screen.getByText("2025年6月 spend.cost.summary.api_suffix")).toBeInTheDocument();
  expect(screen.getByText("2025年6月 spend.cost.summary.subscription_suffix")).toBeInTheDocument();
  expect(screen.getByText("2025年6月 spend.cost.summary.total_suffix")).toBeInTheDocument();
  expect(screen.getByText("2025年6月")).toBeInTheDocument();
  expect(screen.getByText("2025年截至6月")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "spend.cost.month_picker.previous" }));
  fireEvent.click(screen.getByRole("button", { name: "spend.cost.month_picker.next" }));
  expect(onSelectedMonthChange).toHaveBeenNthCalledWith(1, "2025-05");
  expect(onSelectedMonthChange).toHaveBeenNthCalledWith(2, "2025-07");

  fireEvent.change(picker, { target: { value: "2027-01" } });
  expect(onSelectedMonthChange).not.toHaveBeenCalledWith("2027-01");

  rerender(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      selectedMonth="2026-07"
      currentMonth="2026-07"
      onSelectedMonthChange={onSelectedMonthChange}
    />,
  );
  expect(screen.getByRole("button", { name: "spend.cost.month_picker.next" })).toBeDisabled();
});

describe("getMonthComparison MoM copy boundary", () => {
  const usdToCny = 7.2;

  it("labels an increase with the increase copy key and emerald class", () => {
    const result = getMonthComparison(150, 100, usdToCny);
    expect(result.label).toContain("spend.monthly_change.increase");
    expect(result.label).toContain("50.0%");
    expect(result.className).toContain("text-emerald-600");
  });

  it("labels a decrease with the decrease copy key and emerald class", () => {
    const result = getMonthComparison(50, 100, usdToCny);
    expect(result.label).toContain("spend.monthly_change.decrease");
    expect(result.label).toContain("50.0%");
    expect(result.className).toContain("text-emerald-600");
  });

  it("labels a flat comparison when both periods are zero", () => {
    const result = getMonthComparison(0, 0, usdToCny);
    expect(result.label).toContain("spend.monthly_change.flat_percent");
    expect(result.className).toContain("text-oai-gray-400");
  });

  it("uses a finite percentage when the previous month is zero", () => {
    const result = getMonthComparison(50, 0, usdToCny);
    expect(result.label).toContain("spend.monthly_change.increase");
    expect(result.label).toContain("100.0%");
    expect(result.label).not.toMatch(/Infinity|∞|NaN/);
    expect(result.className).toContain("text-emerald-600");
  });

  it("uses delta growth for the installed-ledger API and total values", () => {
    const api = getMonthComparison(6603.138389, 463.393724, usdToCny);
    const total = getMonthComparison(6749.666167, 472.143724, usdToCny);

    expect(api.label).toContain("spend.monthly_change.increase");
    expect(api.label).toContain("1325.0%");
    expect(total.label).toContain("1329.6%");
  });
});

// --------------------------------------------------------------------------
// Task-10 / F6: unknown cost must render "—", never fake 0.
// --------------------------------------------------------------------------

it("Task-10: summary cards render an explicit unavailable state when totals are null", () => {
  render(
    <CostAccumulation
      costSummary={{
        ...BASE_SUMMARY,
        monthApiCostUsd: null,
        monthSubscriptionCostUsd: null,
        monthTotalCostUsd: null,
        lifetimeTotalCostUsd: null,
      }}
    />
  );
  expect(screen.getAllByText("shared.data.not_provided").length).toBeGreaterThanOrEqual(4);
  expect(document.body).not.toHaveTextContent("—");
  expect(screen.queryByText("USD 0.00")).not.toBeInTheDocument();
});

it("Task-10: summary cards render 'USD 0.00' when costSummary totals are real 0", () => {
  render(<CostAccumulation costSummary={{ ...BASE_SUMMARY }} />);
  // Real zeros must render as "USD 0.00", NOT "—". There should be at least
  // 4 "USD 0.00" nodes (one per summary card's USD line).
  const zeroNodes = screen.getAllByText("USD 0.00");
  expect(zeroNodes.length).toBeGreaterThanOrEqual(4);
});

it("Task-10: a real non-zero total renders the formatted amount, not '—'", () => {
  render(
    <CostAccumulation
      costSummary={{
        ...BASE_SUMMARY,
        monthApiCostUsd: 12.5,
        monthSubscriptionCostUsd: 0,
        monthTotalCostUsd: 12.5,
        lifetimeTotalCostUsd: 100,
      }}
    />
  );
  // monthApiCostUsd and monthTotalCostUsd are both 12.5 → two "USD 12.50" nodes.
  expect(screen.getAllByText("USD 12.50").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("USD 100.00")).toBeInTheDocument();
  // Real 0 subscription still renders "0.00", not "—".
  expect(screen.getAllByText("USD 0.00").length).toBeGreaterThanOrEqual(1);
});

it("Task-10: API billing card shows an explicit unavailable state for null costs", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      apiBillingAccounts={[
        {
          id: "acc-1",
          provider: "openai",
          accountName: "OpenAI Usage",
          billingSource: "api",
          monthCostUsd: null,
          lifetimeCostUsd: null,
          status: "synced",
          lastSyncedAt: "2026-07-01T00:00:00.000Z",
        },
      ]}
    />
  );
  const section = screen.getByText("spend.cost.api_billing.section").closest("section");
  expect(section).not.toBeNull();
  const monthCostLine = within(section).getByText(/spend\.cost\.api_billing\.month_cost:/);
  const lifetimeCostLine = within(section).getByText(/spend\.cost\.api_billing\.lifetime_cost:/);
  expect(monthCostLine.textContent).toContain("shared.data.not_provided");
  expect(lifetimeCostLine.textContent).toContain("shared.data.not_provided");
  expect(section.textContent).not.toContain("—");
  expect(section.textContent).not.toContain("USD 0.00");
});

it("Task-10: API billing card shows 'USD 0.00' for a synced account with real 0 monthCostUsd", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      apiBillingAccounts={[
        {
          id: "acc-1",
          provider: "openai",
          accountName: "OpenAI Usage",
          billingSource: "api",
          monthCostUsd: 0,
          lifetimeCostUsd: 0,
          status: "synced",
          lastSyncedAt: "2026-07-01T00:00:00.000Z",
        },
      ]}
    />
  );
  const section = screen.getByText("spend.cost.api_billing.section").closest("section");
  expect(section).not.toBeNull();
  // Real 0 must render "USD 0.00", not "—".
  const monthCostLine = within(section).getByText(/spend\.cost\.api_billing\.month_cost:/);
  const lifetimeCostLine = within(section).getByText(/spend\.cost\.api_billing\.lifetime_cost:/);
  expect(monthCostLine.textContent).toContain("USD 0.00");
  expect(lifetimeCostLine.textContent).toContain("USD 0.00");
});

it("Task-10: API billing card shows an explicit unavailable state when not connected", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      apiBillingAccounts={[
        {
          id: "acc-1",
          provider: "openai",
          accountName: "OpenAI Usage",
          billingSource: "api",
          monthCostUsd: 50,
          lifetimeCostUsd: 500,
          status: "not-connected",
          lastSyncedAt: null,
        },
      ]}
    />
  );
  const section = screen.getByText("spend.cost.api_billing.section").closest("section");
  expect(section).not.toBeNull();
  const monthCostLine = within(section).getByText(/spend\.cost\.api_billing\.month_cost:/);
  const lifetimeCostLine = within(section).getByText(/spend\.cost\.api_billing\.lifetime_cost:/);
  expect(monthCostLine.textContent).toContain("shared.data.not_provided");
  expect(lifetimeCostLine.textContent).toContain("shared.data.not_provided");
  expect(section.textContent).not.toContain("—");
  expect(section.textContent).not.toContain("USD 50.00");
});

it("uses compact CNY and full-copy comparisons in the monthly summary", () => {
  render(
    <CostAccumulation
      costSummary={{
        ...BASE_SUMMARY,
        monthApiCostUsd: 13548.56,
        previousMonthApiCostUsd: 100,
        monthSubscriptionCostUsd: 0,
        previousMonthSubscriptionCostUsd: 0,
        monthTotalCostUsd: 13548.56,
        previousMonthTotalCostUsd: 100,
        lifetimeTotalCostUsd: 15000,
        usdToCny: 7.2,
      }}
    />,
  );

  expect(screen.getAllByText("CNY 9.75万").length).toBeGreaterThanOrEqual(1);
  const comparison = screen.getByTestId("monthly-cost-comparison-api");
  expect(comparison.querySelector("svg")).toBeNull();
  expect(comparison).toHaveTextContent("spend.monthly_change.increase:13448.6%");
});

// --------------------------------------------------------------------------
// F5: subscription form cycle select uses one_time (underscore) on the wire.
// --------------------------------------------------------------------------

it("F5: subscription form cycle select offers one_time (underscore), not one-time (hyphen)", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      subscriptionFormState="new"
      onAddSubscription={() => {}}
      onSaveSubscription={() => {}}
      onCancelSubscriptionForm={() => {}}
    />
  );
  const form = screen.getByTestId("subscription-form");
  const cycleOptions = within(form).getAllByRole("option");
  const cycleValues = cycleOptions.map((o) => o.getAttribute("value"));
  expect(cycleValues).toContain("one_time");
  expect(cycleValues).not.toContain("one-time");
});

// --------------------------------------------------------------------------
// F6: subscription form currency select offers ONLY USD and CNY.
// --------------------------------------------------------------------------

it("F6: subscription form currency select offers only USD and CNY (no EUR/GBP)", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      subscriptionFormState="new"
      onAddSubscription={() => {}}
      onSaveSubscription={() => {}}
      onCancelSubscriptionForm={() => {}}
    />
  );
  const form = screen.getByTestId("subscription-form");
  const currencyOptions = within(form).getAllByRole("option");
  const currencyValues = currencyOptions.map((o) => o.getAttribute("value"));

  expect(currencyValues).toContain("USD");
  expect(currencyValues).toContain("CNY");
  expect(currencyValues).not.toContain("EUR");
  expect(currencyValues).not.toContain("GBP");
});

it("OTHER-AI: renders each custom group's month, year, and lifetime costs", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      otherAiGroupCosts={[{
        group_id: "learning",
        group_name: "AI learning",
        record_count: 3,
        month_usd: 10,
        month_cny: 72,
        year_usd: 30,
        year_cny: 216,
        lifetime_usd: 60,
        lifetime_cny: 432,
      }]}
    />
  );
  const section = screen.getByText("spend.cost.other_ai_groups.section").closest("section");
  expect(section).not.toBeNull();
  expect(within(section).getByText("AI learning")).toBeInTheDocument();
  expect(within(section).getByText("spend.cost.other_ai_groups.month")).toBeInTheDocument();
  expect(within(section).getByText("spend.cost.other_ai_groups.year")).toBeInTheDocument();
  expect(within(section).getByText("spend.cost.other_ai_groups.lifetime")).toBeInTheDocument();
  expect(within(section).getByText("USD 10.00")).toBeInTheDocument();
  expect(within(section).getByText("USD 30.00")).toBeInTheDocument();
  expect(within(section).getByText("USD 60.00")).toBeInTheDocument();
  const grid = within(section).getByTestId("compact-cost-group-grid");
  expect(grid).toBeInTheDocument();
  expect(grid.className).toMatch(/minmax\(300px/);
  expect(within(section).getByTestId("compact-cost-group-learning")).toHaveAttribute("data-density", "compact");
});

it("OTHER-AI: long group name and six distinct month/year/lifetime amounts remain readable", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      otherAiGroupCosts={[{
        group_id: "learning",
        group_name: "AI 学习投入与长期订阅",
        record_count: 3,
        month_usd: 1234.56,
        month_cny: 8888.88,
        year_usd: 12345.67,
        year_cny: 88888.88,
        lifetime_usd: 123456.78,
        lifetime_cny: 888888.88,
      }]}
    />
  );

  const section = screen.getByText("spend.cost.other_ai_groups.section").closest("section");
  expect(section).not.toBeNull();
  expect(within(section).getByTestId("compact-cost-group-grid")).toBeInTheDocument();

  for (const amount of [
    "USD 1,234.56",
    "CNY 8,888.88",
    "USD 12,345.67",
    "CNY 88,888.88",
    "USD 123,456.78",
    "CNY 888,888.88",
  ]) {
    expect(within(section).getByText(amount)).toBeVisible();
  }

  const usdNode = within(section).getByText("USD 123,456.78");
  // formatDualAmount root is flex-col; its parent is the period amount wrapper.
  const dualRoot = usdNode.closest("div.flex.flex-col");
  const amountContainer = dualRoot?.parentElement;
  expect(amountContainer).toBeTruthy();
  expect(amountContainer).not.toHaveClass("truncate");
  expect(amountContainer).not.toHaveClass("overflow-hidden");
  expect(amountContainer).not.toHaveClass("whitespace-nowrap");
  expect(amountContainer.className).not.toMatch(/\btruncate\b/);

  const title = within(section).getByText("AI 学习投入与长期订阅");
  expect(title).not.toHaveClass("truncate");
  expect(title).not.toHaveClass("overflow-hidden");
  expect(title).toHaveClass("text-sm");
  for (const amountContainerNode of within(section).getAllByTestId("compact-cost-group-amount")) {
    expect(amountContainerNode).toHaveClass("text-xs");
    expect(amountContainerNode).not.toHaveClass("truncate");
  }
});
