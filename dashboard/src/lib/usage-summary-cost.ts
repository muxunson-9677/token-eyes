function toFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function resolveSummaryCostUsd(summary: { cost_usd?: unknown; total_cost_usd?: unknown } | null | undefined): number | null {
  return toFiniteNumber(summary?.cost_usd) ?? toFiniteNumber(summary?.total_cost_usd);
}
