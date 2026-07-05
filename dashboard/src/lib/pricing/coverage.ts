import type { PricingCoverage } from "../types/usage";

export interface PricingCoverageResult {
  priced_tokens: number;
  unpriced_tokens: number;
  pricing_coverage: PricingCoverage;
}

export function computePricingCoverage(
  pricedTokens: number,
  unpricedTokens: number
): PricingCoverageResult {
  const total = pricedTokens + unpricedTokens;
  if (total === 0) {
    return { priced_tokens: 0, unpriced_tokens: 0, pricing_coverage: "complete" };
  }
  if (unpricedTokens === 0) {
    return { priced_tokens: total, unpriced_tokens: 0, pricing_coverage: "complete" };
  }
  if (pricedTokens === 0) {
    return { priced_tokens: 0, unpriced_tokens: total, pricing_coverage: "unpriced" };
  }
  return { priced_tokens: pricedTokens, unpriced_tokens: unpricedTokens, pricing_coverage: "partial" };
}