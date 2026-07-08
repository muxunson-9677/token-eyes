import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getModelStats, getProviderStats } from "../lib/api";
import type { ModelStatsResponse, ProviderStatsResponse } from "../lib/types/usage";
import { DASHBOARD_AGENTS, type DashboardAgent } from "../lib/agent-adapters-dashboard";
import { useUsageFilters } from "./use-usage-filters";
import { filterVisibleSourceOptions } from "../lib/spend-provider-visibility.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterOptionSource {
  source: string;
  source_display_name: string;
}

export interface UsageFilterOptions {
  /** Static agent list (from agent-adapters-dashboard). */
  agents: readonly DashboardAgent[];
  /** Universe of sources seen in the last N days (no filter applied). */
  sources: FilterOptionSource[];
  /** Map of source → list of model names seen for that source. */
  modelsBySource: Record<string, string[]>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchedAt: string | null;
}

interface UseUsageFilterOptionsParams {
  baseUrl?: string;
  accessToken?: string | null;
  guestAllowed?: boolean;
  /** Optional cache namespace key (per-host scoping). */
  cacheKey?: string;
  timeZone?: string;
  tzOffsetMinutes?: number;
  /** Override the lookback window (defaults to 90 days). */
  days?: number;
  allowedSources?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeHost(baseUrl: unknown): string | null {
  try {
    const url = new URL(baseUrl as string);
    return url.host;
  } catch {
    return null;
  }
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeLookback(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from: formatLocalDate(from), to: formatLocalDate(to) };
}

interface CachedPayload {
  providers: ProviderStatsResponse | null;
  models: ModelStatsResponse | null;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches the FULL universe of sources and models (no filter applied) for
 * populating the SourceFilter / ModelFilter dropdowns. Distinct from
 * `useProviderStats` / `useModelStats`, which auto-apply the current filter
 * state via `useUsageFilterParams()` and therefore cannot be used to populate
 * the option lists (they would only return the already-selected subset).
 *
 * The lookback window defaults to 90 days so newly-installed providers show
 * up quickly without dragging in the entire history. Cached in localStorage
 * with a stable key (no filterCacheKey component — this is the unfiltered
 * universe, so it does not change when filters change).
 */
export function useUsageFilterOptions({
  baseUrl,
  accessToken,
  guestAllowed = false,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  days = 90,
  allowedSources,
}: UseUsageFilterOptionsParams = {}): UsageFilterOptions {
  const mockEnabled = isMockEnabled();
  const tokenReady = isAccessTokenReady(accessToken);
  const isLocalMode = isLocalDashboardRuntime();
  const cacheAllowed = !guestAllowed && !mockEnabled;
  const { refreshRevision } = useUsageFilters();
  const handledRefreshRevision = useRef(refreshRevision);

  const normalizedAllowedSources = useMemo(
    () => (Array.isArray(allowedSources)
      ? allowedSources.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
      : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(allowedSources) ? allowedSources.join(",") : allowedSources],
  );
  const disabledByVisibility = Array.isArray(normalizedAllowedSources) && normalizedAllowedSources.length === 0;
  const allowedSourcesKey = useMemo(
    () => (Array.isArray(normalizedAllowedSources) ? normalizedAllowedSources.join(",") : "__all__"),
    [normalizedAllowedSources],
  );

  const { from, to } = useMemo(() => computeLookback(days), [days]);

  const [providers, setProviders] = useState<ProviderStatsResponse | null>(null);
  const [models, setModels] = useState<ModelStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const storageKey = useMemo(() => {
    if (!cacheKey) return null;
    const host = safeHost(baseUrl) || "default";
    const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
    return `tokentracker.filterOptions.${cacheKey}.${host}.${from}.${to}.${tzKey}.${allowedSourcesKey}`;
  }, [baseUrl, cacheKey, from, to, timeZone, tzOffsetMinutes, allowedSourcesKey]);

  const readCache = useCallback((): CachedPayload | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed) return null;
      return parsed as CachedPayload;
    } catch {
      return null;
    }
  }, [storageKey]);

  const writeCache = useCallback(
    (payload: CachedPayload) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
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

  const refresh = useCallback(async () => {
    const token = await resolveAuthAccessToken(accessToken);
    if (!token && !mockEnabled && !guestAllowed && !isLocalMode) {
      setLoading(false);
      return;
    }

    // Disabled by visibility: clear state and return empty without fetching
    if (disabledByVisibility) {
      setProviders(null);
      setModels(null);
      setError(null);
      setFetchedAt(null);
      setLoading(false);
      clearCache();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Do not pass models/agentIds here: dropdowns need their own option
      // universe. Still apply the visible-provider allowlist so hidden sources
      // do not make the usage page slow or inconsistent.
      const sources = Array.isArray(normalizedAllowedSources) && normalizedAllowedSources.length > 0
        ? normalizedAllowedSources
        : undefined;
      const [providerRes, modelRes] = await Promise.all([
        getProviderStats({ baseUrl, accessToken: token, from, to, timeZone, tzOffsetMinutes, sources }),
        getModelStats({ baseUrl, accessToken: token, from, to, timeZone, tzOffsetMinutes, sources }),
      ]);
      if (!mountedRef.current) return;
      setProviders(providerRes as ProviderStatsResponse);
      setModels(modelRes as ModelStatsResponse);
      const now = new Date().toISOString();
      setFetchedAt(now);
      if (cacheAllowed) {
        writeCache({
          providers: providerRes as ProviderStatsResponse,
          models: modelRes as ModelStatsResponse,
          fetchedAt: now,
        });
      } else {
        clearCache();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached) {
          setProviders(cached.providers);
          setModels(cached.models);
          setFetchedAt(cached.fetchedAt);
          setError(null);
        } else {
          setError(message);
          setProviders(null);
          setModels(null);
        }
      } else {
        setError(message);
        setProviders(null);
        setModels(null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [
    accessToken,
    baseUrl,
    from,
    to,
    mockEnabled,
    guestAllowed,
    isLocalMode,
    cacheAllowed,
    readCache,
    writeCache,
    clearCache,
    timeZone,
    tzOffsetMinutes,
    disabledByVisibility,
    normalizedAllowedSources,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!tokenReady && !guestAllowed && !mockEnabled && !isLocalMode) {
      setProviders(null);
      setModels(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!cacheAllowed) {
      clearCache();
      setProviders(null);
      setModels(null);
    } else {
      const cached = readCache();
      if (cached) {
        setProviders(cached.providers);
        setModels(cached.models);
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

  // Derive the option lists from the raw responses. Sorting is stable so the
  // dropdown order does not flicker between renders.
  // Apply visibility allowlist filtering before returning to the caller.
  const sources = useMemo<FilterOptionSource[]>(() => {
    const list = Array.isArray(providers?.providers) ? providers!.providers : [];
    const seen = new Map<string, FilterOptionSource>();
    for (const row of list) {
      if (!row || typeof row.source !== "string" || !row.source) continue;
      if (seen.has(row.source)) continue;
      seen.set(row.source, {
        source: row.source,
        source_display_name: row.source_display_name || row.source,
      });
    }
    const unsorted = Array.from(seen.values());
    const filtered = filterVisibleSourceOptions(unsorted, normalizedAllowedSources);
    return filtered.sort((a, b) =>
      (a.source_display_name || a.source).localeCompare(b.source_display_name || b.source),
    );
  }, [providers, normalizedAllowedSources]);

  const modelsBySource = useMemo<Record<string, string[]>>(() => {
    const list = Array.isArray(models?.models) ? models!.models : [];
    const grouped: Record<string, string[]> = {};
    // Build a set of allowed sources for filtering
    const allowedSourcesSet = new Set(Array.isArray(normalizedAllowedSources) ? normalizedAllowedSources : []);
    for (const row of list) {
      if (!row || typeof row.model !== "string" || !row.model) continue;
      const source = typeof row.source === "string" ? row.source : "unknown";
      // Filter out models from hidden sources
      if (allowedSourcesSet.size > 0 && !allowedSourcesSet.has(source.toLowerCase())) continue;
      if (!grouped[source]) grouped[source] = [];
      if (!grouped[source].includes(row.model)) grouped[source].push(row.model);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.localeCompare(b));
    }
    return grouped;
  }, [models, normalizedAllowedSources]);

  return {
    agents: DASHBOARD_AGENTS,
    sources,
    modelsBySource,
    loading,
    error,
    refresh,
    fetchedAt,
  };
}
