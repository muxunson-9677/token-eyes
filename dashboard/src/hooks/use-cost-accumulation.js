import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTokenPlans, getSpendRecords, getSpendTimeseries, getApiBillingAccounts } from "../lib/api";
import { OTHER_AI_SPEND_SOURCE } from "../lib/cost-sources.js";
import { getCostMonthRanges } from "../lib/date-range";

function getUtcMonthPeriod(monthKey) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(monthKey || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    monthKey: match[0],
    billingPeriodStart: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    billingPeriodEnd: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
  };
}

/**
 * Cost Accumulation data hook (03-cost-billing).
 *
 * Fetches and manages cost accumulation data including:
 * - Token packages (from token plans)
 * - API billing accounts (derived from spend records)
 * - Subscription records (from spend records)
 * - Cost summary (computed from spend timeseries)
 */

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
  const [financialTimeseries, setFinancialTimeseries] = useState(null);
  const [previousMonthTimeseries, setPreviousMonthTimeseries] = useState(null);
  const [apiBillingAccounts, setApiBillingAccounts] = useState([]);
  const [otherAiGroupCosts, setOtherAiGroupCosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [costSummaryStale, setCostSummaryStale] = useState(false);
  const [costLastSuccessfulAt, setCostLastSuccessfulAt] = useState(null);
  const [billingStale, setBillingStale] = useState(false);
  const [billingError, setBillingError] = useState(null);
  const requestIdRef = useRef(0);
  const dataScopeKeyRef = useRef(null);
  const recordsScopeKeyRef = useRef(null);
  const spendTimeseriesScopeKeyRef = useRef(null);
  const financialTimeseriesScopeKeyRef = useRef(null);
  const previousTimeseriesScopeKeyRef = useRef(null);
  const lastSuccessfulScopeKeyRef = useRef(null);
  const currentDataScopeKey = JSON.stringify({
    selectedMonth,
    timeZone,
    tzOffsetMinutes,
    sources: Array.isArray(sources) ? [...new Set(sources.map(String))].sort() : null,
  });
  const scopedSpendRecords = recordsScopeKeyRef.current === currentDataScopeKey ? spendRecords : [];
  const scopedOtherAiGroupCosts = recordsScopeKeyRef.current === currentDataScopeKey ? otherAiGroupCosts : [];
  const scopedSpendTimeseries = spendTimeseriesScopeKeyRef.current === currentDataScopeKey
    ? spendTimeseries
    : null;
  const scopedFinancialTimeseries = financialTimeseriesScopeKeyRef.current === currentDataScopeKey
    ? financialTimeseries
    : null;
  const scopedPreviousMonthTimeseries = previousTimeseriesScopeKeyRef.current === currentDataScopeKey
    ? previousMonthTimeseries
    : null;
  const scopedLastSuccessfulAt = lastSuccessfulScopeKeyRef.current === currentDataScopeKey
    ? costLastSuccessfulAt
    : null;

  // Fetch all data
  const fetchData = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestScopeKey = currentDataScopeKey;
    if (dataScopeKeyRef.current !== requestScopeKey) {
      dataScopeKeyRef.current = requestScopeKey;
      setSpendTimeseries(null);
      setPreviousMonthTimeseries(null);
    }
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

      const settle = (promise, label) => Promise.resolve(promise).then(
        (value) => ({ value, error: null, label }),
        (fetchError) => ({ value: null, error: fetchError, label }),
      );

      // Fetch token plans and API billing always. Each request is settled
      // independently so one unavailable source cannot erase still-valid data.
      const plansPromise = settle(getTokenPlans(), "token plans");
      const billingPromise = settle(getApiBillingAccounts({
        month: monthRanges.selectedMonth,
        timeZone: "UTC",
      }), "API billing accounts");

      // Fetch spend records and timeseries only when there are visible sources
      const recordsPromise = hasSources
        ? settle(getSpendRecords({
            ...monthRanges.selected,
            ...rangeParams,
            sources,
            summary_month: monthRanges.selectedMonth,
          }), "spend records")
        : Promise.resolve({ value: { records: [] }, error: null, label: "spend records" });
      const timeseriesPromise = hasSources
        ? settle(
            getSpendTimeseries({ ...monthRanges.selected, ...rangeParams, sources }),
            "selected-month cost totals",
          )
        : Promise.resolve({ value: null, error: null, label: "selected-month cost totals" });
      const previousTimeseriesPromise = hasSources
        ? settle(
            getSpendTimeseries({ ...monthRanges.comparison, ...rangeParams, sources }),
            "comparison-month cost totals",
          )
        : Promise.resolve({ value: null, error: null, label: "comparison-month cost totals" });
      const financialTimeseriesPromise = settle(
        getSpendTimeseries({ ...monthRanges.selected, timeZone: "UTC", tzOffsetMinutes: 0 }),
        "global financial totals",
      );

      const [plansResult, recordsResult, timeseriesResult, previousTimeseriesResult, financialTimeseriesResult, billingResult] = await Promise.all([
        plansPromise,
        recordsPromise,
        timeseriesPromise,
        previousTimeseriesPromise,
        financialTimeseriesPromise,
        billingPromise,
      ]);

      if (requestId !== requestIdRef.current) return;

      if (!plansResult.error) {
        setTokenPlans(Array.isArray(plansResult.value?.records) ? plansResult.value.records : []);
      }
      if (!recordsResult.error) {
        recordsScopeKeyRef.current = requestScopeKey;
        setSpendRecords(Array.isArray(recordsResult.value?.records) ? recordsResult.value.records : []);
        setOtherAiGroupCosts(Array.isArray(recordsResult.value?.other_ai_group_totals)
          ? recordsResult.value.other_ai_group_totals.filter((group) => Number(group?.record_count || 0) > 0)
          : []);
      }
      if (!timeseriesResult.error) {
        spendTimeseriesScopeKeyRef.current = requestScopeKey;
        setSpendTimeseries(timeseriesResult.value || null);
        setCostSummaryStale(false);
        if (hasSources) {
          lastSuccessfulScopeKeyRef.current = requestScopeKey;
          setCostLastSuccessfulAt(new Date().toISOString());
        }
      } else {
        setCostSummaryStale(true);
      }
      if (!previousTimeseriesResult.error) {
        previousTimeseriesScopeKeyRef.current = requestScopeKey;
        setPreviousMonthTimeseries(previousTimeseriesResult.value || null);
      }
      if (!financialTimeseriesResult.error) {
        financialTimeseriesScopeKeyRef.current = requestScopeKey;
        setFinancialTimeseries(financialTimeseriesResult.value || null);
      } else {
        setCostSummaryStale(true);
      }
      if (!billingResult.error) {
        setApiBillingAccounts(Array.isArray(billingResult.value?.accounts) ? billingResult.value.accounts : []);
        setBillingStale(false);
        setBillingError(null);
      } else {
        setBillingStale(true);
        setBillingError(billingResult.error?.message || String(billingResult.error));
      }

      const failures = [
        plansResult,
        recordsResult,
        timeseriesResult,
        previousTimeseriesResult,
        financialTimeseriesResult,
        billingResult,
      ].filter((result) => result.error);
      setError(failures.length > 0
        ? failures.map((result) => `${result.label}: ${result.error?.message || String(result.error)}`).join("; ")
        : null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err?.message || "Failed to load cost accumulation data");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [currentDataScopeKey, selectedMonth, timeZone, tzOffsetMinutes, sources]);

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
    const selectedPeriod = getUtcMonthPeriod(selectedMonth);
    return apiBillingAccounts.map((account, index) => {
      const hasLegacyBillingSource = account.billingSource === "official_api";
      const declaredAuthority = ["official_invoice", "local_list_price_estimate", "unavailable"]
        .includes(account.spendAuthority)
        ? account.spendAuthority
        : "unavailable";
      const hasExactOfficialPeriod = declaredAuthority !== "official_invoice" || Boolean(
        selectedPeriod
        && account.monthKey === selectedPeriod.monthKey
        && account.billingPeriodStart === selectedPeriod.billingPeriodStart
        && account.billingPeriodEnd === selectedPeriod.billingPeriodEnd
      );
      const spendAuthority = hasExactOfficialPeriod ? declaredAuthority : "unavailable";
      return {
        id: account.id || `${account.provider}-${index}`,
        provider: account.provider,
        accountName: account.accountName,
        billingSource: hasLegacyBillingSource ? "api" : account.billingSource,
        spendAuthority,
        monthCostUsd: account.monthCostUsd ?? null,
        lifetimeCostUsd: account.lifetimeCostUsd ?? null,
        status: account.status || "not-connected",
        lastSyncedAt: account.lastSyncedAt || null,
        monthKey: account.monthKey || null,
        billingPeriodStart: account.billingPeriodStart || null,
        billingPeriodEnd: account.billingPeriodEnd || null,
        errorCode: account.errorCode || null,
        candidateCount: Number.isInteger(account.candidateCount) ? account.candidateCount : null,
        stale: billingStale && spendAuthority === "official_invoice",
      };
    });
  }, [apiBillingAccounts, billingStale, selectedMonth]);

  // Filter spend records by sources
  const filteredSpendRecords = useMemo(() => {
    if (!sources || sources.length === 0) return [];
    return scopedSpendRecords.filter((record) => sources.includes(record.source));
  }, [scopedSpendRecords, sources]);

  // Compute cost summary from spend timeseries or spend records
  const costSummary = useMemo(() => {
    // If we have timeseries data, use it
    if (scopedSpendTimeseries) {
      const totals = scopedSpendTimeseries?.totals;
      if (totals) {
        const previousTotals = scopedPreviousMonthTimeseries?.totals || null;
        const cashTimeseries = scopedFinancialTimeseries;
        const cashTotals = cashTimeseries?.totals || null;
        const apiAccounts = apiBillingAccountsNormalized
          .filter((account) => account.billingSource === "api");
        const sourceRows = Array.isArray(cashTimeseries?.by_source) ? cashTimeseries.by_source : [];
        const scopedOfficialAccounts = cashTotals
          ? apiAccounts.filter((account) => account.spendAuthority === "official_invoice")
          : [];
        const officialApiValues = scopedOfficialAccounts
          .map((account) => account.monthCostUsd)
          .filter((value) => value !== null && value !== undefined
            && Number.isFinite(Number(value)) && Number(value) >= 0)
          .map(Number);
        const monthOfficialApiSpendUsd = officialApiValues.length > 0
          ? officialApiValues.reduce((sum, value) => sum + value, 0)
          : null;
        const officialProviders = new Set(scopedOfficialAccounts
          .filter((account) => (
            account.monthCostUsd !== null
            && account.monthCostUsd !== undefined
            && Number.isFinite(Number(account.monthCostUsd))
            && Number(account.monthCostUsd) >= 0
          ))
          .map((account) => normalizeInvoiceProvider(account.provider)));
        const hasAmbiguousInvoice = apiAccounts.some((account) => account.errorCode === "official_invoice_ambiguous");
        const sourceRequirements = sourceRows.map((sourceRow) => {
          const modes = sourceRow?.billing_mode_token_totals;
          const hasModeTotals = modes && typeof modes === "object";
          const providerTotals = Array.isArray(sourceRow?.billing_provider_token_totals)
            ? sourceRow.billing_provider_token_totals
            : [];
          const providerApiKeyTokens = providerTotals
            .reduce((sum, provider) => sum + Math.max(0, Number(provider?.api_key || 0)), 0);
          const apiKeyTokens = hasModeTotals
            ? Math.max(0, Number(modes.api_key || 0))
            : providerApiKeyTokens;
          const hasUnknownUsage = hasModeTotals && Number(modes.unknown || 0) > 0;
          const requiresInvoice = hasModeTotals
            ? apiKeyTokens > 0 || hasUnknownUsage
            : providerApiKeyTokens > 0 || Number(sourceRow?.api_cost_usd ?? sourceRow?.api_usd ?? 0) > 0;
          const hasUnmatchedProvider = providerTotals.some((provider) => (
            Number(provider?.api_key || 0) > 0
            && (
              normalizeInvoiceProvider(provider?.provider_id) === "unknown"
              || !officialProviders.has(normalizeInvoiceProvider(provider?.provider_id))
            )
          ));
          return {
            requiresInvoice,
            uncovered: hasUnknownUsage
              || hasUnmatchedProvider
              || (apiKeyTokens > providerApiKeyTokens),
          };
        });
        const requiresOfficialInvoice = sourceRows.length > 0
          ? sourceRequirements.some((requirement) => requirement.requiresInvoice)
          : Number(totals.api_usd || 0) > 0;
        const hasUnmatchedRequiredSource = sourceRows.length > 0
          ? sourceRequirements.some((requirement) => requirement.requiresInvoice && requirement.uncovered)
          : requiresOfficialInvoice && (
              officialProviders.size === 0
              || apiAccounts.some((account) => account.spendAuthority === "unavailable")
            );
        const hasUncoveredApiSpend = (
          requiresOfficialInvoice && (hasAmbiguousInvoice || hasUnmatchedRequiredSource)
        ) || (billingStale && monthOfficialApiSpendUsd !== null);
        const subscriptionUsd = cashTotals?.subscription_usd ?? null;
        const otherAiUsd = cashTotals?.other_ai_usd ?? null;
        const recordedCashBase = [subscriptionUsd, otherAiUsd]
          .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
          .reduce((sum, value) => sum + Number(value), 0);
        const hasRecordedCashBase = [subscriptionUsd, otherAiUsd]
          .some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
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
          monthApiEquivalentUsd: totals.api_usd ?? null,
          monthTokenPlanEquivalentUsd: cashTotals?.billing_mode_cost_totals?.token_plan ?? null,
          monthOfficialApiSpendUsd,
          monthActualCashSpendUsd: hasRecordedCashBase
            ? recordedCashBase + (monthOfficialApiSpendUsd ?? 0)
            : monthOfficialApiSpendUsd,
          actualCashCoverage: cashTotals ? (hasUncoveredApiSpend ? "partial" : "exact") : "unknown",
          monthSubscriptionCostUsd: cashTotals?.subscription_usd ?? null,
          monthOtherAiCostUsd: cashTotals?.other_ai_usd ?? null,
          monthTotalCostUsd: totals.combined_usd ?? null,
          previousMonthApiCostUsd: previousTotals?.api_usd ?? null,
          previousMonthSubscriptionCostUsd: previousTotals?.subscription_usd ?? null,
          previousMonthOtherAiCostUsd: previousTotals?.other_ai_usd ?? null,
          previousMonthTotalCostUsd: previousTotals?.combined_usd ?? null,
          lifetimeTotalCostUsd: totals.lifetime_combined_usd ?? null,
          usdToCny: Number(totals.usd_to_cny) > 0 ? Number(totals.usd_to_cny) : 7.2,
        };
      }
    }

    // Fallback: compute from filtered spend records. These are arithmetic
    // sums over real records, so 0 means "no records" — a real zero, not a
    // missing field. Keep them as numbers so they render "0.00".
    return {
      monthApiCostUsd: null,
      monthApiEquivalentUsd: null,
      monthTokenPlanEquivalentUsd: null,
      monthOfficialApiSpendUsd: null,
      monthActualCashSpendUsd: null,
      actualCashCoverage: "unknown",
      monthSubscriptionCostUsd: null,
      monthOtherAiCostUsd: null,
      monthTotalCostUsd: null,
      previousMonthApiCostUsd: null,
      previousMonthSubscriptionCostUsd: null,
      previousMonthOtherAiCostUsd: null,
      previousMonthTotalCostUsd: null,
      lifetimeTotalCostUsd: null,
      usdToCny: 7.2,
    };
  }, [apiBillingAccountsNormalized, billingStale, scopedFinancialTimeseries, scopedSpendTimeseries, scopedPreviousMonthTimeseries]);

  // Transform spend records into subscription records format
  const subscriptionRecords = useMemo(() => {
    const savedRecords = filteredSpendRecords
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
        lifetimeAmount: record.lifetime_amount ?? record.amount ?? 0,
      }));

    const mirroredPlanRecords = tokenPlans
      .filter((plan) => Number(plan.subscription_amount) > 0)
      .filter((plan) => !savedRecords.some((record) => (
        record.id === `token-plan-cost:${plan.id}`
        || record.tokenPlanId === plan.id
      )))
      .map((plan) => {
        const endDate = plan.subscription_end_date || plan.expires_at || null;
        return {
          id: `token-plan-cost:${plan.id}`,
          tokenPlanId: plan.id,
          name: plan.plan_label || plan.source || "未知",
          provider: plan.provider_id || plan.source || "未知",
          cycle: normalizeCycle(plan.subscription_cycle),
          amount: Number(plan.subscription_amount) || 0,
          currency: plan.subscription_currency || "USD",
          startedAt: plan.subscription_start_date || null,
          renewsAt: endDate,
          status: getSubscriptionStatus({
            start_date: plan.subscription_start_date,
            end_date: endDate,
          }),
          lifetimeAmount: Number(plan.subscription_amount) || 0,
          origin: "token_plan",
          readOnly: true,
        };
      });

    return [...savedRecords, ...mirroredPlanRecords];
  }, [filteredSpendRecords, tokenPlans]);

  // Transform token plans for display
  const tokenPackages = useMemo(() => {
    return tokenPlans
      .filter((plan) => !isExpiredTokenPlan(plan))
      .map((plan) => ({
      ...plan,
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
      monthCostUsd: plan.month_cost_usd ?? 0,
      availableQuotaDisplay: plan.available_quota_display || null,
      }));
  }, [tokenPlans]);

  return {
    // Data
    tokenPackages,
    apiBillingAccounts: apiBillingAccountsNormalized,
    subscriptionRecords,
    costSummary,
    otherAiGroupCosts: scopedOtherAiGroupCosts,
    // State
    loading,
    error,
    costSummaryStale,
    costLastSuccessfulAt: scopedLastSuccessfulAt,
    billingStale,
    billingError,
    // Actions
    refresh: fetchData,
  };
}

function normalizeInvoiceProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "codex" || provider === "openai") return "openai";
  return provider || "unknown";
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

function isExpiredTokenPlan(plan, now = new Date()) {
  const value = plan.subscription_end_date || plan.expires_at;
  if (!value) return false;
  const raw = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const timestamp = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999).getTime()
    : Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
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
