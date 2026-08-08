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
//  - MoM copy direction: cost increase orange, decrease emerald; copy keys accurate.

vi.mock("react-router-dom", async () => {
  const ReactModule = await import("react");
  return {
    useNavigate: () => {
      ReactModule.useState(null);
      return vi.fn();
    },
  };
});

vi.mock("../../../../lib/copy", () => ({
  getCopyLocale: () => "en-US",
  copy: (key, params) => {
    if (key === "shared.unit.percent") return "%";
    if (!params) return key;
    if (key === "spend.monthly_change.with_amount") return `${params.change} · ${params.amount}`;
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

it("renders asynchronously loaded Other AI groups without changing the hook order", () => {
  const props = {
    costSummary: { ...BASE_SUMMARY },
    otherAiGroupCosts: [],
  };
  const { rerender } = render(<CostAccumulation {...props} />);

  expect(document.querySelector('[data-cost-section="other-ai"]')).toBeNull();
  rerender(React.createElement(CostAccumulation, {
    ...props,
    otherAiGroupCosts: [{
        id: "group-1",
        name: "VPN",
        month_usd: 8,
        records: [],
    }],
  }));
  expect(document.querySelector('[data-cost-section="other-ai"]')).toBeTruthy();
});

it("keeps the stale provider status on one line inside the collapsed action row", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      providerApiBalances={[{
        configId: "provider-1",
        providerId: "deepseek",
        accountLabel: "DeepSeek",
        status: "synced",
        balance: 688.21,
        monthSpend: 0,
        lifetimeSpend: 0,
        currency: "USD",
      }]}
      providerApiStale
      onRefreshAllProviderApis={() => {}}
      onRefreshOneProviderApi={() => {}}
      sectionsInitiallyOpen={false}
    />,
  );

  const section = document.querySelector('[data-cost-section="provider-api"]');
  const staleStatus = within(section).getByText("spend.cost.provider_account.stale");

  expect(staleStatus).toHaveClass("shrink-0", "whitespace-nowrap");
  expect(staleStatus.parentElement).toHaveClass("whitespace-nowrap");
});

it("keeps estimated usage cost and actual subscription spend separate without a combined total", () => {
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
  expect(screen.queryByTestId("monthly-cost-comparison-total")).not.toBeInTheDocument();
  for (const testId of ["api", "subscription"]) {
    const comparison = screen.getByTestId(`monthly-cost-comparison-${testId}`);
    expect(comparison.parentElement).toHaveTextContent("CNY");
    expect(comparison.parentElement).toHaveClass("justify-between");
    expect(comparison.querySelector("svg")).toBeNull();
  }
  expect(screen.getByTestId("monthly-cost-comparison-api")).toHaveTextContent(
    "spend.monthly_change.increase:20.0%",
  );
  expect(screen.getByTestId("monthly-cost-comparison-api")).toHaveTextContent("USD 20.00");
  expect(screen.getByTestId("monthly-cost-comparison-api")).toHaveClass("text-orange-600");
  expect(screen.getByTestId("monthly-cost-comparison-subscription")).toHaveClass("text-emerald-600");
  expect(screen.getByText("spend.cost.summary.scope_note")).toBeInTheDocument();
  expect(screen.getByTestId("cost-confidence-estimated")).toHaveAttribute(
    "data-confidence-state",
    "estimated",
  );
  expect(screen.getByTestId("cost-confidence-subscription")).toHaveAttribute(
    "data-confidence-state",
    "exact",
  );
});

it("starts the cost-page groups collapsed when requested and expands their full content without clipping", () => {
  render(
    <CostAccumulation
      sectionsInitiallyOpen={false}
      costSummary={{ ...BASE_SUMMARY }}
      tokenPackages={[{
        id: "plan-1",
        name: "Codex Pro",
        provider: "OpenAI",
        quota: "5.00M",
        used: "1.79M",
        remaining: "3.21M",
        syncStatus: "synced",
        syncStatusLabel: "Synced",
      }]}
    />,
  );

  const section = document.querySelector('[data-cost-section="token-packages"]');
  const toggle = within(section).getByRole("button");

  expect(section).toHaveAttribute("data-open", "false");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(section).getByTestId("cost-row-metrics")).toHaveAttribute("data-align", "right");
  expect(within(section).queryByText("Codex Pro")).not.toBeInTheDocument();

  fireEvent.click(toggle);

  expect(section).toHaveAttribute("data-open", "true");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(section).getByText("Codex Pro")).toBeVisible();
});

