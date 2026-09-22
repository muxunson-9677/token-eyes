import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { isLocalDashboardRuntime } from "../lib/local-api-url";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { getRequestUsageRecords } from "../lib/api";
import type {
  UsageRecord,
  RequestUsageRecordsTotals,
} from "../lib/types/usage";
import { useUsageFilterParams, useUsageFilterCacheKey, useUsageFilters } from "./use-usage-filters";
import { normalizeVisibleProviderIds, resolveEffectiveUsageSources } from "../lib/spend-provider-visibility.js";

/**
 * 请求级 Token 记录聚合 Hook。
 *
 * 通过 `sources` 参数向后端传递多个 provider，由后端在同一个结果集完成
 * 过滤、排序和分页，返回真实的分页元数据。
 *
 * 返回的 totals 是合并后的累加值；当 visibleProviderIds 为空时返回
 * 空记录与零 totals，不再发起请求。
 */
interface UseRequestUsageRecordsParams {
  baseUrl?: string;
  accessToken?: string | null;
  guestAllowed?: boolean;
  from?: string;
  to?: string;
  cacheKey?: string;
  timeZone?: string;
  tzOffsetMinutes?: number;
  visibleProviderIds?: string[];
  /** When false, skip network fetch (deferred until idle or tab switch). */
  fetchEnabled?: boolean;
  /** 单个 source 拉取的记录上限；默认 100。 */
  limit?: number;
  /** 页码（从1开始）。 */
  page?: number;
  /** 每页记录数。 */
  pageSize?: number;
  /** V2-W3: 记录粒度过滤（"request_event" 仅消息级 | "aggregate_bucket" 仅聚合）。 */
  recordKind?: "request_event" | "aggregate_bucket" | "";
}

type RequestUsageRecordsSource = "edge" | "cache" | "mock";

type TotalsScope = "all_matching" | "returned_subset" | "unknown";
type PageMeta = { page: number; totalPages: number; total: number; totalsScope: TotalsScope };
function totalsScope(value: unknown): TotalsScope { return value === "all_matching" || value === "returned_subset" ? value : "unknown"; }

type MergedTotals = RequestUsageRecordsTotals;

interface UseRequestUsageRecordsReturn {
  records: UsageRecord[];
  totals: MergedTotals | null;
  source: RequestUsageRecordsSource;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchedAt: string | null;
  /** 分页信息。 */
  page: number;
  /** 总页数。 */
  totalPages: number;
  /** 总记录数。 */
  total: number;
  totalsScope: TotalsScope;
}

const EMPTY_TOTALS: MergedTotals = {
  total_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_output_tokens: 0,
  cost_usd: 0,
  request_count: 0,
  success_count: null,
  interrupted_count: 0,
  failure_count: 0,
  success_rate: null,
  avg_latency_ms: null,
  cache_hit_rate: 0,
  priced_tokens: 0,
  unpriced_tokens: 0,
  pricing_coverage: "complete",
  pricing_source: null,
  pricing_version: null,
  source_kind: null,
  source_url: null,
  source_updated_at: null,
  observed_at: null,
  is_stale: false,
  estimated: false,
  match_kind: null,
  matched_model: null,
  note_code: null,
  pricing_components: [],
  status_sample_count: 0,
  latency_sample_count: 0,
};

function safeHost(baseUrl: unknown): string | null {
  try {
    const url = new URL(baseUrl as string);
    return url.host;
  } catch {
    return null;
  }
}

