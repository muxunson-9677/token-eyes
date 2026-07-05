import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getUsageSummary } from "../lib/api";
import type { UsageSummaryResponse } from "../lib/types/usage";
import { useUsageFilterParams, useUsageFilterCacheKey, useUsageFilters } from "./use-usage-filters";
import { intersectVisibleSources } from "../lib/spend-provider-visibility.js";

interface UseUsageSummaryParams {
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

interface UseUsageSummaryReturn {
  summary: UsageSummaryResponse | null;
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

export function useUsageSummary({
  baseUrl,
  accessToken,
  guestAllowed = false,
  from,
  to,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  allowedSources,
}: UseUsageSummaryParams = {}): UseUsageSummaryReturn {
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
    () => intersectVisibleSources(filterParams.sources, allowedSources),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      Array.isArray(filterParams.sources) ? filterParams.sources.join(",") : filterParams.sources,
      Array.isArray(allowedSources) ? allowedSources.join(",") : allowedSources,
    ],
  );
  const disabledByVisibility = Array.isArray(allowedSources) && effectiveSources.length === 0;

  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
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
    return `tokentracker.usageSummary.${cacheKey}.${host}.${from}.${to}.${tzKey}.${filterCacheKey}.${sourcesKey}`;
  }, [baseUrl, cacheKey, from, to, timeZone, tzOffsetMinutes, filterCacheKey, effectiveSources]);

  const readCache = useCallback((): UsageSummaryResponse | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.summary) return null;
      return parsed.summary as UsageSummaryResponse;
    } catch {
      return null;
    }
  }, [storageKey]);

  const writeCache = useCallback(
    (payload: UsageSummaryResponse) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ summary: payload, fetchedAt: new Date().toISOString() }),
        );
      } catch {
        // quota / serialization errors are non-fatal
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

  // Scope-flip wipe (e.g. when filterCacheKey changes)
  const scopeKey = `${filterCacheKey}|${effectiveSources.join(",")}`;
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    setSummary(null);
    setSource("edge");
    setError(null);
    setFetchedAt(null);
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
      setSummary(null);
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
      const res = await getUsageSummary({
        baseUrl,
        accessToken: token,
        from,
        to,
        timeZone,
        tzOffsetMinutes,
        sources: effectiveSources,
        models: filterParams.models,
        agentIds: filterParams.agentIds,
        rolling: true,
      });
      setSummary(res as UsageSummaryResponse);
      setSource(mockEnabled ? "mock" : "edge");
      const now = new Date().toISOString();
      setFetchedAt(now);
      if (cacheAllowed) writeCache(res as UsageSummaryResponse);
      else clearCache();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached) {
          setSummary(cached);
          setSource("cache");
          setError(null);
        } else {
          setError(message);
          setSummary(null);
        }
      } else {
        setError(message);
        setSummary(null);
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
      setSummary(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!cacheAllowed) {
      clearCache();
      setSummary(null);
    } else {
      const cached = readCache();
      if (cached) {
        setSummary(cached);
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
    summary,
    source: mockEnabled ? "mock" : source,
    loading,
    error,
    refresh,
    fetchedAt,
    disabledByVisibility,
  };
}
