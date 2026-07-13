import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Activity, BarChart3, ListFilter } from "lucide-react";
import {
  getSpendRecords,
  getLocalSettings,
  setLocalSettings,
  createSpendRecord,
  updateSpendRecord,
  deleteSpendRecord,
} from "../lib/api";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import { computeRangeFromKey, getMonthComparisonRanges } from "../lib/date-range";
import { getBrowserTimeZone, getBrowserTimeZoneOffsetMinutes } from "../lib/timezone";
import { normalizeAccessToken } from "../lib/auth-token";
import { DASHBOARD_AGENTS } from "../lib/agent-adapters-dashboard";
import { RequestUsageLog } from "../ui/dashboard/components/RequestUsageLog.jsx";
import { ProviderUsageTable } from "../ui/dashboard/components/ProviderUsageTable.jsx";
import { ModelUsageTable } from "../ui/dashboard/components/ModelUsageTable.jsx";
import { UsageTrendChartCard } from "../ui/dashboard/components/UsageTrendChart.jsx";
import { UsageFilterBar } from "../ui/dashboard/components/UsageFilterBar.jsx";
import { UsageStatsPanel } from "../ui/dashboard/components/UsageStatsPanel.jsx";
import { TokenServiceList } from "../ui/dashboard/components/TokenServiceList.jsx";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import {
  normalizeVisibleProviderIds,
  reconcileVisibleUsageFilters,
  resolveEffectiveUsageSources,
} from "../lib/spend-provider-visibility.js";
import { withOtherAiCostSource } from "../lib/cost-sources.js";
import {
  UsageFiltersProvider,
  useUsageFilters,
  useUsageFilterActions,
} from "../hooks/use-usage-filters";
import { useUsageSummary } from "../hooks/use-usage-summary";
import { useUsageFilterOptions } from "../hooks/use-usage-filter-options";
import { useCostAccumulation } from "../hooks/use-cost-accumulation.js";
import { useProviderApiBalances } from "../hooks/use-provider-api-balances.js";
import { useTokenServicePlans } from "../hooks/use-token-service-plans.js";
import { CostAccumulation } from "../ui/dashboard/components/CostAccumulation.jsx";

// v2.0 IA refactor (work order 01): the old single SpendPage with a top-level
// "使用统计 / 成本累积" Tab UI is split into two route components.
//   - SpendUsagePage (/spend/usage): stats panel, summary cards, trend chart,
//     and the three usage detail tabs (requests / provider / model). The
//     independent "按来源拆分" table and its dead subscription-card code are
//     removed; Provider visibility filtering and the cost-summary API are
//     preserved.
//   - SpendCostPage (/spend/cost): CostAccumulation component (Token plans,
//     API billing accounts, subscription records). The 03 workorder will wire
//     the provider-balance backend into this surface.
// The top-level Tab UI is GONE — each route renders its own content.

const INTERVAL_MS = {
  "30s": 30000,
  "1m": 60000,
  "5m": 300000,
};

const SPEND_USAGE_TABS = [
  { id: "requests", labelKey: "spend.usage.tabs.requests", icon: ListFilter },
  { id: "provider", labelKey: "spend.usage.tabs.provider", icon: Activity },
  { id: "model", labelKey: "spend.usage.tabs.model", icon: BarChart3 },
];

const HEAVY_USAGE_PANELS_DEFER_MS = 150;
const REQUEST_LOG_IDLE_TIMEOUT_MS = 500;

function useDeferredHeavyUsagePanels(enabled) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || ready) return undefined;
    const timer = window.setTimeout(() => setReady(true), HEAVY_USAGE_PANELS_DEFER_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, ready]);

  return enabled && ready;
}

/** Defer request-log API until the browser is idle (or a short timeout). */
function useDeferredRequestLogFetch(enabled) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return undefined;
    }
    if (ready) return undefined;

    let cancelled = false;
    const enable = () => {
      if (!cancelled) setReady(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(enable, { timeout: REQUEST_LOG_IDLE_TIMEOUT_MS });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
      };
    }

    const timer = window.setTimeout(enable, REQUEST_LOG_IDLE_TIMEOUT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, ready]);

  return ready;
}

// ---------------------------------------------------------------------------
// /spend/usage — 使用统计
// ---------------------------------------------------------------------------

/**
 * UsageFiltersProvider wrapper so the usage hooks
 * (useUsageFilters / useUsageSummary / useUsageFilterOptions) can access the
 * filter context.
 */
