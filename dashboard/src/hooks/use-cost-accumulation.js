import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTokenPlans, getSpendRecords, getSpendTimeseries, getApiBillingAccounts } from "../lib/api";
import { OTHER_AI_SPEND_SOURCE } from "../lib/cost-sources.js";
import { getCostMonthRanges } from "../lib/date-range";

/**
 * Cost Accumulation data hook (03-cost-billing).
 *
 * Fetches and manages cost accumulation data including:
 * - Token packages (from token plans)
 * - API billing accounts (derived from spend records)
 * - Subscription records (from spend records)
 * - Cost summary (computed from spend timeseries)
 */

const USD_TO_CNY = 7.2; // Approximate exchange rate

export function useCostAccumulation({
  selectedMonth,
  timeZone,
  tzOffsetMinutes,
  refreshRevision = 0,
  sources,
} = {}) {
  const [tokenPlans, setTokenPlans] = useState([]);
  const [spendRecords, setSpendRecords] = useState([]);
  const [spendTimeseries, setSpendTimeseries] = useState(null);
  const [previousMonthTimeseries, setPreviousMonthTimeseries] = useState(null);
  const [apiBillingAccounts, setApiBillingAccounts] = useState([]);
  const [otherAiGroupCosts, setOtherAiGroupCosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  // Fetch all data
  const fetchData = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const hasSources = Array.isArray(sources) && sources.length > 0;
      const monthRanges = getCostMonthRanges({
        selectedMonth,
        timeZone,
        offsetMinutes: tzOffsetMinutes,
      });
      const rangeParams = { timeZone, tzOffsetMinutes };

      // Fetch token plans and api billing always
      const plansPromise = getTokenPlans().catch((e) => {
        console.warn("[useCostAccumulation] failed to fetch token plans:", e);
        return { records: [] };
      });
      const billingPromise = getApiBillingAccounts().catch((e) => {
        console.warn("[useCostAccumulation] failed to fetch api billing accounts:", e);
        return { accounts: [] };
      });

      // Fetch spend records and timeseries only when there are visible sources
      const recordsPromise = hasSources
        ? getSpendRecords({
            ...monthRanges.selected,
            ...rangeParams,
            sources,
            summary_month: monthRanges.selectedMonth,
          }).catch((e) => {
            console.warn("[useCostAccumulation] failed to fetch spend records:", e);
            return { records: [] };
          })
        : Promise.resolve({ records: [] });
      const timeseriesPromise = hasSources
        ? getSpendTimeseries({ ...monthRanges.selected, ...rangeParams }).catch((e) => {
            console.warn("[useCostAccumulation] failed to fetch spend timeseries:", e);
            return null;
          })
        : Promise.resolve(null);
      const previousTimeseriesPromise = hasSources
        ? getSpendTimeseries({ ...monthRanges.comparison, ...rangeParams }).catch((e) => {
            console.warn("[useCostAccumulation] failed to fetch previous-month spend timeseries:", e);
            return null;
          })
        : Promise.resolve(null);

      const [plansResult, recordsResult, timeseriesResult, previousTimeseriesResult, billingResult] = await Promise.all([
        plansPromise,
        recordsPromise,
        timeseriesPromise,
        previousTimeseriesPromise,
        billingPromise,
      ]);

      if (requestId !== requestIdRef.current) return;

      setTokenPlans(Array.isArray(plansResult?.records) ? plansResult.records : []);
      setSpendRecords(Array.isArray(recordsResult?.records) ? recordsResult.records : []);
      setOtherAiGroupCosts(Array.isArray(recordsResult?.other_ai_group_totals)
        ? recordsResult.other_ai_group_totals.filter((group) => Number(group?.record_count || 0) > 0)
        : []);
      setSpendTimeseries(timeseriesResult || null);
      setPreviousMonthTimeseries(previousTimeseriesResult || null);
      setApiBillingAccounts(Array.isArray(billingResult?.accounts) ? billingResult.accounts : []);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err?.message || "Failed to load cost accumulation data");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [selectedMonth, timeZone, tzOffsetMinutes, sources]);

  // Initial fetch and refetch on refresh revision change
  useEffect(() => {
    fetchData();
  }, [fetchData, refreshRevision]);

  // Normalize API billing accounts for UI consumption
  const apiBillingAccountsNormalized = useMemo(() => {
    // F6/02 work order (未知成本不得显示 0): preserve null for missing cost
    // fields instead of masking with `?? 0`. The card renders "—" for null
    // and "0.00" for a real 0, so the user can distinguish "no data yet"
    // from "genuinely zero cost this period".
    return apiBillingAccounts.map((account, index) => ({
      id: account.id || `${account.provider}-${index}`,
      provider: account.provider,
      accountName: account.accountName,
      billingSource: account.billingSource,
      monthCostUsd: account.monthCostUsd ?? null,
      lifetimeCostUsd: account.lifetimeCostUsd ?? null,
      status: account.status || "not-connected",
      lastSyncedAt: account.lastSyncedAt || null,
    }));
  }, [apiBillingAccounts]);

  // Filter spend records by sources
  const filteredSpendRecords = useMemo(() => {
    if (!sources || sources.length === 0) return [];
    return spendRecords.filter((record) => sources.includes(record.source));
  }, [spendRecords, sources]);

  // Compute cost summary from spend timeseries or spend records
  const costSummary = useMemo(() => {
    // If we have timeseries data, use it
    if (spendTimeseries) {
      const totals = spendTimeseries?.totals;
      if (totals) {
        const previousTotals = previousMonthTimeseries?.totals || null;
        // F6/02 work order (未知成本不得显示 0): preserve null for missing
        // totals fields instead of masking with `?? 0`. A real 0 from the
        // backend (meaning "no cost incurred this period") stays 0 and renders
        // "0.00"; a missing field (null/undefined) stays null and renders "—".
        // The summary cards use formatDualAmount which shows "—" for null.
        // Totals identity (local-api spend timeseries):
        // combined_usd = api_usd + subscription_usd + other_ai_usd
        // MoM ranges come from getMonthComparisonRanges (MTD vs same elapsed
        // period last month) — never full calendar months.
        return {
          monthApiCostUsd: totals.api_usd ?? null,
          monthSubscriptionCostUsd: totals.subscription_usd ?? null,
          monthOtherAiCostUsd: totals.other_ai_usd ?? null,
          monthTotalCostUsd: totals.combined_usd ?? null,
          previousMonthApiCostUsd: previousTotals?.api_usd ?? null,
          previousMonthSubscriptionCostUsd: previousTotals?.subscription_usd ?? null,
          previousMonthOtherAiCostUsd: previousTotals?.other_ai_usd ?? null,
          previousMonthTotalCostUsd: previousTotals?.combined_usd ?? null,
          lifetimeTotalCostUsd: totals.lifetime_combined_usd ?? null,
          usdToCny: USD_TO_CNY,
        };
      }
    }

    // Fallback: compute from filtered spend records. These are arithmetic
    // sums over real records, so 0 means "no records" — a real zero, not a
    // missing field. Keep them as numbers so they render "0.00".
    return {
      monthApiCostUsd: null,
      monthSubscriptionCostUsd: null,
      monthOtherAiCostUsd: null,
      monthTotalCostUsd: null,
      previousMonthApiCostUsd: null,
      previousMonthSubscriptionCostUsd: null,
      previousMonthOtherAiCostUsd: null,
      previousMonthTotalCostUsd: null,
      lifetimeTotalCostUsd: null,
      usdToCny: USD_TO_CNY,
    };
  }, [spendTimeseries, previousMonthTimeseries]);

  // Transform spend records into subscription records format
  const subscriptionRecords = useMemo(() => {
    return filteredSpendRecords
      .filter((record) => String(record.source || "").toLowerCase() !== OTHER_AI_SPEND_SOURCE)
      .map((record) => ({
        id: record.id,
        name: record.plan_label || record.source || "未知",
        provider: record.source || "未知",
        cycle: normalizeCycle(record.billing_cycle),
        amount: record.amount || 0,
        currency: record.currency || "USD",
        startedAt: record.start_date || null,
        renewsAt: record.end_date || null,
        status: getSubscriptionStatus(record),
      }));
  }, [filteredSpendRecords]);

  // Transform token plans for display
  const tokenPackages = useMemo(() => {
    return tokenPlans.map((plan) => ({
      id: plan.id,
      name: plan.plan_label || "未知套餐",
      provider: plan.provider_id || plan.source || "未知",
      cycle: getPlanCycle(plan),
      quota: plan.total_quota_display || formatQuota(plan.total_quota, plan.quota_unit),
      used: formatQuota(plan.used_quota, plan.quota_unit),
      remaining: formatQuota(plan.remaining_quota, plan.quota_unit),
      expiresAt: plan.expires_at || null,
      syncStatus: plan.sync_status || plan.last_refresh_status || "not_configured",
      syncStatusLabel: getSyncStatusLabel(plan.sync_status || plan.last_refresh_status),
    }));
  }, [tokenPlans]);

  return {
    // Data
    tokenPackages,
    apiBillingAccounts: apiBillingAccountsNormalized,
    subscriptionRecords,
    costSummary,
    otherAiGroupCosts,
    // State
    loading,
    error,
    // Actions
    refresh: fetchData,
  };
}

