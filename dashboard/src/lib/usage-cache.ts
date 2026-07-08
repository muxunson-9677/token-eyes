const REAL_USAGE_CACHE_PREFIXES = [
  "tokentracker.usage.",
  "tokentracker.usageSummary.",
  "tokentracker.usageTrend.",
  "tokentracker.requestUsageRecords.",
  "tokentracker.providerStats.",
  "tokentracker.modelStats.",
  "tokentracker.projectUsage.",
];

export function clearDashboardUsageCachesForRealData() {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  let removed = 0;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (!REAL_USAGE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      window.localStorage.removeItem(key);
      removed += 1;
    }
  } catch {
    return removed;
  }
  return removed;
}
