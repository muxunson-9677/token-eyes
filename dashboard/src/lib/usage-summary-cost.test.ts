import { describe, expect, it } from "vitest";
import { resolveSummaryCostUsd } from "./usage-summary-cost";

describe("resolveSummaryCostUsd", () => {
  it("prefers queue-calibrated cost_usd over legacy total_cost_usd", () => {
    expect(resolveSummaryCostUsd({ cost_usd: 78.196598, total_cost_usd: "0.000000" })).toBe(
      78.196598,
    );
  });

  it("falls back to total_cost_usd for legacy summary responses", () => {
    expect(resolveSummaryCostUsd({ total_cost_usd: "12.340000" })).toBe(12.34);
  });
});
