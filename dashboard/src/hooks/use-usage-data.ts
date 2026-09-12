import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { formatDateLocal, formatDateUTC } from "../lib/date-range";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { isMockEnabled } from "../lib/mock-data";
import { getLocalDayKey, getTimeZoneCacheKey } from "../lib/timezone";
import {
  fetchCloudUsageDaily,
  fetchCloudUsageSummary,
  getUsageDaily,
  getUsageSummary,
} from "../lib/api";
import { useUsageFilterParams, useUsageFilterCacheKey } from "./use-usage-filters";

export function useUsageData({
  baseUrl,
  accessToken,
  guestAllowed = false,
  from,
  to,
  includeDaily = true,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  now,
  accountView = false,
  accountAccessToken = null,
  accountRevision = 0,
  accountViewResolving = false,
}: any = {}) {
  const useCloud = Boolean(accountView && accountAccessToken);
  const scopeKey = useCloud ? "cloud" : "local";
  const [daily, setDaily] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [rolling, setRolling] = useState<any | null>(null);
  const [source, setSource] = useState<string>("edge");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mockEnabled = isMockEnabled();
  const tokenReady = isAccessTokenReady(accessToken);
  const cacheAllowed = !guestAllowed && !mockEnabled;
  // TICKET-01: integrate global usage filters (sources/models/agentIds).
  // Cloud fetchers (fetchCloudUsageDaily/Summary) do not yet support multi-value
  // filters, so we only pass filters in local mode.
  const filterParams = useUsageFilterParams();
  const filterCacheKey = useUsageFilterCacheKey();
  const filterProps = useMemo(
    () =>
      useCloud
        ? {}
        : {
            sources: filterParams.sources,
            models: filterParams.models,
            agentIds: filterParams.agentIds,
          },
    [useCloud, filterParams.sources, filterParams.models, filterParams.agentIds],
  );

  const storageKey = (() => {
    if (!cacheKey) return null;
    const host = safeHost(baseUrl) || "default";
    const dailyKey = includeDaily ? "daily" : "summary";
    const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
    return `tokentracker.usage.${cacheKey}.${scopeKey}.${host}.${from}.${to}.${dailyKey}.${tzKey}.${filterCacheKey}`;
  })();

  // Wipe state when the scope flips so the previously-rendered local data
  // doesn't visually persist while the cloud fetch is in flight (and vice
  // versa). The dependent fetcher will repopulate via refresh() below.
  // TICKET-01: also wipe when filterCacheKey changes so stale filtered data
  // doesn't render while the new filter's fetch is in flight.
  const combinedScopeKey = `${scopeKey}|${filterCacheKey}`;
  const lastScopeRef = useRef(combinedScopeKey);
  useEffect(() => {
    if (lastScopeRef.current === combinedScopeKey) return;
    lastScopeRef.current = combinedScopeKey;
    setSource("edge");
    setError(null);
    setLoading(true);
  }, [combinedScopeKey]);

  const readCache = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.summary) return null;
      return parsed;
    } catch (_e) {
      return null;
    }
  }, [storageKey]);

  const writeCache = useCallback(
    (payload: any) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (_e) {
        // ignore write errors (quota/private mode)
      }
    },
    [storageKey],
  );

  const clearCache = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch (_e) {
      // ignore remove errors (quota/private mode)
    }
  }, [storageKey]);

  const isLocalMode = isLocalDashboardRuntime();
  const requestRef = useRef<AbortController | null>(null);
  const currentRefreshRef = useRef<((options?: any) => Promise<void>) | null>(null);

  const refresh = useCallback(async ({ background = false }: any = {}) => {
    if (currentRefreshRef.current !== refresh) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const { signal } = controller;
    const resolvedToken = await resolveAuthAccessToken(accessToken);
    const cloudToken = useCloud ? await resolveAuthAccessToken(accountAccessToken) : null;
    if (signal.aborted) return;
    // 本地模式允许空 token；云端模式必须 resolve 到一个 JWT 字符串
    if (!resolvedToken && !mockEnabled && !isLocalMode && !useCloud) return;
    if (useCloud && !cloudToken) {
      // Cloud scope but the JWT could not be resolved/refreshed (refresh token
      // also dead). Surface an explicit error + stop loading instead of a bare
      // return, which previously left the panel stuck in a silent spinner.
      setError("Your session expired. Please sign in again to view account data.");
      setLoading(false);
      return;
    }
    const dailyFetcher = useCloud ? fetchCloudUsageDaily : getUsageDaily;
    const summaryFetcher = useCloud ? fetchCloudUsageSummary : getUsageSummary;
    const tokenForFetch = useCloud ? cloudToken : resolvedToken;
    if (!background) setLoading(true);
    setError(null);
    try {
      let dailyRes = null;
      let summaryRes = null;
      if (includeDaily) {
        const [dailyResult, summaryResult] = await Promise.allSettled([
          dailyFetcher({
            signal,
            baseUrl,
            accessToken: tokenForFetch,
            from,
            to,
            timeZone,
            tzOffsetMinutes,
            ...filterProps,
          }),
          summaryFetcher({
            signal,
            baseUrl,
            accessToken: tokenForFetch,
            from,
            to,
            timeZone,
            tzOffsetMinutes,
            rolling: true,
            ...filterProps,
          }),
        ]);
        if (dailyResult.status === "rejected") throw dailyResult.reason;
        if (summaryResult.status === "rejected") throw summaryResult.reason;
        dailyRes = dailyResult.value;
        summaryRes = summaryResult.value;
      } else {
        summaryRes = await summaryFetcher({
          signal,
          baseUrl,
          accessToken: tokenForFetch,
          from,
          to,
          timeZone,
          tzOffsetMinutes,
          rolling: true,
          ...filterProps,
        });
      }

      if (signal.aborted) return;
      let nextDaily = includeDaily && Array.isArray(dailyRes?.data) ? dailyRes.data : [];
      if (includeDaily) {
        nextDaily = fillDailyGaps(nextDaily, from, to, {
          timeZone,
          offsetMinutes: tzOffsetMinutes,
          now,
        });
      }
      const summaryPayload = summaryRes || dailyRes?.summary || null;
      let nextSummary = summaryPayload?.totals || null;
      if (nextSummary && summaryPayload?.data_integrity) {
        nextSummary = {
          ...nextSummary,
          data_integrity: summaryPayload.data_integrity,
        };
      }
      let nextRolling = summaryRes?.rolling || dailyRes?.summary?.rolling || null;
      if (includeDaily && !nextSummary && !summaryRes) {
        try {
          const fallback = await summaryFetcher({
            signal,
            baseUrl,
            accessToken: tokenForFetch,
            from,
            to,
            timeZone,
            tzOffsetMinutes,
            rolling: true,
            ...filterProps,
          });
          nextSummary = fallback?.totals
            ? {
                ...fallback.totals,
                ...(fallback.data_integrity ? { data_integrity: fallback.data_integrity } : {}),
              }
            : null;
          nextRolling = fallback?.rolling || nextRolling;
        } catch (_e) {
          // Ignore summary fallback errors when daily data is available.
        }
      }
      if (signal.aborted) return;
      const nowIso = new Date().toISOString();

      setDaily(nextDaily);
      setSummary(nextSummary);
      setRolling(nextRolling);
      setSource("edge");
      setFetchedAt(nowIso);

      if (nextSummary && cacheAllowed) {
        writeCache({
          summary: nextSummary,
          rolling: nextRolling,
          daily: nextDaily,
          from,
          to,
          includeDaily,
          fetchedAt: nowIso,
        });
      } else if (!cacheAllowed) {
        clearCache();
      }
    } catch (e) {
      if (signal.aborted) return;
      const err = e as any;
      const errorMessage = err?.message || String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached?.summary) {
          setSummary(cached.summary);
          setRolling(cached.rolling || null);
          const cachedDaily = Array.isArray(cached.daily) ? cached.daily : [];
          const filledDaily = includeDaily
            ? fillDailyGaps(cachedDaily, cached.from || from, cached.to || to, {
                timeZone,
                offsetMinutes: tzOffsetMinutes,
                now,
              })
            : cachedDaily;
          setDaily(filledDaily);
          setSource("cache");
          setFetchedAt(cached.fetchedAt || null);
          setError(errorMessage);
        } else {
          setError(errorMessage);
          setSource("edge");
        }
      } else {
        setError(errorMessage);
        setSource("edge");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [
    accessToken,
    baseUrl,
    from,
    includeDaily,
    mockEnabled,
    guestAllowed,
    cacheAllowed,
    now,
    readCache,
    tokenReady,
    timeZone,
    to,
    tzOffsetMinutes,
    clearCache,
    writeCache,
    isLocalMode,
    useCloud,
    accountAccessToken,
    accountRevision,
    // TICKET-01: re-fetch when filters change (local mode only; filterProps
    // is memoized — identity changes only when useCloud or filter values change).
    filterProps,
  ]);

  useLayoutEffect(() => {
    currentRefreshRef.current = accountViewResolving ? null : refresh;
    return () => {
      currentRefreshRef.current = null;
      requestRef.current?.abort();
    };
  }, [refresh, accountViewResolving]);

  useLayoutEffect(() => {
    if (accountViewResolving) {
      // Scope not yet resolved (auth loading, cloud likely). Hold a loading
      // state without reading the local cache or firing the local fetch, so we
      // don't paint local data that the cloud flip would immediately wipe.
      setLoading(true);
      return;
    }
    if (!tokenReady && !guestAllowed && !mockEnabled && !isLocalMode && !useCloud) {
      setDaily([]);
      setSummary(null);
      setRolling(null);
      setError(null);
      setLoading(false);
      setSource("edge");
      setFetchedAt(null);
      return;
    }
    let hasCachedData = false;
    if (!cacheAllowed) {
      clearCache();
      setError(null);
      setSource("edge");
    } else {
      const cached = readCache();
      if (cached?.summary) {
        hasCachedData = true;
        setSummary(cached.summary);
        setRolling(cached.rolling || null);
        const cachedDaily = Array.isArray(cached.daily) ? cached.daily : [];
        const filledDaily = includeDaily
          ? fillDailyGaps(cachedDaily, cached.from || from, cached.to || to, {
              timeZone,
              offsetMinutes: tzOffsetMinutes,
              now,
            })
          : cachedDaily;
        setDaily(filledDaily);
        setSource("cache");
        setFetchedAt(cached.fetchedAt || null);
        setLoading(false);
      }
    }
    void refresh({ background: hasCachedData });
    return () => requestRef.current?.abort();
  }, [
    accessToken,
    mockEnabled,
    readCache,
    refresh,
    tokenReady,
    guestAllowed,
    cacheAllowed,
    clearCache,
    isLocalMode,
    accountViewResolving,
  ]);

  // Auto-refresh when the dashboard regains focus / becomes visible again.
  // Usage data otherwise only re-fetches on param changes, so a left-open
  // dashboard never picks up usage that synced after page load — the user had
  // to manually reload (the "open dashboard shows stale numbers" report).
  // Upload itself is already near-real-time (the notify hook runs `sync` at
  // most every ~20s); this closes the *display* refresh gap. Throttled so
  // rapid window switches don't hammer the edge.
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const MIN_GAP_MS = 15_000;
    let lastAt = Date.now(); // mount already fired the initial fetch above
    const maybeRefresh = () => {
      if (document.visibilityState !== "visible") return;
      const nowMs = Date.now();
      if (nowMs - lastAt < MIN_GAP_MS) return;
      lastAt = nowMs;
      void refresh({ background: true });
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [refresh]);

  const normalizedSource = mockEnabled ? "mock" : source;

  return {
    daily,
    summary,
    rolling,
    source: normalizedSource,
    fetchedAt,
    loading,
    error,
    refresh,
  };
}