function safeNum(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeNullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function useRequestUsageRecords({
  baseUrl,
  accessToken,
  guestAllowed = false,
  from,
  to,
  cacheKey,
  timeZone,
  tzOffsetMinutes,
  visibleProviderIds,
  fetchEnabled = true,
  limit = 100,
  page = 1,
  pageSize = 10,
  recordKind = "",
}: UseRequestUsageRecordsParams = {}): UseRequestUsageRecordsReturn {
  const mockEnabled = isMockEnabled();
  const tokenReady = isAccessTokenReady(accessToken);
  const isLocalMode = isLocalDashboardRuntime();
  const cacheAllowed = !guestAllowed && !mockEnabled;
  const filterParams = useUsageFilterParams();
  const filterCacheKey = useUsageFilterCacheKey();
  const { refreshRevision } = useUsageFilters();
  const handledRefreshRevision = useRef(refreshRevision);

  // Normalize visibleProviderIds: lowercase, dedupe, drop unknown IDs.
  // Use a serialized key for deps so the memo keeps a stable reference when
  // the caller passes a new array literal with the same contents each render.
  // Without this, normalizedVisibleProviderIds gets a new reference every
  // render, which cascades through refresh -> useEffect and triggers an
  // infinite fetch loop.
  const hasExplicitVisibleProviderIds = Array.isArray(visibleProviderIds);
  const normalizedVisibleProviderIds = useMemo(
    () => (hasExplicitVisibleProviderIds ? normalizeVisibleProviderIds(visibleProviderIds) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(visibleProviderIds) ? visibleProviderIds.join(",") : visibleProviderIds],
  );

  const effectiveSources = useMemo(
    () => resolveEffectiveUsageSources({
      sources: filterParams.sources,
      agentIds: filterParams.agentIds,
      visibleProviderIds: normalizedVisibleProviderIds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      Array.isArray(filterParams.sources) ? filterParams.sources.join(",") : filterParams.sources,
      Array.isArray(filterParams.agentIds) ? filterParams.agentIds.join(",") : filterParams.agentIds,
      Array.isArray(normalizedVisibleProviderIds) ? normalizedVisibleProviderIds.join(",") : normalizedVisibleProviderIds,
    ],
  );

  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [totals, setTotals] = useState<MergedTotals | null>(null);
  const [source, setSource] = useState<RequestUsageRecordsSource>("edge");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ page: 1, totalPages: 1, total: 0, totalsScope: "unknown" });
  const lastScopeRef = useRef<string>("init");

  // Stable serialization of normalizedVisibleProviderIds so the storageKey + scopeKey
  // change whenever the set of queried providers changes (independent of the
  // upstream filter context).
  const visibleKey = useMemo(
    () => effectiveSources.join(","),
    [effectiveSources],
  );

  const storageKey = useMemo(() => {
    if (!cacheKey) return null;
    const host = safeHost(baseUrl) || "default";
    const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
    return `tokentracker.requestUsageRecords.${cacheKey}.${host}.${from}.${to}.${tzKey}.${filterCacheKey}.${visibleKey}.${limit}.p${page}.s${pageSize}.k${recordKind || "all"}`;
  }, [baseUrl, cacheKey, from, to, timeZone, tzOffsetMinutes, filterCacheKey, visibleKey, limit, page, pageSize, recordKind]);

  const readCache = useCallback((): { records: UsageRecord[]; totals: MergedTotals; pageMeta: PageMeta } | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.records)) return null;
      const cachedTotals = (parsed.totals || EMPTY_TOTALS) as MergedTotals;
      const cachedTotal = safeNum(parsed.pageMeta?.total) || safeNum(cachedTotals.request_count) || parsed.records.length;
      return {
        records: parsed.records as UsageRecord[],
        totals: cachedTotals,
        pageMeta: {
          page: safeNum(parsed.pageMeta?.page) || page,
          totalPages: safeNum(parsed.pageMeta?.totalPages) || Math.max(1, Math.ceil(cachedTotal / pageSize)),
          total: cachedTotal,
          totalsScope: totalsScope(parsed.pageMeta?.totalsScope),
        },
      };
    } catch {
      return null;
    }
  }, [page, pageSize, storageKey]);

  const writeCache = useCallback(
    (payload: { records: UsageRecord[]; totals: MergedTotals; pageMeta: PageMeta }) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ ...payload, fetchedAt: new Date().toISOString() }),
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

  // Scope-flip wipe: when filterCacheKey or visibleKey changes, drop stale
  // records so they don't render while the new fetch is in flight.
  const scopeKey = `${filterCacheKey}|${visibleKey}`;
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    setSource("edge");
    setError(null);
    setLoading(true);
  }, [scopeKey]);

  const refresh = useCallback(async () => {
    if (!fetchEnabled) {
      setLoading(false);
      return;
    }

    const token = await resolveAuthAccessToken(accessToken);
    if (!token && !mockEnabled && !guestAllowed && !isLocalMode) {
      setLoading(false);
      return;
    }

    if (hasExplicitVisibleProviderIds && effectiveSources.length === 0) {
      setRecords([]);
      setTotals(EMPTY_TOTALS);
      setPageMeta({ page: 1, totalPages: 1, total: 0, totalsScope: "all_matching" });
      setSource(mockEnabled ? "mock" : "edge");
      setError(null);
      setFetchedAt(new Date().toISOString());
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await getRequestUsageRecords({
        sources: hasExplicitVisibleProviderIds ? effectiveSources : undefined,
        from,
        to,
        timeZone,
        tzOffsetMinutes,
        limit,
        page,
        pageSize,
        recordKind: recordKind || undefined,
        models: filterParams.models,
        agentIds: filterParams.agentIds,
        baseUrl,
        accessToken: token,
      });

      const { records = [], totals = {}, page: pageInfo = {} } = result as any;
      const allRecords = Array.isArray(records) ? records : [];

      const extractedPageMeta = {
        page: pageInfo.page || page,
        totalPages: pageInfo.total_pages || 1,
        total: pageInfo.total ?? allRecords.length,
        totalsScope: totalsScope(pageInfo.totals_scope),
      };

      const mergedTotals: MergedTotals = { ...EMPTY_TOTALS };
      if (totals) {
        mergedTotals.input_tokens = safeNum(totals.input_tokens);
        mergedTotals.output_tokens = safeNum(totals.output_tokens);
        mergedTotals.cached_input_tokens = safeNum(totals.cached_input_tokens);
        mergedTotals.cache_creation_input_tokens = safeNum(totals.cache_creation_input_tokens);
        mergedTotals.reasoning_output_tokens = safeNum(totals.reasoning_output_tokens);
        mergedTotals.total_tokens = safeNum(totals.total_tokens);
        mergedTotals.cost_usd = safeNullableNum(totals.cost_usd);
        mergedTotals.request_count = safeNum(totals.request_count);
        mergedTotals.priced_tokens = safeNum(totals.priced_tokens);
        mergedTotals.unpriced_tokens = safeNum(totals.unpriced_tokens);
        mergedTotals.status_sample_count = safeNum(totals.status_sample_count);
        mergedTotals.latency_sample_count = safeNum(totals.latency_sample_count);
        mergedTotals.success_count = totals.success_count ?? null;
        mergedTotals.interrupted_count = safeNum(totals.interrupted_count);
        mergedTotals.failure_count = safeNum(totals.failure_count);
        mergedTotals.success_rate = totals.success_rate ?? null;
        mergedTotals.avg_latency_ms = totals.avg_latency_ms ?? null;
        mergedTotals.cache_hit_rate = safeNum(totals.cache_hit_rate);
        mergedTotals.pricing_coverage = totals.pricing_coverage || "complete";
        mergedTotals.pricing_source = totals.pricing_source ?? null;
        mergedTotals.pricing_version = totals.pricing_version ?? null;
        mergedTotals.source_kind = totals.source_kind ?? null;
        mergedTotals.source_url = totals.source_url ?? null;
        mergedTotals.source_updated_at = totals.source_updated_at ?? null;
        mergedTotals.observed_at = totals.observed_at ?? null;
        mergedTotals.is_stale = Boolean(totals.is_stale);
        mergedTotals.estimated = Boolean(totals.estimated);
        mergedTotals.match_kind = totals.match_kind ?? null;
        mergedTotals.matched_model = totals.matched_model ?? null;
        mergedTotals.note_code = totals.note_code ?? null;
        mergedTotals.pricing_components = Array.isArray(totals.pricing_components)
          ? totals.pricing_components.map((component: Record<string, unknown>) => ({ ...component }))
          : [];
      }

      setRecords(allRecords);
      setTotals(mergedTotals);
      setPageMeta(extractedPageMeta);
      setSource(mockEnabled ? "mock" : "edge");
      setFetchedAt(new Date().toISOString());
      if (cacheAllowed) writeCache({ records: allRecords, totals: mergedTotals, pageMeta: extractedPageMeta });
      else clearCache();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (cacheAllowed) {
        const cached = readCache();
        if (cached) {
          setRecords(cached.records);
          setTotals(cached.totals);
          setPageMeta(cached.pageMeta);
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
    filterParams.models,
    filterParams.agentIds,
    hasExplicitVisibleProviderIds,
    effectiveSources,
    limit,
    page,
    pageSize,
    recordKind,
    fetchEnabled,
  ]);

  useEffect(() => {
    if (!fetchEnabled) {
      setLoading(false);
      return;
    }

    if (!tokenReady && !guestAllowed && !mockEnabled && !isLocalMode) {
      setRecords([]);
      setTotals(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!cacheAllowed) {
      clearCache();
    } else {
      const cached = readCache();
      if (cached) {
        setRecords(cached.records);
        setTotals(cached.totals);
        setPageMeta(cached.pageMeta);
        setSource("cache");
      }
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, cacheAllowed, tokenReady, mockEnabled, guestAllowed, fetchEnabled]);

  useEffect(() => {
    if (handledRefreshRevision.current === refreshRevision) return;
    handledRefreshRevision.current = refreshRevision;
    void refresh();
  }, [refreshRevision, refresh]);

  return {
    records,
    totals,
    source: mockEnabled ? "mock" : source,
    loading,
    error,
    refresh,
    fetchedAt,
    page: pageMeta.page,
    totalPages: pageMeta.totalPages,
    total: pageMeta.total,
    totalsScope: pageMeta.totalsScope,
  };
}
