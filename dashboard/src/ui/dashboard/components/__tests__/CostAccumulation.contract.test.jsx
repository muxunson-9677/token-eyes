import React from "react";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CostAccumulation } from "../CostAccumulation.jsx";

// 02 work order contract tests for CostAccumulation.
//
// Covers:
//  - F6/Task-10 (未知成本不得显示 0): missing totals → "—", real 0 → "0.00".
//    Both summary cards and API billing cards must distinguish "field absent"
//    from "genuinely zero cost".
//  - F5 (one_time contract): the subscription form's cycle select offers the
//    wire-contract value `one_time` (underscore), not `one-time` (hyphen).
//  - F6 (currency contract): the subscription form's currency select offers
//    ONLY USD and CNY — EUR/GBP are removed.

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key) => key,
}));

const BASE_SUMMARY = {
  monthApiCostUsd: 0,
  monthSubscriptionCostUsd: 0,
  monthTotalCostUsd: 0,
  lifetimeTotalCostUsd: 0,
  usdToCny: 7.2,
};

// --------------------------------------------------------------------------
// Task-10 / F6: unknown cost must render "—", never fake 0.
// --------------------------------------------------------------------------

it("Task-10: summary cards render '—' when costSummary totals are null (missing)", () => {
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
  // The summary section renders four cards. Each card's value is a dual
  // USD/CNY block; when the USD total is null, both lines must be "—".
  // Assert that "—" appears (and never "USD 0.00" for the missing fields).
  const dashes = screen.getAllByText("—");
  // 4 cards × 2 lines (USD + CNY) = 8 "—" at minimum (provider/api sections
  // may contribute more). The key assertion: there ARE dashes, and NO
  // "USD 0.00" text node for the summary totals.
  expect(dashes.length).toBeGreaterThanOrEqual(8);
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

it("Task-10: API billing card shows '—' for a synced account with null monthCostUsd", () => {
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
  // The API billing card renders the cost inline: "spend.cost.api_billing.month_cost: —".
  // Use a regex to match the "—" within the billing section. The key assertion:
  // a synced account with null cost shows "—", never "USD 0.00".
  const section = screen.getByText("spend.cost.api_billing.section").closest("section");
  expect(section).not.toBeNull();
  const monthCostLine = within(section).getByText(/spend\.cost\.api_billing\.month_cost:/);
  const lifetimeCostLine = within(section).getByText(/spend\.cost\.api_billing\.lifetime_cost:/);
  expect(monthCostLine.textContent).toContain("—");
  expect(lifetimeCostLine.textContent).toContain("—");
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

it("Task-10: API billing card shows '—' for a not-connected account regardless of cost fields", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      apiBillingAccounts={[
        {
          id: "acc-1",
          provider: "openai",
          accountName: "OpenAI Usage",
          billingSource: "api",
          monthCostUsd: 50, // even if a value is present, not-connected → "—"
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
  expect(monthCostLine.textContent).toContain("—");
  expect(lifetimeCostLine.textContent).toContain("—");
  expect(section.textContent).not.toContain("USD 50.00");
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
  const cycleSelect = within(form).getByDisplayValue; // helper
  // The cycle select must have an option with value "one_time" and must NOT
  // have an option with value "one-time".
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
