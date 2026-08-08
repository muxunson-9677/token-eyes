export function getCumulativeYesterdayComparison(total, today) {
  const totalValue = Number(total);
  const todayValue = Number(today);
  if (
    !Number.isFinite(totalValue)
    || !Number.isFinite(todayValue)
    || totalValue < 0
    || todayValue < 0
    || todayValue > totalValue
  ) {
    return null;
  }

  const yesterdayTotal = totalValue - todayValue;
  if (yesterdayTotal <= 0) return null;

  return {
    change: todayValue,
    percent: (todayValue / yesterdayTotal) * 100,
  };
}
