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
import { computeRangeFromKey, getRangeForPeriod, formatDateUTC } from "../lib/date-range";
import { getBrowserTimeZone, getBrowserTimeZoneOffsetMinutes } from "../lib/timezone";
import { normalizeAccessToken } from "../lib/auth-token";
import { DASHBOARD_AGENTS } from "../lib/agent-adapters-dashboard";
import { RequestUsageLog } from "../ui/dashboard/components/RequestUsageLog.jsx";
import { ProviderUsageTable } from "../ui/dashboard/components/ProviderUsageTable.jsx";
import { ModelUsageTable } from "../ui/dashboard/components/ModelUsageTable.jsx";
import { UsageTrendChartCard } from "../ui/dashboard/components/UsageTrendChart.jsx";
import { UsageFilterBar } from "../ui/dashboard/components/UsageFilterBar.jsx";
import { UsageStatsPanel } from "../ui/dashboard/components/UsageStatsPanel.jsx";
import { TokenServiceListPanel } from "../ui/dashboard/components/TokenServiceListPanel.jsx";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import {
  normalizeVisibleProviderIds,
  reconcileVisibleUsageFilters,
  resolveEffectiveUsageSources,
} from "../lib/spend-provider-visibility.js";
import {
  UsageFiltersProvider,
  useUsageFilters,
  useUsageFilterActions,
} from "../hooks/use-usage-filters";
import { useUsageSummary } from "../hooks/use-usage-summary";
import { useUsageFilterOptions } from "../hooks/use-usage-filter-options";
import { useCostAccumulation } from "../hooks/use-cost-accumulation.js";
import { useProviderApiBalances } from "../hooks/use-provider-api-balances.js";
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