// Helper functions
// F5 (02 work order): the wire contract value is `one_time` (underscore).
// The form option value, the cycleLabels key, and this normalizer all use
// `one_time` so the value round-trips verbatim through create/update/display
// without any hyphen↔underscore conversion that previously caused the backend
// to silently save a one-time subscription as monthly.
function normalizeCycle(cycle) {
  const cycles = {
    monthly: "monthly",
    yearly: "yearly",
    one_time: "one_time",
  };
  return cycles[cycle] || "monthly";
}

function getSubscriptionStatus(record) {
  if (!record.start_date) return "active";
  const start = new Date(record.start_date);
  const end = record.end_date ? new Date(record.end_date) : null;
  const now = new Date();

  if (end && end < now) return "expired";
  if (record.note?.toLowerCase().includes("取消")) return "cancelled";
  return "active";
}

function getPlanCycle(plan) {
  const label = plan.plan_label || "";
  if (label.includes("年付") || label.includes("yearly")) return "yearly";
  if (label.includes("月付") || label.includes("monthly")) return "monthly";
  return "monthly";
}

function formatQuota(quota, unit) {
  if (!quota && quota !== 0) return "—";
  const num = Number(quota);
  if (!Number.isFinite(num)) return "—";

  if (unit === "credits") {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
    return num.toString();
  }

  // For tokens
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toString();
}

function getSyncStatusLabel(status) {
  const labels = {
    synced: "已同步",
    success: "同步成功",
    not_configured: "未配置",
    auth_required: "等待授权",
    syncing: "同步中",
    failed: "同步失败",
    error: "同步错误",
    reauth_required: "需重新授权",
    unsupported: "不支持同步",
  };
  return labels[status] || status || "未配置";
}
