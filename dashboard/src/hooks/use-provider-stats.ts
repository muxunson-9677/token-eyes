import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getProviderStats } from "../lib/api";
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

export function useProviderStats({
  baseUrl,
  accessToken,
  guestAllowed = false,
  from,
  to,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  allowedSources,
}: UseProviderStatsParams = {}): UseProviderStatsReturn {
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

  const [providers, setProviders] = useState<ProviderStatsResponse | null>(null);
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
    return `tokentracker.providerStats.${cacheKey}.${host}.${from}.${to}.${tzKey}.${filterCacheKey}.${sourcesKey}`;
  }, [baseUrl, cacheKey, from, to, timeZone, tzOffsetMinutes, filterCacheKey, effectiveSources]);

  const readCache = useCallback((): ProviderStatsResponse | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.providers) return null;
      return parsed.providers as ProviderStatsResponse;
    } catch {
      return null;
    }
  }, [storageKey]);

  const writeCache = useCallback(
    (payload: ProviderStatsResponse) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ providers: payload, fetchedAt: new Date().toISOString() }),
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

  const scopeKey = `${filterCacheKey}|${effectiveSources.join(",")}`;
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    setSource("edge");
    setError(null);
    setLoading(true);
  }, [scopeKey]);

  const refresh = useCallback(async () => {
    const token = await resolveAuthAccessToken(accessToken);
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
      const res = await getProviderStats({
        baseUrl,
        accessToken: token,
        from,
        to,
        timeZone,
        tzOffsetMinutes,
        sources: effectiveSources,
        models: filterParams.models,
        agentIds: filterParams.agentIds,
      });
      setProviders(res as ProviderStatsResponse);
      setSource(mockEnabled ? "mock" : "edge");
      setFetchedAt(new Date().toISOString());
      if (cacheAllowed) writeCache(res as ProviderStatsResponse);
      else clearCache();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached) {
          setProviders(cached);
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
        setProviders(cached);
        setSource("cache");
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
