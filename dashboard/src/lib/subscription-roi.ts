// V2-W2 subscription ROI ("回本倍数").
//
// multiplier = month API-equivalent usage value / month subscription spend,
// both in USD as computed server-side (subscription CNY amounts are already
// converted with the pricing engine's usdToCny rate before they reach the
// dashboard). Unknown inputs return null — the UI must never fake a 0.

export interface SubscriptionRoiInput {
  monthApiCostUsd: number | null | undefined;
  monthSubscriptionCostUsd: number | null | undefined;
}

export interface SubscriptionRoiResult {
  multiplier: number;
  usageValueUsd: number;
  subscriptionCostUsd: number;
}

export function computeSubscriptionRoi(
  input: SubscriptionRoiInput,
): SubscriptionRoiResult | null {
  const usageValueUsd = Number(input.monthApiCostUsd);
  const subscriptionCostUsd = Number(input.monthSubscriptionCostUsd);
  if (
    input.monthApiCostUsd === null ||
    input.monthApiCostUsd === undefined ||
    Number.isNaN(usageValueUsd) ||
    usageValueUsd < 0
  ) {
    return null;
  }
  if (!Number.isFinite(subscriptionCostUsd) || subscriptionCostUsd <= 0) {
    return null;
  }
  return {
    multiplier: usageValueUsd / subscriptionCostUsd,
    usageValueUsd,
    subscriptionCostUsd,
  };
}
