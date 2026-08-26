import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { ValueComparisonPage } from "./ValueComparisonPage.jsx";

const { getValueComparison, peekValueComparison } = vi.hoisted(() => ({
  getValueComparison: vi.fn(),
  peekValueComparison: vi.fn(() => null),
}));
vi.mock("../lib/api", () => ({ getValueComparison, peekValueComparison }));

const payload = {
  requested_month: "2026-08",
  data_month: "2026-08",
  available_months: ["2026-08", "2026-07", "2026-06"],
  fallback_applied: false,
  actual_spend: { total_usd: { value: 10, unit: "USD", evidence_state: "exact" } },
  api_equivalent_value: {
    value: 20,
    unit: "USD",
    evidence_state: "estimated",
    evidence: {
      source_kind: "local_usage_log", record_count: 2,
      observed_from: "2026-08-21T07:00:00.000Z", observed_to: "2026-08-21T08:00:00.000Z",
      safe_record_refs: ["record-safe-a"],
      pricing: { state: "estimated", model: "gpt-5", source_url: "https://example.test/pricing", version: "2026-08-21" },
    },
  },
  value_multiple: { value: 2, unit: "times", evidence_state: "estimated" },
  recognized_tokens: { value: 1000 }, pricing_coverage_percent: { value: 80 },
  actual_composition: [
    { key: "subscription", value: 10, evidence_state: "exact" },
    { key: "official_api", value: null, evidence_state: "unsupported" },
    { key: "other_ai", value: 3, evidence_state: "exact" },
    { key: "token_plan", value: 2, evidence_state: "exact" },
    { key: "unknown", value: null, evidence_state: "unsupported" },
  ],
  value_composition: [{ key: "api_key", value: 20, evidence_state: "estimated" }],
  attribution: {
    linked: [{ plan_ref: "token-plan/codex/plan/codex_pro_20x", account_ref: "account/codex/official-bound", plan_label: "Pro 20x", association_state: "configured_current_account", observed_tokens: 1_000, api_equivalent_usd: 20 }],
    unattributed: [{ source: "claude", association_state: "usage_detected", observed_tokens: 500, api_equivalent_usd: 2 }],
  },
  native_resources: [{ provider: "workbuddy", label: "remaining", value: 180, unit: "Credits", evidence_state: "exact" }, { provider: "workbuddy", label: "today_consumed", value: 12, unit: "Credits", evidence_state: "observed" }],
  monthly_trend: Array.from({ length: 6 }, (_, index) => ({ bucket_start: `2026-0${index + 3}-01`, label: `${index + 3}月`, actual_spend_usd: 10, api_equivalent_usd: 20 })),
};

afterEach(() => {
  vi.restoreAllMocks();
  peekValueComparison.mockReset();
  peekValueComparison.mockReturnValue(null);
});

