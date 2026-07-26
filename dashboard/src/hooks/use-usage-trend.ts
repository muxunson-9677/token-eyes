import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getSpendTimeseries } from "../lib/api";
import type { SpendTimeseriesResponse } from "../lib/types/usage";
import { useUsageFilterParams, useUsageFilterCacheKey, useUsageFilters } from "./use-usage-filters";
import { resolveEffectiveUsageSources } from "../lib/spend-provider-visibility.js";

interface UseUsageTrendParams {
  /** Only used to derive the host segment of the storageKey; not sent to the API. */
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

interface UseUsageTrendReturn {
  trend: SpendTimeseriesResponse | null;
  source: "edge" | "cache" | "mock";
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchedAt: string | null;
  disabledByVisibility: boolean;
}

function safeHost(baseUrl: unknown): string | null {
  try {
    const url = new URL(baseUrl as string);
    return url.host;
  } catch {
    return null;
  }
}

export function useUsageTrend({
  baseUrl,
  accessToken,
  guestAllowed = false,
  from,
  to,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  allowedSources,
}: UseUsageTrendParams = {}): UseUsageTrendReturn {
  const mockEnabled = isMockEnabled();
  const tokenReady = isAccessTokenReady(accessToken);
  const isLocalMode = isLocalDashboardRuntime();
  const cacheAllowed = !guestAllowed && !mockEnabled;
  const filterParams = useUsageFilterParams();
  const filterCacheKey = useUsageFilterCacheKey();
  const { refreshRevision } = useUsageFilters();
  const handledRefreshRevision = useRef(refreshRevision);

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

  const [trend, setTrend] = useState<SpendTimeseriesResponse | null>(null);
  const [source, setSource] = useState<"edge" | "cache" | "mock">("edge");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const lastScopeRef = useRef<string>("init");

  const storageKey = useMemo(() => {
    if (!cacheKey) return null;
    const host = safeHost(baseUrl) || "default";
    const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
    const sourcesKey = effectiveSources.join(",");
    return `tokentracker.usageTrend.${cacheKey}.${host}.${from}.${to}.${tzKey}.${filterCacheKey}.${sourcesKey}`;
  }, [baseUrl, cacheKey, from, to, timeZone, tzOffsetMinutes, filterCacheKey, effectiveSources]);

  const readCache = useCallback((): SpendTimeseriesResponse | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.trend) return null;
      return parsed.trend as SpendTimeseriesResponse;
    } catch {
      return null;
    }
  }, [storageKey]);

  const writeCache = useCallback(
    (payload: SpendTimeseriesResponse) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ trend: payload, fetchedAt: new Date().toISOString() }),
        );
      } catch {
        // non-fatal
      }
    },
    [storageKey],
  );

  const clearCache = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // non-fatal
    }
  }, [storageKey]);

  // Scope-flip wipe (e.g. when filterCacheKey changes) so stale buckets don't
  // render while the new fetch is in flight.
  const scopeKey = `${filterCacheKey}|${effectiveSources.join(",")}`;
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    setSource("edge");
    setError(null);
    const cached = cacheAllowed ? readCache() : null;
    if (cached) {
      setTrend(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, [scopeKey, cacheAllowed, readCache]);

  const refresh = useCallback(async ({ background = false } = {}) => {
    const token = await resolveAuthAccessToken(accessToken);
    if (!token && !mockEnabled && !guestAllowed && !isLocalMode) {
      setLoading(false);
      return;
    }

    // Disabled by visibility: clear state and return empty without fetching
    if (disabledByVisibility) {
      setTrend(null);
      setSource("edge");
      setError(null);
      setFetchedAt(null);
      setLoading(false);
      clearCache();
      return;
    }

    const hasCachedTrend = Boolean(cacheAllowed && readCache());
    if (!background && !hasCachedTrend) {
      setLoading(true);
    }
    setError(null);
    try {
      // getSpendTimeseries short-circuits to mock data when isMockEnabled() is true.
      const res = await getSpendTimeseries({
        from,
        to,
        timeZone,
        tzOffsetMinutes,
        sources: effectiveSources,
        models: filterParams.models,
        agentIds: filterParams.agentIds,
        accessToken: token,
      });
      setTrend(res as SpendTimeseriesResponse);
      setSource(mockEnabled ? "mock" : "edge");
      setFetchedAt(new Date().toISOString());
      if (cacheAllowed) writeCache(res as SpendTimeseriesResponse);
      else clearCache();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached) {
          setTrend(cached);
          setSource("cache");
          setError(null);
        } else {
          setError(message);
        }
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
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
  ]);

  useEffect(() => {
    if (!tokenReady && !guestAllowed && !mockEnabled && !isLocalMode) {
      setTrend(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!cacheAllowed) {
      clearCache();
    } else {
      const cached = readCache();
      if (cached) {
        setTrend(cached);
        setSource("cache");
        setLoading(false);
      }
    }
    void refresh({ background: Boolean(readCache()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, cacheAllowed, tokenReady, mockEnabled, guestAllowed]);

  useEffect(() => {
    if (handledRefreshRevision.current === refreshRevision) return;
    handledRefreshRevision.current = refreshRevision;
    void refresh({ background: Boolean(trend) });
  }, [refreshRevision, refresh, trend]);

  // getSpendTimeseries short-circuits to mock data when isMockEnabled() is true.
  return {
    trend,
    source,
    loading,
    error,
    refresh,
    fetchedAt,
    disabledByVisibility,
  };
}