export function SpendUsagePage(props) {
  return (
    <UsageFiltersProvider>
      <SpendUsagePageInner {...props} />
    </UsageFiltersProvider>
  );
}
function SpendUsagePageInner({
  baseUrl,
  auth,
  signedIn,
  sessionSoftExpired,
  publicMode = false,
  publicToken = null,
}) {
  const [financialState, setFinancialState] = useState({
    scopeKey: null,
    totals: null,
    lastUpdatedAt: null,
  });
  const financialRequestIdRef = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const initialIntervalLoaded = useRef(false);

  const { visibleOrdered } = useLimitsDisplayPrefs();
  // Ticket-07 Task 4: normalize visible provider IDs for API calls
  const visibleProviderIds = useMemo(
    () => normalizeVisibleProviderIds(visibleOrdered),
    [visibleOrdered],
  );
  const heavyUsagePanelsReady = useDeferredHeavyUsagePanels(visibleProviderIds.length > 0);

  // Ticket-02: filter state from UsageFiltersContext
  const { state: filterState, refreshRevision, requestRefresh } = useUsageFilters();
  const tokenServices = useTokenServicePlans(refreshRevision);
  const effectiveUsageSources = useMemo(
    () => resolveEffectiveUsageSources({
      sources: filterState.sources,
      agentIds: filterState.agentIds,
      visibleProviderIds,
    }),
    [filterState.sources, filterState.agentIds, visibleProviderIds],
  );
  const costSources = useMemo(
    () => {
      if (visibleProviderIds.length === 0) return withOtherAiCostSource([]);
      const hasExplicitProviderScope = (filterState.agentIds?.length || 0) > 0
        || (filterState.sources?.length || 0) > 0;
      return hasExplicitProviderScope
        ? effectiveUsageSources
        : withOtherAiCostSource(effectiveUsageSources);
    },
    [effectiveUsageSources, filterState.agentIds, filterState.sources, visibleProviderIds],
  );
  const {
    setRefreshInterval: dispatchRefreshInterval,
    setAgentIds: dispatchAgentIds,
    setSources: dispatchSources,
    setModels: dispatchModels,
  } = useUsageFilterActions();
  const [activeUsageTab, setActiveUsageTab] = useState("requests");
  const [requestLogForced, setRequestLogForced] = useState(false);
  const handleUsageTabChange = useCallback((tab) => {
    if (tab === "requests") setRequestLogForced(true);
    setActiveUsageTab(tab);
  }, []);
  const requestLogFetchReady = useDeferredRequestLogFetch(
    heavyUsagePanelsReady && activeUsageTab === "requests",
  ) || requestLogForced;
  const selectedUsageAgent = useMemo(() => {
    const selectedAgentId = filterState.agentIds?.length === 1 ? filterState.agentIds[0] : null;
    if (!selectedAgentId) return null;
    const agent = DASHBOARD_AGENTS.find((item) => item.id === selectedAgentId);
    if (!agent) return null;
    return {
      displayName: agent.displayName,
      queueSource: agent.queueSource,
    };
  }, [filterState.agentIds]);

  // Auth derivation (same pattern as DashboardPage)
  const authTokenAllowed = signedIn && !sessionSoftExpired;
  const effectiveAuthToken = authTokenAllowed ? auth : null;
  const accessToken = publicMode ? normalizeAccessToken(publicToken) : effectiveAuthToken;
  const cacheKey = publicMode ? null : auth?.userId || auth?.email || "default";
  const guestAllowed = signedIn && sessionSoftExpired && !publicMode;

  // Timezone context
  const timeZone = useMemo(() => getBrowserTimeZone() || "UTC", []);
  const tzOffsetMinutes = useMemo(() => getBrowserTimeZoneOffsetMinutes(), []);
  const financialScopeKey = useMemo(
    () => JSON.stringify([timeZone, tzOffsetMinutes, costSources]),
    [timeZone, tzOffsetMinutes, costSources],
  );
  const totals = financialState.scopeKey === financialScopeKey
    ? financialState.totals
    : null;
  const lastUpdatedAt = financialState.scopeKey === financialScopeKey
    ? financialState.lastUpdatedAt
    : null;

  // Compute from/to based on filter time range (Ticket-02 keys)
  const range = useMemo(() => {
    if (filterState.timeRange === "custom" && filterState.from && filterState.to) {
      return { from: filterState.from, to: filterState.to };
    }
    return computeRangeFromKey(filterState.timeRange, {
      timeZone,
      offsetMinutes: tzOffsetMinutes,
    });
  }, [filterState.timeRange, filterState.from, filterState.to, timeZone, tzOffsetMinutes]);

  const { from, to } = range;

  // Ticket-07 Task 4: reconcile filter selections when visibleProviderIds changes
  useEffect(() => {
    if (visibleProviderIds.length === 0) return;

    const currentFilters = {
      agentIds: filterState.agentIds,
      sources: filterState.sources,
      models: filterState.models,
    };
    const reconciled = reconcileVisibleUsageFilters(currentFilters, visibleProviderIds);

    // Only dispatch if filters actually changed (prevent effect self-loop)
    const agentIdsChanged = reconciled.agentIds !== null &&
      (currentFilters.agentIds === null || reconciled.agentIds.length !== currentFilters.agentIds.length);
    const sourcesChanged = reconciled.sources !== null &&
      (currentFilters.sources === null || reconciled.sources.length !== currentFilters.sources.length);
    const modelsChanged = reconciled.models === null && currentFilters.models !== null;

    if (agentIdsChanged) {
      dispatchAgentIds(reconciled.agentIds);
    }
    if (sourcesChanged) {
      dispatchSources(reconciled.sources);
    }
    if (modelsChanged) {
      dispatchModels(reconciled.models);
    }
  }, [visibleProviderIds, filterState.agentIds, filterState.sources, filterState.models]);

  // Ticket-02: usage summary + filter options
  const { summary, loading: summaryLoading, error: summaryError } = useUsageSummary({
    baseUrl,
    accessToken,
    guestAllowed,
    from,
    to,
    cacheKey,
    timeZone,
    tzOffsetMinutes,
    allowedSources: visibleProviderIds,
  });
  const { sources: sourceOptions, modelsBySource } = useUsageFilterOptions({
    baseUrl,
    accessToken,
    guestAllowed,
    cacheKey,
    timeZone,
    tzOffsetMinutes,
    allowedSources: visibleProviderIds,
  });

  // The financial cards use adjacent natural months in the browser timezone.
  // Agent/provider source filters still apply, while the Token trend's rolling
  // date range does not redefine a card explicitly labelled "本月".
  const fetchTotals = useCallback(async () => {
    const requestId = financialRequestIdRef.current + 1;
    financialRequestIdRef.current = requestId;

    if (costSources.length === 0) {
      setFinancialState({ scopeKey: financialScopeKey, totals: null, lastUpdatedAt: null });
      return;
    }

    const monthRanges = getMonthComparisonRanges({
      timeZone,
      offsetMinutes: tzOffsetMinutes,
    });
    const requestMonth = (monthRange) => getSpendRecords({
      from: monthRange.from,
      to: monthRange.to,
      timeZone,
      tzOffsetMinutes,
      sources: costSources,
    });

    const [currentResult, previousResult] = await Promise.allSettled([
      requestMonth(monthRanges.current),
      requestMonth(monthRanges.previous),
    ]);

    if (requestId !== financialRequestIdRef.current) return;

    if (currentResult.status === "fulfilled") {
      const currentTotals = currentResult.value?.totals || null;
      const previousTotals = previousResult.status === "fulfilled"
        ? previousResult.value?.totals
        : null;
      setFinancialState({
        scopeKey: financialScopeKey,
        totals: currentTotals ? {
          ...currentTotals,
          previous_combined_usd: previousTotals?.combined_usd ?? null,
          previous_combined_cny: previousTotals?.combined_cny ?? null,
        } : null,
        lastUpdatedAt: new Date(),
      });
    } else {
      // Totals are optional for the usage page; swallow the error so a
      // transient backend hiccup doesn't crash the stats panel below.
      console.error("[SpendUsagePage] Failed to load current-month totals:", currentResult.reason);
    }
    if (previousResult.status === "rejected") {
      console.error("[SpendUsagePage] Failed to load previous-month totals:", previousResult.reason);
    }
  }, [financialScopeKey, timeZone, tzOffsetMinutes, costSources]);

  useEffect(() => {
    fetchTotals();
  }, [fetchTotals]);

  // Ticket-02: load saved refresh interval from local settings on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getLocalSettings();
        if (cancelled) return;
        const savedInterval = String(settings?.dashboardRefresh?.interval || "1m").trim();
        dispatchRefreshInterval(savedInterval);
      } catch {
        // Use default 1m on failure.
      } finally {
        if (!cancelled) initialIntervalLoaded.current = true;
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticket-02: persist refresh interval to local settings when it changes (after initial load)
  useEffect(() => {
    if (!initialIntervalLoaded.current) return;
    setLocalSettings({
      dashboardRefresh: { interval: filterState.refreshInterval, updated_at: new Date().toISOString() },
    }).catch((err) => {
      console.error("[SpendUsagePage] Failed to save refresh interval:", err);
    });
  }, [filterState.refreshInterval]);

  // Ticket-05: refresh totals on revision change
  useEffect(() => {
    if (refreshRevision === 0) return;
    setIsRefreshing(true);
    fetchTotals().finally(() => setIsRefreshing(false));
  }, [refreshRevision, fetchTotals]);

  // Ticket-02: auto-refresh based on filterState.refreshInterval
  useEffect(() => {
    if (filterState.refreshInterval === "manual") return;
    const ms = INTERVAL_MS[filterState.refreshInterval];
    if (!ms) return;
    const timer = window.setInterval(requestRefresh, ms);
    return () => window.clearInterval(timer);
  }, [filterState.refreshInterval, requestRefresh]);

  const handleManualRefresh = async () => {
    requestRefresh();
  };

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                {copy("spend.usage.page.title")}
              </h1>
              <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("spend.usage.page.subtitle")}
              </p>
            </div>
          </div>

          {/* Ticket-02: Filter Bar */}
          <UsageFilterBar
            sourceOptions={sourceOptions}
            modelsBySource={modelsBySource}
            onManualRefresh={handleManualRefresh}
            isRefreshing={isRefreshing}
            lastUpdatedAt={lastUpdatedAt ? lastUpdatedAt.toISOString() : null}
            timeZone={timeZone}
            offsetMinutes={tzOffsetMinutes}
            visibleProviderIds={visibleProviderIds}
            className="mb-6"
          />

          {/* Ticket-07 Task 4: empty allowlist state */}
          {visibleProviderIds.length === 0 ? (
            <div className="mb-6 rounded-lg border border-oai-gray-200 p-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
              {copy("spend.visibility.empty")}
            </div>
          ) : (
            <>
              {/* Ticket-02: Stats Panel */}
              <UsageStatsPanel
                summary={summary}
                costSummary={totals}
                selectedAgent={selectedUsageAgent}
                loading={summaryLoading}
                error={summaryError}
              />

              {heavyUsagePanelsReady && (
                <>
                  {/* Usage Trend Chart */}
                  <div
                    data-testid="usage-chart-token-services-layout"
                    className="mb-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-stretch"
                  >
                    <UsageTrendChartCard
                      from={from}
                      to={to}
                      accessToken={accessToken}
                      baseUrl={baseUrl}
                      guestAllowed={guestAllowed}
                      cacheKey={cacheKey}
                      timeZone={timeZone}
                      tzOffsetMinutes={tzOffsetMinutes}
                      allowedSources={visibleProviderIds}
                      className="min-w-0"
                    />
                    <TokenServiceList
                      plans={tokenServices.plans}
                      loading={tokenServices.loading}
                      error={tokenServices.error}
                      className="min-w-0"
                    />
                  </div>

                  <UsageDetailTabs
                    activeTab={activeUsageTab}
                    onTabChange={handleUsageTabChange}
                    requestLogFetchReady={requestLogFetchReady}
                    from={from}
                    to={to}
                    timeZone={timeZone}
                    tzOffsetMinutes={tzOffsetMinutes}
                    visibleProviderIds={visibleProviderIds}
                    baseUrl={baseUrl}
                    accessToken={accessToken}
                    guestAllowed={guestAllowed}
                    cacheKey={cacheKey}
                  />
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /spend/cost — 成本累积
// ---------------------------------------------------------------------------

/**
 * Wrapped in UsageFiltersProvider so the cost-accumulation hook can read
 * refreshRevision and the time-range / source filters, keeping the two
 * sub-pages symmetric.
 */
export function SpendCostPage(props) {
  return (
    <UsageFiltersProvider>
      <SpendCostPageInner {...props} />
    </UsageFiltersProvider>
  );
}

function SpendCostPageInner({
  baseUrl,
  auth,
  signedIn,
  sessionSoftExpired,
  publicMode = false,
  publicToken = null,
}) {
  const { visibleOrdered } = useLimitsDisplayPrefs();
  const visibleProviderIds = useMemo(
    () => normalizeVisibleProviderIds(visibleOrdered),
    [visibleOrdered],
  );
  const costSources = useMemo(
    () => withOtherAiCostSource(visibleProviderIds),
    [visibleProviderIds],
  );

  const { state: filterState, refreshRevision, requestRefresh } = useUsageFilters();

  const authTokenAllowed = signedIn && !sessionSoftExpired;
  const effectiveAuthToken = authTokenAllowed ? auth : null;
  const accessToken = publicMode ? normalizeAccessToken(publicToken) : effectiveAuthToken;
  const cacheKey = publicMode ? null : auth?.userId || auth?.email || "default";
  const guestAllowed = signedIn && sessionSoftExpired && !publicMode;

  const timeZone = useMemo(() => getBrowserTimeZone() || "UTC", []);
  const tzOffsetMinutes = useMemo(() => getBrowserTimeZoneOffsetMinutes(), []);

  const range = useMemo(() => {
    if (filterState.timeRange === "custom" && filterState.from && filterState.to) {
      return { from: filterState.from, to: filterState.to };
    }
    return computeRangeFromKey(filterState.timeRange, {
      timeZone,
      offsetMinutes: tzOffsetMinutes,
    });
  }, [filterState.timeRange, filterState.from, filterState.to, timeZone, tzOffsetMinutes]);

  const { from, to } = range;

  // Ticket-03: Cost Accumulation hook (token plans, api billing, subscription
  // records, cost summary). Refreshes when refreshRevision changes.
  const costAccumulation = useCostAccumulation({
    from,
    to,
    timeZone,
    tzOffsetMinutes,
    refreshRevision,
    sources: costSources,
  });
  const {
    tokenPackages,
    apiBillingAccounts,
    subscriptionRecords,
    costSummary,
    loading: costLoading,
    error: costError,
    refresh: refreshCostAccumulation,
  } = costAccumulation;

  // 03-ia-api-balance: Provider API balances from 02 financial endpoints.
  // This hook ONLY reads financial results — it never touches API Keys.
  // It handles its own polling (>=60s), dedup, and unmount cleanup.
  const {
    balances: providerApiBalances,
    refreshing: providerApiRefreshing,
    refreshingIds: providerApiRefreshingIds,
    stale: providerApiStale,
    lastUpdatedAt: providerApiLastUpdatedAt,
    refreshAll: refreshAllProviderApis,
    refreshOne: refreshOneProviderApi,
  } = useProviderApiBalances();

  // 03 work order task 4: Subscription records CRUD state.
  // subscriptionFormState: null (closed) | "new" | existing record object.
  const [subscriptionFormState, setSubscriptionFormState] = useState(null);
  const [subscriptionFormSaving, setSubscriptionFormSaving] = useState(false);
  const [subscriptionFormError, setSubscriptionFormError] = useState(null);

  const handleAddSubscription = useCallback(() => {
    setSubscriptionFormError(null);
    setSubscriptionFormState("new");
  }, []);

  const handleEditSubscription = useCallback((record) => {
    setSubscriptionFormError(null);
    setSubscriptionFormState(record);
  }, []);

  const handleCancelSubscriptionForm = useCallback(() => {
    setSubscriptionFormState(null);
    setSubscriptionFormError(null);
    setSubscriptionFormSaving(false);
  }, []);

  // Save (create or update). After success, refresh cost summary + subscription
  // list (via requestRefresh which bumps refreshRevision → useCostAccumulation
  // refetches), then close the form.
  const handleSaveSubscription = useCallback(async (payload) => {
    setSubscriptionFormSaving(true);
    setSubscriptionFormError(null);
    try {
      const isEdit = Boolean(payload.id);
      const result = isEdit
        ? await updateSpendRecord(payload)
        : await createSpendRecord(payload);
      if (!result?.ok && result?.ok !== undefined) {
        setSubscriptionFormError(result?.error || copy("spend.cost.subscription.error_save"));
        setSubscriptionFormSaving(false);
        return;
      }
      setSubscriptionFormState(null);
      setSubscriptionFormSaving(false);
      // Refresh cost summary + subscription list (and timeseries).
      requestRefresh();
      refreshCostAccumulation?.();
    } catch (err) {
      setSubscriptionFormError(err?.message || copy("spend.cost.subscription.error_save"));
      setSubscriptionFormSaving(false);
    }
  }, [requestRefresh, refreshCostAccumulation]);

  const handleDeleteSubscription = useCallback(async (record) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("spend.cost.subscription.confirm_delete"))) return;
    try {
      const result = await deleteSpendRecord(record.id);
      if (!result?.ok && result?.ok !== undefined) {
        // Swallow — the list still refreshes below; transient error.
        console.error("[SpendCostPage] delete spend record failed:", result?.error);
      }
      // Refresh cost summary + subscription list.
      requestRefresh();
      refreshCostAccumulation?.();
    } catch (err) {
      console.error("[SpendCostPage] delete spend record threw:", err);
    }
  }, [requestRefresh, refreshCostAccumulation]);

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                {copy("spend.cost.page.title")}
              </h1>
              <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("spend.cost.page.subtitle")}
              </p>
            </div>
          </div>

          <CostAccumulation
            tokenPackages={tokenPackages}
            apiBillingAccounts={apiBillingAccounts}
            subscriptionRecords={subscriptionRecords}
            costSummary={costSummary}
            loading={costLoading}
            error={costError}
            providerApiBalances={providerApiBalances}
            providerApiRefreshing={providerApiRefreshing}
            providerApiRefreshingIds={providerApiRefreshingIds}
            providerApiStale={providerApiStale}
            providerApiLastUpdatedAt={providerApiLastUpdatedAt}
            onRefreshAllProviderApis={refreshAllProviderApis}
            onRefreshOneProviderApi={refreshOneProviderApi}
            subscriptionFormState={subscriptionFormState}
            subscriptionFormSaving={subscriptionFormSaving}
            subscriptionFormError={subscriptionFormError}
            onAddSubscription={handleAddSubscription}
            onEditSubscription={handleEditSubscription}
            onSaveSubscription={handleSaveSubscription}
            onDeleteSubscription={handleDeleteSubscription}
            onCancelSubscriptionForm={handleCancelSubscriptionForm}
          />
        </div>
      </main>
    </div>
  );
}

