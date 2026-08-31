import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { getLocalDayKey, getTimeZoneCacheKey } from "../lib/timezone";
import { getProviderStats, getRecentApiProviderStats } from "../lib/api";
import type { ProviderStatsResponse } from "../lib/types/usage";
import { useUsageFilterParams, useUsageFilterCacheKey, useUsageFilters } from "./use-usage-filters";
import { resolveEffectiveUsageSources } from "../lib/spend-provider-visibility.js";

interface UseProviderStatsParams {
  baseUrl?: string;
  accessToken?: string | null;
  guestAllowed?: boolean;
  from?: string;
  to?: string;
  cacheKey?: string;
  timeZone?: string;
  tzOffsetMinutes?: number;
  allowedSources?: string[];
}

type ProviderStatsView = "range" | "recent_api_7d";

export function resolveProviderStatsDayKey({
  view,
  timeZone,
  offsetMinutes,
  date = new Date(),
}: {
  view: ProviderStatsView;
  timeZone?: string;
  offsetMinutes?: number;
  date?: Date;
}): string {
  return getLocalDayKey({ timeZone, offsetMinutes, date });
}

interface ProviderStatsCacheEntry {
  providers: ProviderStatsResponse;
  fetchedAt: string;
}

interface UseProviderStatsReturn {
  providers: ProviderStatsResponse | null;
  source: "edge" | "cache" | "mock";
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchedAt: string | null;
}

function safeHost(baseUrl: unknown): string | null {
  try {
    const url = new URL(baseUrl as string);
    return url.host;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isProviderStatsCachePayload(
  value: unknown,
  expectedView: ProviderStatsView,
): value is ProviderStatsResponse {
  if (!isRecord(value) || value.ok !== true || value.view !== expectedView) return false;
  const expectedScope = expectedView === "recent_api_7d"
    ? "api_key_attributed_activity_with_official_cost_when_available"
    : "all_provider_attributed";
  if (value.totals_scope !== expectedScope || !isRecord(value.period)) return false;
  if (
    typeof value.period.from !== "string"
    || typeof value.period.to !== "string"
    || typeof value.period.time_zone !== "string"
    || !Number.isFinite(Number(value.period.days))
    || !Array.isArray(value.providers)
  ) return false;
  return value.providers.every((provider) => {
    if (!isRecord(provider)) return false;
    if (typeof provider.provider_id !== "string" || !provider.provider_id) return false;
    if (typeof provider.display_name !== "string" || !provider.display_name) return false;
    if (Object.hasOwn(provider, "source") || Object.hasOwn(provider, "source_display_name")) return false;
    const costUnavailable = expectedView === "recent_api_7d" && provider.cost_basis == null;
    if (!costUnavailable) {
      if (!isRecord(provider.cost_basis)) return false;
      const expectedCostAuthority = expectedView === "recent_api_7d"
        ? "official_invoice"
        : "local_list_price_estimate";
      const expectedCostAccuracy = expectedView === "recent_api_7d" ? "exact" : "estimated";
      if (
        provider.cost_basis.authority !== expectedCostAuthority
        || provider.cost_basis.accuracy !== expectedCostAccuracy
      ) return false;
    }
    if (
      !Array.isArray(provider.daily)
      || !["request_event", "unavailable"].includes(String(provider.request_count_basis))
      || !Number.isFinite(Number(provider.success_rate_sample_count))
    ) return false;
    return true;
  });
}

export function createProviderStatsCacheEntry(
  payload: ProviderStatsResponse,
  view: ProviderStatsView,
  fetchedAt = new Date().toISOString(),
): ProviderStatsCacheEntry {
  if (!isProviderStatsCachePayload(payload, view) || !Number.isFinite(Date.parse(fetchedAt))) {
    throw new Error("Invalid Provider stats cache entry");
  }
  return {
    providers: {
      ...payload,
      providers: payload.providers.map((provider) => ({
        ...provider,
        account_label: null,
        account_ref: null,
        balance: null,
      })),
    },
    fetchedAt,
  };
}

export function parseProviderStatsCacheEntry(
  raw: string,
  view: ProviderStatsView,
  currentDayKey: string,
  expectedFrom?: string,
  expectedTo?: string,
): ProviderStatsCacheEntry | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || !Number.isFinite(Date.parse(String(parsed.fetchedAt || "")))
      || !isProviderStatsCachePayload(parsed.providers, view)
    ) return null;
    if (view === "recent_api_7d") {
      if (expectedFrom && expectedTo) {
        if (parsed.providers.period.from !== expectedFrom || parsed.providers.period.to !== expectedTo) return null;
      } else if (parsed.providers.period.to !== currentDayKey) return null;
    }
    return parsed as unknown as ProviderStatsCacheEntry;
  } catch {
    return null;
  }
}

