import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// W8 weekly bill share card ("AI 周账单").
// Echo copy keys so assertions stay locale-independent (test baseline is zh-CN).
vi.mock("../../lib/copy", () => ({
  copy: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  setCopyLocale: vi.fn(),
  getCopyLocale: () => "en",
}));

import { WeeklyBillCard } from "./variants/WeeklyBillCard.jsx";
import { ShareCard, SHARE_VARIANTS, getVariantSize } from "./ShareCard.jsx";
import { VARIANT_SIZES } from "./share-card-constants";
import { buildShareCardData, formatWowChange } from "./build-share-card-data";

const BASE_DATA = {
  handle: "Ada",
  startDate: "2026-01-01",
  activeDays: 30,
  totalTokens: 1000000,
  totalCost: 12.3,
  period: "week",
  periodFrom: "2026-08-03",
  periodTo: "2026-08-09",
  topModels: [
    { id: "claude-opus", name: "Claude Opus", tokens: 900000, percent: "72.0" },
  ],
  rank: null,
  heatmapWeeks: [],
  heatmapTotalDays: 0,
  heatmapActiveDays: 0,
  capturedAt: "2026-08-09T00:00:00Z",
  currency: "USD",
  exchangeRate: 1,
  weeklyBill: {
    weekCostUsd: 12.3,
    prevWeekCostUsd: 10,
    monthApiCostUsd: 48,
    monthSubscriptionCostUsd: 20,
  },
};

describe("WeeklyBillCard", () => {
  it("renders week spend, WoW change, top model and ROI multiplier", () => {
    render(<WeeklyBillCard data={BASE_DATA} />);

    expect(
      screen.getAllByText("share.card.weekly_bill.title").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("share.card.weekly_bill.week_spend")).toBeInTheDocument();

    expect(screen.getByTestId("weekly-bill-spend").textContent).toContain("$12.30");
    // (12.3 - 10) / 10 = +23%
    expect(screen.getByTestId("weekly-bill-wow").textContent).toContain("+23%");
    expect(screen.getByTestId("weekly-bill-top-model").textContent).toContain(
      "Claude Opus",
    );
    // computeSubscriptionRoi({ 48, 20 }) yields multiplier 2.4
    expect(screen.getByTestId("weekly-bill-roi").textContent).toContain(
      'share.card.weekly_bill.roi_value:{"multiplier":"2.4"}',
    );
    // Brand name appears like on the other variants.
    expect(screen.getAllByText("shared.app_name").length).toBeGreaterThan(0);
  });

  it("shows the neutral ROI empty state when computeSubscriptionRoi returns null", () => {
    render(
      <WeeklyBillCard
        data={{
          ...BASE_DATA,
          weeklyBill: {
            ...BASE_DATA.weeklyBill,
            monthApiCostUsd: null,
            monthSubscriptionCostUsd: null,
          },
        }}
      />,
    );

    expect(screen.getByText("share.card.weekly_bill.roi_empty")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-bill-roi").textContent).not.toContain(
      "share.card.weekly_bill.roi_value",
    );
  });

  it("shows a neutral placeholder when the previous week has no data", () => {
    render(
      <WeeklyBillCard
        data={{
          ...BASE_DATA,
          weeklyBill: { ...BASE_DATA.weeklyBill, prevWeekCostUsd: null },
        }}
      />,
    );

    expect(screen.getByTestId("weekly-bill-wow").textContent).toContain("—");
  });

  it("tolerates data without a weeklyBill block", () => {
    const { weeklyBill: _omitted, ...legacyData } = BASE_DATA;
    render(<WeeklyBillCard data={legacyData} />);
    expect(screen.getByTestId("weekly-bill-spend")).toBeInTheDocument();
  });
});

describe("weekly-bill variant registration", () => {
  it("is listed in SHARE_VARIANTS with a label key", () => {
    const entry = SHARE_VARIANTS.find((v) => v.id === "weekly-bill");
    expect(entry).toBeTruthy();
    expect(entry.labelKey).toBe("share.variant.weekly_bill");
  });

  it("has an explicit size in VARIANT_SIZES", () => {
    expect(VARIANT_SIZES["weekly-bill"]).toBeTruthy();
    expect(getVariantSize("weekly-bill")).toEqual(VARIANT_SIZES["weekly-bill"]);
  });

  it("renders the weekly bill card through ShareCard", () => {
    render(<ShareCard data={BASE_DATA} variant="weekly-bill" />);
    expect(screen.getByTestId("weekly-bill-card")).toBeInTheDocument();
  });
});

describe("buildShareCardData weeklyBill", () => {
  it("normalizes provided weekly bill inputs", () => {
    const data = buildShareCardData({
      handle: "Ada",
      startDate: null,
      activeDays: 0,
      summary: null,
      topModels: [],
      rank: null,
      period: "week",
      periodFrom: null,
      periodTo: null,
      weeklyBill: {
        weekCostUsd: 5,
        prevWeekCostUsd: 4,
        monthApiCostUsd: 30,
        monthSubscriptionCostUsd: 10,
      },
    });
    expect(data.weeklyBill).toEqual({
      weekCostUsd: 5,
      prevWeekCostUsd: 4,
      monthApiCostUsd: 30,
      monthSubscriptionCostUsd: 10,
    });
  });

  it("falls back to the week summary cost when no explicit week cost is given", () => {
    const data = buildShareCardData({
      handle: "Ada",
      startDate: null,
      activeDays: 0,
      summary: { total_cost_usd: 7.5, total_tokens: 10 },
      topModels: [],
      rank: null,
      period: "week",
      periodFrom: null,
      periodTo: null,
    });
    expect(data.weeklyBill.weekCostUsd).toBe(7.5);
    expect(data.weeklyBill.prevWeekCostUsd).toBeNull();
  });

  it("keeps the week cost null for non-week periods without explicit input", () => {
    const data = buildShareCardData({
      handle: "Ada",
      startDate: null,
      activeDays: 0,
      summary: { total_cost_usd: 7.5, total_tokens: 10 },
      topModels: [],
      rank: null,
      period: "month",
      periodFrom: null,
      periodTo: null,
    });
    expect(data.weeklyBill.weekCostUsd).toBeNull();
  });
});

describe("formatWowChange", () => {
  it("formats rises and drops with a sign", () => {
    expect(formatWowChange(12.3, 10)).toBe("+23%");
    expect(formatWowChange(8.8, 10)).toBe("-12%");
    expect(formatWowChange(10, 10)).toBe("+0%");
  });

  it("returns null when the previous week is unknown or zero", () => {
    expect(formatWowChange(12.3, null)).toBeNull();
    expect(formatWowChange(12.3, undefined)).toBeNull();
    expect(formatWowChange(12.3, 0)).toBeNull();
    expect(formatWowChange(null, 10)).toBeNull();
  });
});