it("uses the reference-style expanded layouts for custom groups, token packages, and provider accounts", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      otherAiGroupCosts={[{
        group_id: "api",
        group_name: "API",
        record_count: 4,
        month_usd: 119.44,
        month_cny: 860,
        year_usd: 300,
        year_cny: 2160,
        lifetime_usd: 600,
        lifetime_cny: 4320,
      }]}
      tokenPackages={[{
        id: "plan-1",
        name: "Codex Pro",
        provider: "Codex",
        quota: "5.00M",
        used: "1.79M",
        remaining: "3.21M",
        syncStatus: "synced",
        syncStatusLabel: "Synced",
      }]}
      providerApiBalances={[{
        configId: "provider-1",
        providerId: "deepseek",
        accountLabel: "DeepSeek",
        status: "synced",
        balance: 91.57,
        monthSpend: 0,
        lifetimeSpend: 0,
        currency: "CNY",
        lastSyncedAt: "2026-08-05T09:06:45.000Z",
      }]}
      onRefreshAllProviderApis={() => {}}
      onRefreshOneProviderApi={() => {}}
      onRefreshTokenPackages={() => {}}
    />,
  );

  expect(screen.getByTestId("compact-cost-group-grid")).toHaveAttribute("data-layout", "reference-cost-group-grid");
  expect(screen.getByTestId("compact-cost-group-api")).toHaveAttribute("data-layout", "reference-cost-group");
  expect(screen.getByTestId("token-package-table")).toBeInTheDocument();
  expect(screen.getByTestId("provider-api-expanded-list")).toBeInTheDocument();
});

it("marks retained cost totals stale after a financial refresh failure", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY, monthApiCostUsd: 12, monthSubscriptionCostUsd: 8 }}
      costSummaryStale
      costLastSuccessfulAt="2026-08-01T08:00:00.000Z"
      error="selected-month cost totals: offline"
    />,
  );

  expect(screen.getByTestId("cost-confidence-estimated")).toHaveAttribute(
    "data-confidence-state",
    "stale",
  );
  expect(screen.getByTestId("cost-confidence-subscription")).toHaveAttribute(
    "data-confidence-state",
    "stale",
  );
});

it("replaces an internal local-service error with an actionable product message", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY, monthApiCostUsd: null, monthSubscriptionCostUsd: null }}
      error="selected-month totals: Local CLI not reachable on :7680 — start it with node bin/tracker.js serve"
    />,
  );

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("spend.cost.error.local_service_unreachable");
  expect(alert).not.toHaveTextContent("Local CLI not reachable");
  expect(alert).not.toHaveTextContent("bin/tracker.js");
});