function useDeferredHeavyUsagePanels(enabled, immediate = false) {
  const [ready, setReady] = useState(immediate && enabled);

  useEffect(() => {
    if (immediate) {
      setReady(enabled);
      return undefined;
    }
    if (!enabled || ready) return undefined;
    const timer = window.setTimeout(() => setReady(true), HEAVY_USAGE_PANELS_DEFER_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, immediate, ready]);

  return enabled && (immediate || ready);
}

function useDeferredRequestLogFetch(enabled, immediate = false) {
  const [ready, setReady] = useState(immediate && enabled);

  useEffect(() => {
    if (immediate) {
      setReady(enabled);
      return undefined;
    }
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
  }, [enabled, immediate, ready]);

  return enabled && (immediate || ready);
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
  contestPreview = false,
}) {
  const [totals, setTotals] = useState(null);
  const [monthlyCombinedMom, setMonthlyCombinedMom] = useState({ pct: null, hasLast: false });
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const initialIntervalLoaded = useRef(false);

  const { visibleOrdered } = useLimitsDisplayPrefs();
  // Ticket-07 Task 4: normalize visible provider IDs for API calls
  const visibleProviderIds = useMemo(
    () => normalizeVisibleProviderIds(visibleOrdered),
    [visibleOrdered],
  );
  const heavyUsagePanelsReady = useDeferredHeavyUsagePanels(
    visibleProviderIds.length > 0,
    contestPreview,
  );

  // Ticket-02: filter state from UsageFiltersContext
  const { state: filterState, refreshRevision, requestRefresh } = useUsageFilters();
  const effectiveUsageSources = useMemo(
    () => resolveEffectiveUsageSources({
      sources: filterState.sources,
      agentIds: filterState.agentIds,
      visibleProviderIds,
    }),
    [filterState.sources, filterState.agentIds, visibleProviderIds],
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
    contestPreview,
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

  // v2.0 IA: the usage page still needs the cost-summary totals (for the
  // monthly API / subscription / combined / lifetime cards). We fetch
  // getSpendRecords for its totals only — the independent "按来源拆分"
  // table and by_source derived state are removed per the IA spec.
  const fetchTotals = useCallback(async ({ silent = false } = {}) => {
    if (visibleProviderIds.length === 0 || effectiveUsageSources.length === 0) {
      setTotals(null);
      return;
    }

    try {
      const recordsResult = await getSpendRecords({
        from,
        to,
        timeZone,
        tzOffsetMinutes,
        sources: effectiveUsageSources,
      });
      setTotals(recordsResult?.totals || null);
      setLastUpdatedAt(new Date());
    } catch (err) {
      // Totals are optional for the usage page; swallow the error so a
      // transient backend hiccup doesn't crash the stats panel below.
      console.error("[SpendUsagePage] Failed to load totals:", err);
    }
  }, [from, to, timeZone, tzOffsetMinutes, visibleProviderIds, effectiveUsageSources]);

  useEffect(() => {
    fetchTotals();
  }, [fetchTotals]);

  // #9 本月总成本「较上月 +/-X%」: compare this calendar month's combined cost
  // against the previous calendar month. Independent of the filter-bar range
  // (which drives the card values) so the MoM figure is always month-over-month
  // as the label implies. prev==0 → "上月无数据" (avoid divide-by-zero / bogus %).
  const fetchMonthlyMom = useCallback(async () => {
    if (effectiveUsageSources.length === 0) {
      setMonthlyCombinedMom({ pct: null, hasLast: false });
      return;
    }
    try {
      const current = getRangeForPeriod("month", { timeZone, offsetMinutes: tzOffsetMinutes });
      const [cy, cm] = current.from.split("-").map(Number); // cm is 1-based
      const prevFromDate = new Date(Date.UTC(cy, cm - 2, 1));
      const prevToDate = new Date(Date.UTC(cy, cm - 1, 0));
      const previous = { from: formatDateUTC(prevFromDate), to: formatDateUTC(prevToDate) };
      const [currentRes, previousRes] = await Promise.all([
        getSpendRecords({ from: current.from, to: current.to, timeZone, tzOffsetMinutes, sources: effectiveUsageSources }),
        getSpendRecords({ from: previous.from, to: previous.to, timeZone, tzOffsetMinutes, sources: effectiveUsageSources }),
      ]);
      const currentUsd = Number(currentRes?.totals?.combined_usd ?? currentRes?.totals?.combined_cost_usd ?? 0);
      const previousUsd = Number(previousRes?.totals?.combined_usd ?? previousRes?.totals?.combined_cost_usd ?? 0);
      if (!(previousUsd > 0)) {
        setMonthlyCombinedMom({ pct: null, hasLast: false });
        return;
      }
      setMonthlyCombinedMom({ pct: ((currentUsd - previousUsd) / previousUsd) * 100, hasLast: true });
    } catch (err) {
      console.error("[SpendUsagePage] Failed to load month-over-month cost:", err);
      setMonthlyCombinedMom({ pct: null, hasLast: false });
    }
  }, [effectiveUsageSources, timeZone, tzOffsetMinutes]);

  useEffect(() => {
    fetchMonthlyMom();
  }, [fetchMonthlyMom]);

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
    fetchTotals({ silent: true }).finally(() => setIsRefreshing(false));
    fetchMonthlyMom();
  }, [refreshRevision, fetchTotals, fetchMonthlyMom]);

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
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
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
                combinedMomPct={monthlyCombinedMom.pct}
                combinedMomHasLast={monthlyCombinedMom.hasLast}
                selectedAgent={selectedUsageAgent}
                loading={summaryLoading}
                error={summaryError}
              />

              {heavyUsagePanelsReady && (
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                  {/* Left column: trend chart + usage detail tables */}
                  <div className="min-w-0">
                    <div className="mb-6">
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
                  </div>

                  {/* Right column: 在用 Token 套餐额度用量 */}
                  <aside className="lg:sticky lg:top-6">
                    <TokenServiceListPanel refreshRevision={refreshRevision} />
                  </aside>
                </div>
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
    sources: visibleProviderIds,
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

          {visibleProviderIds.length === 0 ? (
            <div className="mb-6 rounded-lg border border-oai-gray-200 p-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
              {copy("spend.visibility.empty")}
            </div>
          ) : (
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
          )}
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