function UsageDetailTabs({
  activeTab,
  onTabChange,
  requestLogFetchReady = false,
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  visibleProviderIds,
  baseUrl,
  accessToken,
  guestAllowed,
  cacheKey,
}) {
  return (
    <section className="mb-6">
      <div className="inline-flex rounded-lg bg-oai-gray-50 p-1 dark:bg-oai-gray-900" role="tablist" aria-label={copy("spend.usage.title")}>
        {SPEND_USAGE_TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                selected
                  ? "bg-white text-oai-black shadow-sm dark:bg-oai-gray-800 dark:text-white"
                  : "text-oai-gray-500 hover:text-oai-gray-900 dark:text-oai-gray-400 dark:hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {copy(tab.labelKey)}
            </button>
          );
        })}
      </div>
      {activeTab === "requests" && (
        <div role="tabpanel">
          <RequestUsageLog
            from={from}
            to={to}
            timeZone={timeZone}
            tzOffsetMinutes={tzOffsetMinutes}
            visibleProviderIds={visibleProviderIds}
            baseUrl={baseUrl}
            accessToken={accessToken}
            guestAllowed={guestAllowed}
            cacheKey={cacheKey}
            fetchEnabled={requestLogFetchReady}
          />
        </div>
      )}
      {activeTab === "provider" && (
        <div role="tabpanel">
          <ProviderUsageTable
            from={from}
            to={to}
            timeZone={timeZone}
            tzOffsetMinutes={tzOffsetMinutes}
            baseUrl={baseUrl}
            accessToken={accessToken}
            guestAllowed={guestAllowed}
            cacheKey={cacheKey}
            visibleProviderIds={visibleProviderIds}
          />
        </div>
      )}
      {activeTab === "model" && (
        <div role="tabpanel">
          <ModelUsageTable
            from={from}
            to={to}
            timeZone={timeZone}
            tzOffsetMinutes={tzOffsetMinutes}
            baseUrl={baseUrl}
            accessToken={accessToken}
            guestAllowed={guestAllowed}
            cacheKey={cacheKey}
            visibleProviderIds={visibleProviderIds}
          />
        </div>
      )}
    </section>
  );
}