it("visually separates the summary and each existing management section without changing their controls", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      selectedMonth="2026-07"
      currentMonth="2026-07"
      onSelectedMonthChange={() => {}}
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
      tokenPackages={[]}
      providerApiBalances={[]}
      apiBillingAccounts={[]}
      subscriptionRecords={[]}
    />,
  );

  const summary = screen.getByTestId("cost-summary-region");
  expect(summary).toHaveClass("tt-surface", "rounded-[var(--tt-card-radius)]");
  expect(summary).not.toHaveClass("tt-surface-nested");
  expect(screen.getAllByTestId("cost-summary-card")).toHaveLength(2);
  for (const card of screen.getAllByTestId("cost-summary-card")) {
    expect(card).toHaveClass("tt-surface-nested");
    expect(card).toHaveClass("flex", "h-full", "items-start", "text-left");
    expect(card).not.toHaveClass("tt-surface");
  }
  expect(screen.getByTestId("cost-confidence-estimated")).toHaveClass("justify-start", "text-left");
  expect(screen.getByTestId("cost-confidence-subscription")).toHaveClass("justify-start", "text-left");
  expect(screen.queryByTestId("cost-summary-icon-total")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("cost-summary-icon")).toHaveLength(2);
  expect(screen.getByTestId("cost-summary-icon-api")).toHaveAttribute("data-tone", "blue");
  expect(screen.getByTestId("cost-summary-icon-subscription")).toHaveAttribute("data-tone", "violet");
  const sectionIds = ["other-ai", "token-packages", "provider-api", "api-billing", "subscriptions"];
  expect(document.querySelectorAll("[data-cost-section]")).toHaveLength(5);
  expect([summary, ...document.querySelectorAll("[data-cost-section]")]).toHaveLength(6);
  for (const id of sectionIds) {
    const section = document.querySelector(`[data-cost-section="${id}"]`);
    expect(section).toHaveClass("tt-surface-nested", "rounded-[var(--tt-card-radius)]");
    expect(section).not.toHaveClass("tt-surface");
    expect(within(section).getByTestId("cost-section-icon")).toBeInTheDocument();
    const toggle = within(section).getByRole("button", { expanded: true });
    expect(toggle).toHaveClass(
      "tt-analytics-focusable",
      "tt-pressable",
      "rounded-[var(--tt-control-radius)]",
    );
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  expect(screen.getByLabelText("spend.cost.month_picker.label")).toBeInTheDocument();
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
  expect(picker).toHaveClass("h-10");
  expect(screen.getByRole("button", { name: "spend.cost.month_picker.previous" })).toHaveClass("h-10", "w-10");
  expect(screen.getByRole("button", { name: "spend.cost.month_picker.next" })).toHaveClass("h-10", "w-10");
  expect(picker).toHaveValue("2025-06");
  expect(picker).toHaveAttribute("max", "2026-07");
  expect(screen.getByTestId("cost-month-display")).toHaveTextContent("2025年6月");
  expect(screen.getByText("2025年6月 spend.cost.summary.estimated_usage_suffix")).toBeInTheDocument();
  expect(screen.getByText("2025年6月 spend.cost.summary.actual_subscription_suffix")).toBeInTheDocument();
  expect(screen.queryByText("2025年6月 spend.cost.summary.total_suffix")).not.toBeInTheDocument();
  expect(screen.getAllByText("2025年6月").length).toBeGreaterThanOrEqual(2);
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

  it("labels an increase with the confirmed increase copy key and orange class", () => {
    const result = getMonthComparison(150, 100, usdToCny);
    expect(result.label).toContain("spend.monthly_change.increase");
    expect(result.label).toContain("50.0%");
    expect(result.className).toContain("text-orange-600");
    expect(result.absoluteUsd).toBe(50);
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

  it("uses newly-added wording without inventing a percentage when the previous month is zero", () => {
    const result = getMonthComparison(50, 0, usdToCny);
    expect(result.label).toContain("spend.monthly_change.new_amount");
    expect(result.label).not.toContain("100.0%");
    expect(result.label).not.toMatch(/Infinity|∞|NaN/);
    expect(result.className).toContain("text-orange-600");
    expect(result.kind).toBe("new");
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
// Task-10 / F6: unknown cost must be omitted, never replaced with a placeholder or fake 0.
// --------------------------------------------------------------------------

it("Task-10: summary cards hide totals that were not provided", () => {
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
  expect(screen.queryByTestId("cost-summary-card")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("shared.data.not_provided");
  expect(document.body).not.toHaveTextContent("—");
  expect(screen.queryByText("USD 0.00")).not.toBeInTheDocument();
});

it("Task-10: summary cards render 'USD 0.00' when costSummary totals are real 0", () => {
  render(<CostAccumulation costSummary={{ ...BASE_SUMMARY }} />);
  // Real zeros must render as "USD 0.00", NOT "—". There should be at least
  // 2 "USD 0.00" nodes (one per separate summary card's USD line).
  const zeroNodes = screen.getAllByText("USD 0.00");
  expect(zeroNodes.length).toBeGreaterThanOrEqual(2);
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
  // Estimated API usage remains visible without a mixed combined total.
  expect(screen.getAllByText("USD 12.50").length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText("USD 100.00")).not.toBeInTheDocument();
  // Real 0 subscription still renders "0.00", not "—".
  expect(screen.getAllByText("USD 0.00").length).toBeGreaterThanOrEqual(1);
});

it("Task-10: API billing card hides null costs", () => {
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
  expect(within(section).queryByText(/spend\.cost\.api_billing\.month_cost:/)).not.toBeInTheDocument();
  expect(within(section).queryByText(/spend\.cost\.api_billing\.lifetime_cost:/)).not.toBeInTheDocument();
  expect(section.textContent).not.toContain("shared.data.not_provided");
  expect(section.textContent).not.toContain("—");
  expect(section.textContent).not.toContain("USD 0.00");
});

it("does not call a connected token package synchronized when quota fields are absent", () => {
  render(
    <CostAccumulation
      costSummary={{ ...BASE_SUMMARY }}
      tokenPackages={[{
        id: "plan-1",
        name: "Pro",
        provider: "Codex",
        quota: "—",
        used: "—",
        remaining: "—",
        syncStatus: "success",
        syncStatusLabel: "settings.token_plan.sync_status.success",
      }]}
    />,
  );

  expect(screen.getByText("spend.cost.token_package.connected_no_quota")).toBeInTheDocument();
  expect(screen.queryByText("settings.token_plan.sync_status.success")).not.toBeInTheDocument();
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

it("Task-10: API billing card hides costs when not connected", () => {
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
  expect(within(section).queryByText(/spend\.cost\.api_billing\.month_cost:/)).not.toBeInTheDocument();
  expect(within(section).queryByText(/spend\.cost\.api_billing\.lifetime_cost:/)).not.toBeInTheDocument();
  expect(section.textContent).not.toContain("shared.data.not_provided");
  expect(section.textContent).not.toContain("—");
  expect(section.textContent).not.toContain("USD 50.00");
});

it("uses compact CNY and the confirmed percentage-only comparison in the monthly summary", () => {
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
  expect(comparison).toHaveTextContent("USD 13,448.56");
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
  expect(grid).toHaveAttribute("data-layout", "reference-cost-group-grid");
  expect(grid).toHaveClass("tt-cost-group-grid");
  expect(within(section).getByTestId("compact-cost-group-learning")).toHaveAttribute("data-density", "reference");
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
    expect(amountContainerNode).toHaveClass("text-base");
    expect(amountContainerNode).not.toHaveClass("truncate");
  }
});