export function buildProviderStatsStorageKey({
  view,
  cacheKey,
  baseUrl,
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  currentDayKey,
  filterCacheKey,
  sources,
}: {
  view: ProviderStatsView;
  cacheKey: string;
  baseUrl?: string;
  from?: string;
  to?: string;
  timeZone?: string;
  tzOffsetMinutes?: number;
  currentDayKey?: string;
  filterCacheKey: string;
  sources: string[];
}): string {
  const host = safeHost(baseUrl) || "default";
  const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
  const selectedRange = typeof from === "string" && from && typeof to === "string" && to;
  const rangeKey = view === "range" || selectedRange
    ? `${from || ""}.${to || ""}`
    : `current-7d.${currentDayKey || getLocalDayKey({ timeZone, offsetMinutes: tzOffsetMinutes })}`;
  return `tokentracker.providerStats.v2.${view}.${cacheKey}.${host}.${rangeKey}.${tzKey}.${filterCacheKey}.${sources.join(",")}`;
}

function useProviderStatsView({
  baseUrl,
  accessToken,
  guestAllowed = false,
  from,
  to,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  allowedSources,
}: UseProviderStatsParams = {}, view: ProviderStatsView): UseProviderStatsReturn {
  const mockEnabled = isMockEnabled();
  const tokenReady = isAccessTokenReady(accessToken);
  const isLocalMode = isLocalDashboardRuntime();
  const cacheAllowed = !guestAllowed && !mockEnabled;
  const filterParams = useUsageFilterParams();
  const filterCacheKey = useUsageFilterCacheKey();
  const { refreshRevision } = useUsageFilters();
  const handledRefreshRevision = useRef(refreshRevision);
  const requestSequenceRef = useRef(0);
  const [currentLocalDayKey, setCurrentLocalDayKey] = useState(() => (
    resolveProviderStatsDayKey({ view, timeZone, offsetMinutes: tzOffsetMinutes })
  ));

  useEffect(() => {
    const updateLocalDay = () => {
      const next = resolveProviderStatsDayKey({ view, timeZone, offsetMinutes: tzOffsetMinutes });
      setCurrentLocalDayKey((previous) => previous === next ? previous : next);
    };
    updateLocalDay();
    const intervalId = window.setInterval(updateLocalDay, 30_000);
    return () => window.clearInterval(intervalId);
  }, [view, timeZone, tzOffsetMinutes]);

  // Use serialized keys for deps so the memo keeps a stable reference when
  // the caller passes a new array literal with the same contents each render.
  // Without this, effectiveSources gets a new reference every render, which
  // cascades through refresh -> useEffect and triggers an infinite fetch loop.
  const effectiveSources = useMemo(
    () => resolveEffectiveUsageSources({
      sources: filterParams.sources,
      agentIds: filterParams.agentIds,
      visibleProviderIds: allowedSources,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      Array.isArray(filterParams.sources) ? filterParams.sources.join(",") : filterParams.sources,
      Array.isArray(filterParams.agentIds) ? filterParams.agentIds.join(",") : filterParams.agentIds,
      Array.isArray(allowedSources) ? allowedSources.join(",") : allowedSources,
    ],
  );
  const disabledByVisibility = Array.isArray(allowedSources) && effectiveSources.length === 0;

  const [providers, setProviders] = useState<ProviderStatsResponse | null>(null);
  const [source, setSource] = useState<"edge" | "cache" | "mock">("edge");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const lastScopeRef = useRef<string>("init");

  const storageKey = useMemo(() => {
    if (!cacheKey) return null;
    return buildProviderStatsStorageKey({
      view,
      cacheKey,
      baseUrl,
      from,
      to,
      timeZone,
      tzOffsetMinutes,
      currentDayKey: currentLocalDayKey,
      filterCacheKey,
      sources: effectiveSources,
    });
  }, [baseUrl, cacheKey, from, to, timeZone, tzOffsetMinutes, currentLocalDayKey, filterCacheKey, effectiveSources, view]);

  const readCache = useCallback((): ProviderStatsCacheEntry | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = parseProviderStatsCacheEntry(
        raw,
        view,
        currentLocalDayKey,
        from,
        to,
      );
      if (!parsed) {
        window.localStorage.removeItem(storageKey);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, [storageKey, view, currentLocalDayKey, from, to]);

  const writeCache = useCallback(
    (payload: ProviderStatsResponse) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(createProviderStatsCacheEntry(payload, view)),
        );
      } catch {
        // non-fatal
      }
    },
    [storageKey, view],
  );

  const clearCache = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // non-fatal
    }
  }, [storageKey]);

  const scopeKey = [
    view,
    cacheKey || "",
    baseUrl || "",
    from && to ? `${from}.${to}` : view === "range" ? "." : "current-7d",
    currentLocalDayKey,
    getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes }),
    filterCacheKey,
    effectiveSources.join(","),
  ].join("|");
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    requestSequenceRef.current += 1;
    setProviders(null);
    setSource("edge");
    setError(null);
    setFetchedAt(null);
    setLoading(true);
  }, [scopeKey]);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequenceRef.current;
    const token = await resolveAuthAccessToken(accessToken);
    if (requestId !== requestSequenceRef.current) return;
    if (!token && !mockEnabled && !guestAllowed && !isLocalMode) {
      setLoading(false);
      return;
    }

    // Disabled by visibility: clear state and return empty without fetching
    if (disabledByVisibility) {
      setProviders(null);
      setSource("edge");
      setError(null);
      setFetchedAt(null);
      setLoading(false);
      clearCache();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fetchProviderStats = view === "recent_api_7d"
        ? getRecentApiProviderStats
        : getProviderStats;
      const res = await fetchProviderStats({
        baseUrl,
        accessToken: token,
        ...(from && to ? { from, to } : {}),
        timeZone,
        tzOffsetMinutes,
        sources: effectiveSources,
        models: filterParams.models,
        agentIds: filterParams.agentIds,
      });
      if (view === "recent_api_7d" && from && to
        && (res?.period?.from !== from || res?.period?.to !== to)) {
        throw new Error("API Provider stats do not match the selected range");
      }
      if (requestId !== requestSequenceRef.current) return;
      setProviders(res as ProviderStatsResponse);
      setSource(mockEnabled ? "mock" : "edge");
      setFetchedAt(new Date().toISOString());
      if (cacheAllowed && isProviderStatsCachePayload(res, view)) writeCache(res);
      else clearCache();
    } catch (err) {
      if (requestId !== requestSequenceRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached) {
          setProviders(cached.providers);
          setSource("cache");
          setFetchedAt(cached.fetchedAt);
          setError(message);
        } else {
          setProviders(null);
          setError(message);
        }
      } else {
        setError(message);
      }
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }, [
    accessToken,
    baseUrl,
    from,
    mockEnabled,
    guestAllowed,
    isLocalMode,
    cacheAllowed,
    readCache,
    timeZone,
    to,
    tokenReady,
    tzOffsetMinutes,
    clearCache,
    writeCache,
    effectiveSources,
    filterParams.models,
    filterParams.agentIds,
    disabledByVisibility,
    view,
    currentLocalDayKey,
  ]);

  useEffect(() => {
    if (!tokenReady && !guestAllowed && !mockEnabled && !isLocalMode) {
      setProviders(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!cacheAllowed) {
      clearCache();
    } else {
      const cached = readCache();
      if (cached) {
        setProviders(cached.providers);
        setSource("cache");
        setFetchedAt(cached.fetchedAt);
      }
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, cacheAllowed, tokenReady, mockEnabled, guestAllowed]);

  useEffect(() => {
    if (handledRefreshRevision.current === refreshRevision) return;
    handledRefreshRevision.current = refreshRevision;
    void refresh();
  }, [refreshRevision, refresh]);

  return {
    providers,
    source: mockEnabled ? "mock" : source,
    loading,
    error,
    refresh,
    fetchedAt,
  };
}

export function useProviderStats(params: UseProviderStatsParams = {}): UseProviderStatsReturn {
  return useProviderStatsView(params, "range");
}

export function useRecentApiProviderStats(params: UseProviderStatsParams = {}): UseProviderStatsReturn {
  return useProviderStatsView(params, "recent_api_7d");
}
