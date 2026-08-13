import { describe, expect, it } from "vitest";
import { computeSubscriptionRoi } from "./subscription-roi";

// V2-W2 subscription ROI: "每 1 元订阅用出了多少钱的 API 等价价值"。
// multiplier = usage API-equivalent value / subscription cost (same currency).

describe("computeSubscriptionRoi", () => {
  it("computes the multiplier from usage value and subscription cost", () => {
    const roi = computeSubscriptionRoi({
      monthApiCostUsd: 316,
      monthSubscriptionCostUsd: 20,
    });
    expect(roi).not.toBeNull();
    expect(roi!.multiplier).toBeCloseTo(15.8, 5);
    expect(roi!.usageValueUsd).toBe(316);
    expect(roi!.subscriptionCostUsd).toBe(20);
  });

  it("returns null when there is no subscription spend", () => {
    expect(
      computeSubscriptionRoi({ monthApiCostUsd: 100, monthSubscriptionCostUsd: 0 }),
    ).toBeNull();
    expect(
      computeSubscriptionRoi({ monthApiCostUsd: 100, monthSubscriptionCostUsd: null }),
    ).toBeNull();
    expect(
      computeSubscriptionRoi({ monthApiCostUsd: 100, monthSubscriptionCostUsd: undefined }),
    ).toBeNull();
  });

  it("returns null when usage value is unknown (never fakes 0)", () => {
    expect(
      computeSubscriptionRoi({ monthApiCostUsd: null, monthSubscriptionCostUsd: 20 }),
    ).toBeNull();
    expect(
      computeSubscriptionRoi({ monthApiCostUsd: Number.NaN, monthSubscriptionCostUsd: 20 }),
    ).toBeNull();
  });

  it("keeps a real zero usage value as multiplier 0 (not null)", () => {
    const roi = computeSubscriptionRoi({
      monthApiCostUsd: 0,
      monthSubscriptionCostUsd: 20,
    });
    expect(roi).not.toBeNull();
    expect(roi!.multiplier).toBe(0);
  });

  it("handles below-one multipliers without rounding them away", () => {
    const roi = computeSubscriptionRoi({
      monthApiCostUsd: 5,
      monthSubscriptionCostUsd: 20,
    });
    expect(roi!.multiplier).toBeCloseTo(0.25, 5);
  });
});