describe("ValueComparisonPage", () => {
  it("renders a cached aggregate immediately while a background refresh is still pending", () => {
    peekValueComparison.mockReturnValue(payload);
    getValueComparison.mockImplementation(() => new Promise(() => {}));
    render(<ValueComparisonPage />);
    expect(screen.getByText("$10.00", { selector: ".vr-value-number" })).toBeVisible();
    expect(screen.queryByText(copy("value.loading"))).not.toBeInTheDocument();
  });

  it("offers direct configuration links instead of leaving missing billing and pricing as dead-end labels", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      attribution: {
        linked: [{ ...payload.attribution.linked[0], observed_tokens: null, actual_spend_usd: null }],
        unattributed: [{ source: "claude", observed_tokens: null, api_equivalent_usd: null, actual_spend_usd: null }],
      },
    });
    render(<ValueComparisonPage />);
    expect((await screen.findAllByRole("link", { name: copy("value.action.configure_bill") })).every((link) => link.getAttribute("href") === "/spend/cost#subscriptions")).toBe(true);
    expect(screen.getByRole("link", { name: copy("value.action.configure_price") })).toHaveAttribute("href", "/settings/cost");
  });
  it("changes the actual data range through the segmented control", async () => {
    const user = userEvent.setup();
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    await screen.findAllByText("$20.00");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: copy("value.range.7d") }));
    });
    await waitFor(() => expect(getValueComparison).toHaveBeenLastCalledWith("7d", expect.any(AbortSignal), undefined));
  });

  it("lets one month selector drive the whole page and identifies a fallback data month", async () => {
    const user = userEvent.setup();
    getValueComparison.mockResolvedValue({
      ...payload,
      requested_month: "2026-08",
      data_month: "2026-07",
      fallback_applied: true,
    });
    render(<ValueComparisonPage />);
    expect(await screen.findByText(copy("value.month.fallback", { month: "2026年7月" }))).toBeVisible();
    await act(async () => {
      await user.selectOptions(screen.getByRole("combobox", { name: copy("value.month.select") }), "2026-06");
    });
    await waitFor(() => expect(getValueComparison).toHaveBeenLastCalledWith("month", expect.any(AbortSignal), "2026-06"));
  });

  it("renders real attribution rows and expandable evidence sections", async () => {
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    expect(await screen.findByText("Pro 20x")).toBeInTheDocument();
    expect(await screen.findByText(/claude/)).toBeInTheDocument();
    expect(await screen.findByText("500 Token")).toBeInTheDocument();
    expect(screen.queryByText(copy("value.table.unlinked", { source: "claude" }))).not.toBeInTheDocument();
    expect(await screen.findByText("总积分 180")).toBeInTheDocument();
    expect(await screen.findByText("已消耗 12")).toBeInTheDocument();
    expect(screen.getAllByText(/较上月/u)).toHaveLength(3);
    const detail = screen.getByText(copy("value.details.evidence")).closest("details");
    expect(detail.open).toBe(false);
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByText(copy("value.details.evidence")));
    });
    expect(detail.open).toBe(true);
    const pricingLinks = screen.getAllByRole("link", { name: copy("value_realtime.evidence.open_pricing") });
    expect(pricingLinks.length).toBeGreaterThan(0);
    expect(pricingLinks.every((link) => link.getAttribute("href") === "https://example.test/pricing")).toBe(true);
  });

  it("paginates every configured and detected Agent instead of truncating after five rows", async () => {
    const user = userEvent.setup();
    const linked = Array.from({ length: 8 }, (_, index) => ({
      plan_ref: `token-plan/custom/plan-${index}`,
      account_ref: `plan/custom-${index}`,
      source: `agent-${index + 1}`,
      plan_label: `自定义 Agent ${index + 1}`,
      association_state: "configured_plan",
      actual_spend_usd: index + 1,
      api_equivalent_usd: (index + 1) * 2,
    }));
    getValueComparison.mockResolvedValue({
      ...payload,
      attribution: { linked, unattributed: [{ source: "agent-9", association_state: "usage_detected", api_equivalent_usd: 1 }] },
    });
    render(<ValueComparisonPage />);

    expect(await screen.findByText("自定义 Agent 1")).toBeVisible();
    expect(screen.queryByText("自定义 Agent 6")).not.toBeInTheDocument();
    expect(screen.getByText(copy("value.table.page", { current: 1, total: 2 }))).toBeVisible();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: copy("value.table.next_page") }));
    });
    expect(await screen.findByText("自定义 Agent 6")).toBeVisible();
    expect(screen.getByText("agent-9")).toBeVisible();
    expect(screen.getByRole("button", { name: copy("value.table.previous_page") })).toBeEnabled();
  });

  it("keeps other AI and credits as separate actual-spend composition categories", async () => {
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    expect(await screen.findAllByText(copy("value.category.official_api"))).toHaveLength(1);
    expect(await screen.findAllByText(copy("value.category.other_ai"))).toHaveLength(1);
    expect(screen.getAllByText(copy("value.category.token_plan"))).toHaveLength(2);
    const valueLane = screen.getAllByText(copy("value.value_breakdown"))
      .find((node) => node.classList.contains("vr-composition-title"))?.parentElement;
    expect(valueLane).not.toBeNull();
    expect(valueLane).toHaveTextContent(copy("value.category.api_key"));
    expect(valueLane).toHaveTextContent("$20.00");
  });

  it("shows category-level fallback months and readable native points instead of a generic unconfigured state", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_composition: payload.actual_composition.map((row) => row.key === "other_ai"
        ? { ...row, source_month: "2026-07", fallback_applied: true }
        : row),
      value_composition: [
        { key: "subscription", value: 20, evidence_state: "estimated", source_month: "2026-08" },
        { key: "api_key", value: null, evidence_state: "unsupported", display_state: "not_detected" },
        { key: "token_plan", value: null, evidence_state: "exact", display_state: "native_only", native_resources: payload.native_resources },
        { key: "unknown", value: 2, evidence_state: "estimated", source_month: "2026-08" },
      ],
    });
    render(<ValueComparisonPage />);
    expect(await screen.findByText("7月数据")).toBeVisible();
    expect(screen.getByText("180 积分")).toBeVisible();
    expect(screen.getAllByText("所选月份无此类记录").length).toBeGreaterThan(0);
    expect(document.querySelector(".vr-comparison-columns")).not.toHaveTextContent("未配置");
  });

  it("shows observed API usage and native points without asking users to configure data that was already detected", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_composition: [
        { key: "subscription", value: 8, evidence_state: "exact" },
        {
          key: "official_api",
          value: null,
          evidence_state: "observed",
          display_state: "usage_detected",
          source_month: "2026-07",
          fallback_applied: true,
          observed_usage: { value: 12_345_678, unit: "tokens", evidence_state: "observed" },
        },
        { key: "other_ai", value: 2, evidence_state: "exact" },
        { key: "token_plan", value: null, evidence_state: "exact", display_state: "native_only", native_resources: payload.native_resources },
        { key: "unknown", value: null, evidence_state: "unsupported", display_state: "not_detected" },
      ],
      attribution: {
        linked: payload.attribution.linked,
        unattributed: [{
          source: "claude",
          association_state: "usage_detected",
          observed_tokens: 12_345_678,
          api_equivalent_usd: 2,
        }],
      },
    });
    render(<ValueComparisonPage />);
    await screen.findAllByText("1234.6万 Token");
    const actualLane = document.querySelector(".vr-comparison-columns > div:first-child");
    expect(actualLane).toHaveTextContent("1234.6万 Token");
    expect(actualLane).toHaveTextContent("7月数据");
    expect(actualLane).not.toHaveTextContent("用量已识别");
    expect(screen.getAllByText("1234.6万 Token").length).toBeGreaterThan(1);
    expect(document.querySelector(".vr-data-table")).not.toHaveTextContent(copy("value.category.usage_detected"));
    expect(screen.getAllByText("180 积分").length).toBeGreaterThan(0);
  });

  it("shows explicit provenance formulas on all three top metrics", async () => {
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    const actualCard = (await screen.findByText(copy("value.actual"), { selector: ".vr-value-label" })).closest("section");
    const valueCard = screen.getByText(copy("value.equivalent"), { selector: ".vr-value-label" }).closest("section");
    const multipleCard = screen.getByText(copy("value.multiple"), { selector: ".vr-value-label" }).closest("section");
    expect(actualCard).toHaveTextContent(copy("value.provenance.actual", { known: 2, total: 3 }));
    expect(valueCard).toHaveTextContent(copy("value.provenance.equivalent"));
    expect(multipleCard).toHaveTextContent(copy("value.provenance.multiple"));
    expect(valueCard).not.toHaveTextContent(copy("value.estimated"));
    expect(multipleCard).not.toHaveTextContent(copy("value.estimated"));
  });

  it("does not present a partial zero actual-spend total as a recorded bill", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_spend: { total_usd: { value: 0, unit: "USD", evidence_state: "partial" } },
    });
    render(<ValueComparisonPage />);
    const card = (await screen.findByText(copy("value.actual"), { selector: ".vr-value-label" })).closest("section");
    expect(card).toHaveTextContent(copy("value.table.bill_missing"));
    expect(card).not.toHaveTextContent("$0.00");
  });

  it("keeps a known positive partial spend visible while marking the bill incomplete", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_spend: { total_usd: { value: 8, unit: "USD", evidence_state: "partial" } },
    });
    render(<ValueComparisonPage />);
    const card = (await screen.findByText(copy("value.actual"), { selector: ".vr-value-label" })).closest("section");
    expect(card).toHaveTextContent("$8.00");
    expect(card).toHaveTextContent(copy("value.provenance.actual", { known: 2, total: 3 }));
    expect(card).toHaveTextContent(copy("value.month_compare.current_partial"));
    expect(card).not.toHaveTextContent(copy("value.table.bill_missing"));
  });

  it("labels a completely unknown bill as not recorded instead of generic no-data text", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_spend: { total_usd: { value: null, unit: "USD", evidence_state: "unsupported" } },
    });
    render(<ValueComparisonPage />);
    const card = (await screen.findByText(copy("value.actual"), { selector: ".vr-value-label" })).closest("section");
    expect(card).toHaveTextContent(copy("value.table.bill_missing"));
    expect(card).not.toHaveTextContent("$0.00");
    expect(card).not.toHaveTextContent(copy("value.data_unavailable"));
    expect(card).toHaveTextContent(copy("value.previous.actual", { value: "$10.00" }));
    expect(card).not.toHaveTextContent(copy("value.change_unavailable"));
  });

  it("explains an unavailable value multiple as awaiting a bill while preserving last month's real multiple", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_spend: { total_usd: { value: null, unit: "USD", evidence_state: "unsupported" } },
      value_multiple: { value: null, unit: "times", evidence_state: "unsupported" },
    });
    render(<ValueComparisonPage />);
    const card = (await screen.findByText(copy("value.multiple"), { selector: ".vr-value-label" })).closest("section");
    expect(card).toHaveTextContent(copy("value.multiple.pending_bill"));
    expect(card).toHaveTextContent(copy("value.previous.multiple", { value: "2.00×" }));
    expect(card).not.toHaveTextContent(copy("value.data_unavailable"));
  });

  it("does not turn an unreadable WorkBuddy Credits resource into zero", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      native_resources: [{ provider: "workbuddy", label: "Credits", value: null, unit: "Credits", evidence_state: "unavailable" }],
    });
    render(<ValueComparisonPage />);
    const resources = await waitFor(() => {
      const element = document.querySelector(".vr-native-resources");
      expect(element).not.toBeNull();
      return element;
    });
    expect(resources).toHaveTextContent(copy("value.data_unavailable"));
    expect(resources).toHaveTextContent("积分");
    expect(resources).not.toHaveTextContent("Credits");
    expect(resources).not.toHaveTextContent("0 积分");
  });

  it("keeps an exact zero bill as $0.00", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      actual_spend: { total_usd: { value: 0, unit: "USD", evidence_state: "exact" } },
    });
    render(<ValueComparisonPage />);
    const card = (await screen.findByText(copy("value.actual"), { selector: ".vr-value-label" })).closest("section");
    expect(card).toHaveTextContent("$0.00");
    expect(card).not.toHaveTextContent(copy("value.table.bill_missing"));
  });

  it("distinguishes an unavailable trend value from an exact zero", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      monthly_trend: [
        { bucket_start: "2026-03-01", label: "3月", actual_spend_usd: null, api_equivalent_usd: null },
        { bucket_start: "2026-04-01", label: "4月", actual_spend_usd: 0, api_equivalent_usd: 0 },
      ],
    });
    render(<ValueComparisonPage />);
    expect(await screen.findByLabelText(`3月 ${copy("value.actual")} ${copy("value.table.bill_missing")}`)).toBeVisible();
    expect(screen.getByLabelText(`3月 ${copy("value.chart.value_usd")} ${copy("value.data_unavailable")}`)).toBeVisible();
    expect(screen.getByLabelText(`4月 ${copy("value.actual")} $0.00`)).toBeVisible();
    expect(screen.getByLabelText(`4月 ${copy("value.chart.value_usd")} $0.00`)).toBeVisible();
  });

  it("renders a visible current-month value label and all three data-detail sections", async () => {
    getValueComparison.mockResolvedValue(payload);
    render(<ValueComparisonPage />);
    expect(await screen.findByText("$20.00", { selector: ".vr-month-current-values > strong" })).toBeVisible();
    expect(screen.getByText(copy("value.details.subscription"))).toBeVisible();
    expect(screen.getByText(copy("value.details.credits"))).toBeVisible();
    expect(screen.getByText(copy("value.details.evidence"))).toBeVisible();
    expect(screen.getByText(copy("value.details.subscription")).closest("summary").querySelector('.vr-detail-icon--blue [data-detail-icon="subscription"]')).not.toBeNull();
    expect(screen.getByText(copy("value.details.credits")).closest("summary").querySelector('.vr-detail-icon--orange [data-detail-icon="credits"]')).not.toBeNull();
    expect(screen.getByText(copy("value.details.evidence")).closest("summary").querySelector('.vr-detail-icon--violet [data-detail-icon="evidence"]')).not.toBeNull();
  });

  it("labels every real monthly API-equivalent value even when small bars are visually compressed", async () => {
    getValueComparison.mockResolvedValue({
      ...payload,
      monthly_trend: payload.monthly_trend.map((row, index) => ({ ...row, api_equivalent_usd: [2.03, 242.58, 246.39, 1362.54, 19924.15, 36771.66][index] })),
    });
    render(<ValueComparisonPage />);
    expect(await screen.findAllByTestId("monthly-value-label")).toHaveLength(6);
    expect(screen.getByText("$2.03", { selector: "[data-testid='monthly-value-label']" })).toBeVisible();
    expect(screen.getByText("$3.68万", { selector: "[data-testid='monthly-value-label']" })).toBeVisible();
    expect(screen.queryByText("$36771.66")).not.toBeInTheDocument();
    expect(screen.getByText("$3.68万", { selector: ".vr-y-axis > span" })).toBeVisible();
    const months = document.querySelectorAll(".vr-month");
    expect(months).toHaveLength(6);
    for (const month of months) {
      expect(month.querySelectorAll(".vr-month-series")).toHaveLength(2);
      expect(month.querySelectorAll(".vr-month-series > strong")).toHaveLength(2);
      expect(month.querySelectorAll(".vr-month-series > span")).toHaveLength(2);
    }
  });
});