function safeHost(baseUrl: any) {
  try {
    const u = new URL(baseUrl);
    return u.host;
  } catch (_e) {
    return null;
  }
}

function parseUtcDate(yyyyMmDd: any) {
  if (!yyyyMmDd) return null;
  const raw = String(yyyyMmDd).trim();
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const dt = new Date(Date.UTC(y, m, d));
  if (!Number.isFinite(dt.getTime())) return null;
  return formatDateUTC(dt) === raw ? dt : null;
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function fillDailyGaps(
  rows: any[],
  from: any,
  to: any,
  { timeZone, offsetMinutes, now }: any = {},
) {
  const start = parseUtcDate(from);
  const end = parseUtcDate(to);
  if (!start || !end || end < start) return Array.isArray(rows) ? rows : [];

  const baseDate = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const todayKey = getLocalDayKey({ timeZone, offsetMinutes, date: baseDate });
  const today = parseUtcDate(todayKey);
  const todayTime = today ? today.getTime() : baseDate.getTime();

  const byDay = new Map();
  for (const row of rows || []) {
    if (row?.day) byDay.set(row.day, row);
  }

  const filled = [];
  for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, 1)) {
    const day = formatDateUTC(cursor);
    const existing = byDay.get(day);
    const isFuture = cursor.getTime() > todayTime;
    if (existing) {
      filled.push({ ...existing, missing: false, future: isFuture });
      continue;
    }
    filled.push({
      day,
      total_tokens: null,
      billable_total_tokens: null,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      reasoning_output_tokens: null,
      missing: !isFuture,
      future: isFuture,
    });
  }

  return filled;
}
